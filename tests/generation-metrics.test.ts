import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { GenerationTracker, recordedGeneration } from "../backend/generation-metrics.ts";

const message = (timestamp: number, output = 0) => ({
  role: "assistant" as const, timestamp, content: [], api: "openai-completions" as const,
  provider: "test", model: "test", stopReason: "stop" as const,
  usage: { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const update = (timestamp: number, output: number, delta: string): Extract<AgentSessionEvent, { type: "message_update" }> => ({
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
  assert.deepEqual(tracker.get("session", 1, 9000), { outputTokens: 12, durationMs: 250, elapsedMs: 1250, tokensPerSecond: 48, completed: true });
  assert.equal(tracker.get("another", 1), undefined);
});
test("missing output timing and empty deltas do not produce a fabricated speed", () => {
  const tracker = new GenerationTracker();
  tracker.observe({ type: "message_start", message: message(2) }, "session", 0);
  tracker.observe(update(2, 0, ""), "session", 50);
  tracker.observe({ type: "message_end", message: message(2, 12) }, "session", 100);
  assert.equal(tracker.get("session", 2)?.tokensPerSecond, undefined);
  assert.equal(tracker.get("session", 2)?.outputTokens, 12);
  assert.equal(tracker.get("session", 2)?.elapsedMs, 100);
});

test("historical elapsed time uses completion entries without inventing output speed", () => {
  assert.deepEqual(recordedGeneration(1000, new Date(3600).toISOString(), 42), {
    elapsedMs: 2600, outputTokens: 42, completed: true,
  });
  for (const end of [undefined, "invalid", new Date(999).toISOString()])
    assert.equal(recordedGeneration(1000, end, 42), undefined);
});

test("providers with final-only usage get a separate live estimate for text, reasoning and tools", () => {
  const cases = [
    { content: [{ type: "text" as const, text: "A response with no live token counts." }], type: "text_delta" as const },
    { content: [{ type: "thinking" as const, thinking: "Reasoning without live token counts." }], type: "thinking_delta" as const },
    { content: [{ type: "toolCall" as const, id: "call-1", name: "bash", arguments: { command: "echo hello" } }], type: "toolcall_delta" as const },
  ];
  for (const { content, type } of cases) {
    const tracker = new GenerationTracker();
    const partial = { ...message(3), content };
    tracker.observe({ type: "message_start", message: message(3) }, "session", 0);
    assert.equal(tracker.get("session", 3, 500)?.estimatedTokensPerSecond, undefined);
    tracker.observe({ type: "message_update", message: partial, assistantMessageEvent: {
      type, contentIndex: 0, delta: "output", partial,
    } }, "session", 1000);
    assert.equal(tracker.get("session", 3, 1000)?.estimatedTokensPerSecond, undefined);
    const live = tracker.get("session", 3, 1500)!;
    assert.equal(live.outputTokens, 0);
    assert.equal(live.tokensPerSecond, undefined);
    assert.equal(live.estimatedTokensPerSecond, estimateTokens(partial) * 2);
    assert.equal(partial.usage.output, 0);
    assert.equal(tracker.get("another", 3, 1500), undefined);
    tracker.observe({ type: "message_end", message: { ...partial, usage: message(3, 12).usage } }, "session", 2000);
    const completed = tracker.get("session", 3)!;
    assert.equal(completed.outputTokens, 12);
    assert.equal(completed.tokensPerSecond, 12);
    assert.equal(completed.estimatedTokensPerSecond, undefined);
  }
});

test("reported live usage replaces the estimate and a new message does not inherit it", () => {
  const tracker = new GenerationTracker();
  tracker.observe({ type: "message_start", message: message(4) }, "session", 0);
  tracker.observe({ ...update(4, 0, "Hello"), message: { ...message(4), content: [{ type: "text", text: "Hello" }] } }, "session", 100);
  assert.equal(tracker.get("session", 4, 200)?.estimatedTokensPerSecond, 20);
  tracker.observe(update(4, 5, " world"), "session", 200);
  assert.equal(tracker.get("session", 4, 200)?.tokensPerSecond, 50);
  assert.equal(tracker.get("session", 4, 200)?.estimatedTokensPerSecond, undefined);
  tracker.observe({ type: "message_start", message: message(5) }, "session", 300);
  assert.equal(tracker.get("session", 4, 400), undefined);
  assert.equal(tracker.get("session", 5, 400)?.estimatedTokensPerSecond, undefined);
});
