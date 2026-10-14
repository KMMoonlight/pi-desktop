import test from "node:test";
import assert from "node:assert/strict";
import {
  transcriptTurnPreview,
  type TranscriptTurn,
} from "../src/transcript-turns.ts";

test("navigation previews retain the question, each visible response and attachments, excluding tool output and reasoning", () => {
  const turn: TranscriptTurn = {
    id: "question",
    rows: [
      {
        kind: "message",
        message: {
          id: "question",
          role: "user",
          timestamp: 1,
          content: [
            { type: "text", text: "A long question\nwith details" },
            { type: "image" },
          ],
        },
      },
      {
        kind: "message",
        message: {
          id: "plan",
          role: "assistant",
          timestamp: 2,
          content: [
            { type: "thinking", thinking: "Hidden reasoning" },
            { type: "text", text: "Checking the code." },
            { type: "toolCall", id: "tool", name: "read" },
          ],
        },
      },
      {
        kind: "tool",
        call: { type: "toolCall", id: "tool", name: "read" },
        result: {
          id: "result",
          role: "toolResult",
          timestamp: 3,
          content: [{ type: "text", text: "Raw tool output" }],
        },
      },
      {
        kind: "message",
        message: {
          id: "reply",
          role: "assistant",
          timestamp: 4,
          content: [
            { type: "text", text: "Here is the answer." },
            { type: "image" },
          ],
          completionNotice: { text: "Interrupted" },
        },
      },
    ],
  };
  assert.deepEqual(transcriptTurnPreview(turn), {
    id: "question",
    prompt: "A long question\nwith details",
    reply: "Checking the code.\n\nHere is the answer.\n\nInterrupted",
    images: 1,
    replyImages: 1,
  });
  assert.deepEqual(transcriptTurnPreview({ id: "empty", rows: [] }), {
    id: "empty",
    prompt: "",
    reply: "",
    images: 0,
    replyImages: 0,
  });
});
