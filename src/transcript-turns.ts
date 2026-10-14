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

export function replySummary(rows: ReplyRow[]): ChatMessage | undefined {
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
  return {
    ...last,
    outputTokens,
    generation:
      elapsed === undefined
        ? undefined
        : {
            outputTokens,
            // Include time spent in tools between model responses. Older transcripts
            // without timing retain token totals without inventing an elapsed time.
            elapsedMs: Math.max(0, last.timestamp - first.timestamp) + elapsed,
            completed: last.generation?.completed ?? true,
          },
  };
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
