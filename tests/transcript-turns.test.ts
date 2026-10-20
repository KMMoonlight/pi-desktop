import test from "node:test";
import assert from "node:assert/strict";
import {
  groupTranscriptRows,
  currentReplyActivity,
  currentReplyTurn,
  replyHasLiveWork,
  observeReplyClock,
  replySummary,
  prepareReplySummary,
  replySummaryAt,
  isProcessRow,
  type TranscriptRow,
  type ReplyRow,
  type TranscriptTurn,
  type ReplyClock,
} from "../src/transcript-turns.ts";
import type { ChatMessage } from "../shared/types.ts";

const message = (
  id: string,
  role = "assistant",
  extra: Partial<ChatMessage> = {},
): TranscriptRow & { kind: "message" } => ({
  kind: "message",
  message: {
    id,
    role,
    timestamp: 1000,
    content: [{ type: "text", text: id }],
    ...extra,
  },
});
const tool: ReplyRow = {
  kind: "tool",
  call: { type: "toolCall", id: "read-1", name: "read" },
};

test("pending prompts do not take ownership of an active reply before becoming a real turn", () => {
  const running: TranscriptTurn = {
    id: "running", rows: [message("user", "user"), message("assistant"), tool],
  };
  const pending: TranscriptTurn = {
    id: "pending", rows: [message("pending", "user", { preparing: true })],
  };
  assert.equal(currentReplyTurn([running, pending]), running);
  const accepted: TranscriptTurn = { id: "accepted", rows: [message("next", "user")] };
  assert.equal(currentReplyTurn([running, accepted]), accepted);
  assert.equal(currentReplyTurn([pending]), undefined);
  assert.equal(currentReplyTurn([]), undefined);
});

test("only streaming records and executing tools are evidence of live reply work", () => {
  const assistant = message("assistant");
  assert.equal(replyHasLiveWork([assistant, tool]), false);
  assert.equal(replyHasLiveWork([assistant], "other-reply"), false);
  assert.equal(replyHasLiveWork([assistant], "assistant"), true);
  assert.equal(replyHasLiveWork([{
    ...tool, active: { id: "read-1", name: "read", arguments: {} },
  }]), true);
});

test("reply clocks retain their visible time, resist stale running flags and resume with live evidence", () => {
  const prepared = prepareReplySummary([message("assistant", "assistant", {
    generation: { outputTokens: 12, elapsedMs: 500, completed: true },
  }), tool])!;
  const clock: ReplyClock = {};
  observeReplyClock(clock, { running: true, now: 4000 });
  observeReplyClock(clock, { running: false });
  observeReplyClock(clock, { running: true, now: 12000 });
  assert.equal(clock.finished, true);
  assert.equal(clock.lastObservedAt, 4000);
  const completed = replySummaryAt(prepared, undefined, clock.lastObservedAt);
  assert.equal(completed.generation?.elapsedMs, 3000);
  assert.equal(completed.generation?.completed, true);

  // A transient false flag cannot freeze an executing tool permanently.
  observeReplyClock(clock, { running: false, activeWork: true, now: 6000 });
  assert.equal(clock.finished, false);
  assert.equal(clock.lastObservedAt, 6000);
  observeReplyClock(clock, { running: false });
  observeReplyClock(clock, { running: true, activeWork: true, now: 9000 });
  observeReplyClock(clock, { running: true, now: 10000 });
  assert.equal(clock.finished, false);
  assert.equal(clock.lastObservedAt, 10000);
  observeReplyClock(clock, { running: false });
  observeReplyClock(clock, { running: true, now: 20000 });
  assert.equal(clock.lastObservedAt, 10000);
});

test("live activity selects one latest thought and prioritizes unfinished parallel tools", () => {
  const thoughts = message("thoughts", "assistant", {
    content: [
      { type: "thinking", thinking: "First thought" },
      { type: "text", text: "Progress update" },
      { type: "thinking", thinking: "Current thought" },
    ],
  });
  assert.deepEqual(currentReplyActivity([thoughts]), {
    row: thoughts,
    thinkingBlockIndex: 2,
  });
  const active = {
    ...tool,
    active: { id: "read-1", name: "read", arguments: {} },
  };
  const later = { ...tool, call: { ...tool.call, id: "read-2" } };
  assert.equal(currentReplyActivity([thoughts, active, later])?.row, active);
  assert.equal(currentReplyActivity([thoughts, tool, later])?.row, later);
  assert.equal(currentReplyActivity([tool, thoughts])?.row, thoughts);
  assert.equal(currentReplyActivity([tool, message("answer")])?.row, tool);
  assert.equal(currentReplyActivity([message("answer")]), undefined);
  assert.equal(currentReplyActivity([]), undefined);
});

