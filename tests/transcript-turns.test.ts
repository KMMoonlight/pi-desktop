import test from "node:test";
import assert from "node:assert/strict";
import {
  groupTranscriptRows,
  replySummary,
  isProcessRow,
  type TranscriptRow,
  type ReplyRow,
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
