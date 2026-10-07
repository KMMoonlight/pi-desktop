import test from "node:test";
import assert from "node:assert/strict";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { GenerationTracker } from "../backend/generation-metrics.ts";

const message = (timestamp: number, output = 0) => ({
  role: "assistant" as const, timestamp, content: [], api: "openai-completions" as const,
  provider: "test", model: "test", stopReason: "stop" as const,
  usage: { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const update = (timestamp: number, output: number, delta: string): AgentSessionEvent => ({
  type: "message_update", message: message(timestamp, output),
  assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: message(timestamp, output) },
});
test("output rate uses reported tokens and output time, excluding time before first output", () => {
  const tracker = new GenerationTracker();
  tracker.observe({ type: "message_start", message: message(1) }, "session", 0);
  tracker.observe(update(1, 0, "很长的正文不会被当作 token 计数"), "session", 1000);
  assert.equal(tracker.get("session", 1, 1100)?.tokensPerSecond, undefined);
  tracker.observe(update(1, 6, "tail"), "session", 1125);
  assert.equal(tracker.get("session", 1, 1125)?.tokensPerSecond, 48);
  tracker.observe({ type: "message_end", message: message(1, 12) }, "session", 1250);
  assert.deepEqual(tracker.get("session", 1, 9000), { outputTokens: 12, durationMs: 250, tokensPerSecond: 48, completed: true });
  assert.equal(tracker.get("another", 1), undefined);
});
test("missing output timing and empty deltas do not produce a fabricated speed", () => {
  const tracker = new GenerationTracker();
  tracker.observe({ type: "message_start", message: message(2) }, "session", 0);
  tracker.observe(update(2, 0, ""), "session", 50);
  tracker.observe({ type: "message_end", message: message(2, 12) }, "session", 100);
  assert.equal(tracker.get("session", 2)?.tokensPerSecond, undefined);
  assert.equal(tracker.get("session", 2)?.outputTokens, 12);
});