test("a multi-response tool loop is one reply without crossing user, notice or custom-renderer boundaries", () => {
  const rows: TranscriptRow[] = [
    message("user", "user"),
    message("reasoning"),
    tool,
    message("more-reasoning"),
    { ...tool, call: { ...tool.call, id: "read-2" } },
    message("answer"),
    message("next-user", "user"),
    message("next-answer"),
    {
      kind: "notice",
      notice: { id: "notice", presentation: { text: "Compacted" } },
    },
    message("custom", "assistant", { desktopSurfaceId: "extension-message" }),
    message("after-custom"),
  ];
  const groups = groupTranscriptRows(rows);
  assert.deepEqual(
    groups.map((row) => row.kind),
    ["message", "reply", "message", "reply", "notice", "message", "reply"],
  );
  assert.ok(groups[1].kind === "reply");
  assert.equal(groups[1].id, "reasoning");
  assert.deepEqual(groups[1].rows, rows.slice(1, 6));
  assert.equal(rows.length, 11);
});

test("turn timing includes tools, token totals include each model response, and historical timing is not fabricated", () => {
  const rows: ReplyRow[] = [
    message("first", "assistant", {
      generation: { outputTokens: 12, elapsedMs: 500, completed: true },
    }),
    tool,
    message("last", "assistant", {
      timestamp: 3000,
      generation: { outputTokens: 23, elapsedMs: 800, completed: true },
    }),
  ];
  const summary = replySummary(rows)!;
  assert.equal(summary.generation?.elapsedMs, 2800);
  assert.equal(summary.generation?.outputTokens, 35);
  assert.equal(summary.timestamp, 3000);
  const old = replySummary([
    message("old", "assistant", { outputTokens: 7 }),
    tool,
    message("old-last", "assistant", { timestamp: 8000, outputTokens: 11 }),
  ])!;
  assert.equal(old.outputTokens, 18);
  assert.equal(old.generation, undefined);
  assert.equal(replySummary([tool]), undefined);
});

test("live reply time advances through silent tools and completed tool tails survive an abort", () => {
  const rows: ReplyRow[] = [
    message("first", "assistant", {
      timestamp: 1000,
      generation: { outputTokens: 12, elapsedMs: 500, completed: true },
    }),
    tool,
  ];
  assert.equal(replySummary(rows, 4000)?.generation?.elapsedMs, 3000);
  assert.equal(replySummary(rows, 6000)?.generation?.elapsedMs, 5000);
  assert.equal(replySummary(rows, 6000)?.generation?.completed, false);
  assert.equal(replySummary(rows, 6000)?.generation?.outputTokens, 12);
  const finished: ReplyRow[] = [
    rows[0],
    {
      ...tool,
      result: {
        id: "tool-result",
        role: "toolResult",
        timestamp: 7000,
        content: [{ type: "text", text: "Aborted" }],
        isError: true,
      },
    },
  ];
  const restored = replySummary(JSON.parse(JSON.stringify(finished)))!;
  assert.equal(restored.generation?.elapsedMs, 6000);
  assert.equal(restored.generation?.completed, true);
  assert.equal(restored.generation?.outputTokens, 12);
});

test("a prepared reply retains the last visible time if completion has no final result", () => {
  const prepared = prepareReplySummary([
    message("first", "assistant", {
      timestamp: 1000,
      generation: { outputTokens: 12, elapsedMs: 500, completed: true },
    }),
    tool,
  ])!;
  const live = replySummaryAt(prepared, 9000);
  const completed = replySummaryAt(prepared, undefined, 9000);
  assert.equal(live.generation?.elapsedMs, 8000);
  assert.equal(live.generation?.completed, false);
  assert.equal(completed.generation?.elapsedMs, 8000);
  assert.equal(completed.generation?.completed, true);
  assert.equal(completed.outputTokens, 12);
  assert.equal(prepared.endedAt, 1500);
  const old = prepareReplySummary([
    message("old", "assistant", { outputTokens: 7 }),
  ])!;
  assert.equal(replySummaryAt(old, undefined, 9000).generation, undefined);
});

test("thought-only records belong to activity while commentary, images and errors retain their visible content", () => {
  assert.equal(isProcessRow(tool), true);
  assert.equal(
    isProcessRow(
      message("thought", "assistant", {
        content: [
          { type: "thinking", thinking: "Plan" },
          { type: "toolCall", id: "1" },
        ],
      }),
    ),
    true,
  );
  assert.equal(isProcessRow(message("commentary")), false);
  assert.equal(
    isProcessRow(
      message("image", "assistant", {
        content: [{ type: "image", data: "png" }],
      }),
    ),
    false,
  );
  assert.equal(
    isProcessRow(
      message("error", "assistant", {
        content: [],
        completionNotice: { text: "Aborted" },
      }),
    ),
    false,
  );
});
