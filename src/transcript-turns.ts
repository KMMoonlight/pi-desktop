import type {
  ChatMessage,
  ContentBlock,
  DesktopSnapshot,
} from "../shared/types.ts";

export type ToolRow = {
  kind: "tool";
  call: ContentBlock;
  result?: ChatMessage;
  active?: DesktopSnapshot["activeTools"][number];
};
export type TranscriptRow =
  | { kind: "message"; message: ChatMessage }
  | {
      kind: "notice";
      notice: NonNullable<DesktopSnapshot["conversationNotices"]>[number];
    }
  | ToolRow;
export type ReplyRow = Exclude<TranscriptRow, { kind: "notice" }>;
export type ReplyGroup = { kind: "reply"; id: string; rows: ReplyRow[] };
export type TranscriptTurn = { id: string; rows: TranscriptRow[] };

/** A message being prepared or queued cannot take ownership of a live reply. */
export function currentReplyTurn(turns: TranscriptTurn[]) {
  for (let index = turns.length - 1; index >= 0; index--) {
    const first = turns[index].rows[0];
    if (!(first?.kind === "message" && first.message.role === "user" && first.message.preparing))
      return turns[index];
  }
}

/** Only live SDK records can reopen a reply whose displayed clock was frozen. */
export function replyHasLiveWork(rows: ReplyRow[], streamingId?: string) {
  return rows.some(row => row.kind === "tool"
    ? !!row.active
    : streamingId !== undefined && row.message.id === streamingId);
}

/** Show one live activity while retaining every record for the finished reply. */
export function currentReplyActivity(rows: ReplyRow[]) {
  // A later parallel call can finish before an earlier one. Prefer work that
  // is still running, then retain the latest activity between model chunks.
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row.kind === "tool" && row.active)
      return { row, thinkingBlockIndex: undefined };
  }
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row.kind === "tool") return { row, thinkingBlockIndex: undefined };
    for (
      let blockIndex = row.message.content.length - 1;
      blockIndex >= 0;
      blockIndex--
    ) {
      const block = row.message.content[blockIndex];
      if (block.type === "thinking" && block.thinking?.trim()) {
        const presentation = row.message.markdown?.find((item) =>
          item.blockIndices.includes(blockIndex),
        );
        return {
          row,
          thinkingBlockIndex: presentation?.blockIndices[0] ?? blockIndex,
        };
      }
    }
  }
}

/** Preview conversation content without exposing hidden reasoning or tool output. */
export function transcriptTurnPreview(turn: TranscriptTurn) {
  const messages = turn.rows.flatMap((row) =>
    row.kind === "message" ? [row.message] : [],
  );
  const text = (message: ChatMessage) =>
    message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n\n")
      .trim();
  const user = messages.find((message) => message.role === "user");
  const replies = messages.filter((message) => message.role === "assistant");
  return {
    id: turn.id,
    prompt: user ? text(user) : "",
    reply: replies
      .flatMap((message) => [
        text(message),
        message.completionNotice?.text ?? "",
      ])
      .filter(Boolean)
      .join("\n\n"),
    images: user?.content.filter((block) => block.type === "image").length ?? 0,
    replyImages: replies.reduce(
      (count, message) =>
        count +
        message.content.filter((block) => block.type === "image").length,
      0,
    ),
  };
}

/** Keep SDK records intact while presenting a tool loop as one assistant reply. */
export function groupTranscriptRows(
  rows: TranscriptRow[],
): (TranscriptRow | ReplyGroup)[] {
  const groups: (TranscriptRow | ReplyGroup)[] = [];
  for (const row of rows) {
    if (
      row.kind === "tool" ||
      (row.kind === "message" &&
        row.message.role === "assistant" &&
        !row.message.desktopSurfaceId)
    ) {
      const previous = groups.at(-1);
      if (previous?.kind === "reply") previous.rows.push(row);
      else
        groups.push({
          kind: "reply",
          id: row.kind === "tool" ? `tool:${row.call.id}` : row.message.id,
          rows: [row],
        });
    } else groups.push(row);
  }
  return groups;
}

export type PreparedReplySummary = {
  message: ChatMessage;
  startedAt: number;
  endedAt?: number;
};
export type ReplyClock = { lastObservedAt?: number; finished?: boolean };

export function observeReplyClock(
  clock: ReplyClock,
  { running, activeWork = false, now }: {
    running: boolean;
    activeWork?: boolean;
    now?: number;
  },
) {
  if (activeWork) clock.finished = false;
  if (!running && !activeWork) {
    clock.finished = true;
    return;
  }
  if (!clock.finished && now !== undefined && Number.isFinite(now))
    clock.lastObservedAt = Math.max(clock.lastObservedAt ?? now, now);
}

/** Summarize records only when rows change, independently of the live clock. */
export function prepareReplySummary(
  rows: ReplyRow[],
): PreparedReplySummary | undefined {
  const messages = rows.flatMap((row) =>
    row.kind === "message" ? [row.message] : [],
  );
  const first = messages[0],
    last = messages.at(-1);
  if (!first || !last) return;
  const outputTokens = messages.reduce(
    (total, message) =>
      total + (message.generation?.outputTokens ?? message.outputTokens ?? 0),
    0,
  );
  const elapsed = last.generation?.elapsedMs ?? last.generation?.durationMs;
  let endedAt = elapsed === undefined ? undefined : last.timestamp + elapsed;
  if (endedAt !== undefined) {
    // A stopped reply may end in a tool result rather than another model
    // response. Its recorded timestamp retains the final tool's waiting time.
    for (const row of rows)
      if (
        row.kind === "tool" &&
        row.result &&
        Number.isFinite(row.result.timestamp)
      )
        endedAt = Math.max(endedAt, row.result.timestamp);
  }
  return {
    message: { ...last, outputTokens },
    startedAt: first.timestamp,
    endedAt,
  };
}

/** `completed` describes the whole reply here, including any tool execution. */
export function replySummaryAt(
  prepared: PreparedReplySummary,
  now?: number,
  minimumEnd?: number,
): ChatMessage {
  let endedAt = prepared.endedAt;
  if (endedAt !== undefined) {
    for (const value of [now, minimumEnd])
      if (value !== undefined && Number.isFinite(value))
        endedAt = Math.max(endedAt, value);
  }
  const { message, startedAt } = prepared;
  return {
    ...message,
    generation:
      endedAt === undefined
        ? undefined
        : {
            outputTokens: message.outputTokens ?? 0,
            // Live wall time includes silent tools and gaps between model responses.
            // Older transcripts without timing still retain only their token totals.
            elapsedMs: Math.max(0, endedAt - startedAt),
            completed:
              now === undefined && (message.generation?.completed ?? true),
          },
  };
}

export function replySummary(
  rows: ReplyRow[],
  now?: number,
): ChatMessage | undefined {
  const prepared = prepareReplySummary(rows);
  return prepared ? replySummaryAt(prepared, now) : undefined;
}

export function isProcessRow(row: ReplyRow) {
  return (
    row.kind === "tool" ||
    (!row.message.completionNotice &&
      row.message.content.every(
        (block) =>
          block.type === "thinking" ||
          block.type === "toolCall" ||
          (block.type === "text" && !block.text?.trim()),
      ))
  );
}
