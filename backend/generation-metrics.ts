import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { GenerationMetrics } from "../shared/types.ts";

type Sample = {
  key: string;
  firstOutput?: number;
  end?: number;
  outputTokens: number;
};
const key = (sessionId: string, timestamp: number) =>
  `${sessionId}:${timestamp}`;

/** Token counts come from Pi usage; elapsed output time is measured by this host. */
export class GenerationTracker {
  private active?: Sample;
  private finished = new Map<string, GenerationMetrics>();
  observe(
    event: AgentSessionEvent,
    sessionId: string,
    now = performance.now(),
  ) {
    if ("parentToolCallId" in event && event.parentToolCallId) return;
    if (event.type === "agent_settled") {
      this.active = undefined;
      return;
    }
    if (
      !["message_start", "message_update", "message_end"].includes(
        event.type,
      ) ||
      !("message" in event) ||
      event.message.role !== "assistant"
    )
      return;
    const message = event.message;
    const id = key(sessionId, message.timestamp);
    if (event.type === "message_start")
      this.active = { key: id, outputTokens: 0 };
    const sample = this.active;
    if (!sample || sample.key !== id) return;
    sample.outputTokens = Number.isFinite(message.usage.output)
      ? Math.max(0, message.usage.output)
      : 0;
    if (event.type === "message_update" && "assistantMessageEvent" in event) {
      const update = event.assistantMessageEvent;
      if (
        ["text_delta", "thinking_delta", "toolcall_delta"].includes(
          update.type,
        ) &&
        "delta" in update &&
        update.delta
      )
        sample.firstOutput ??= now;
    }
    if (event.type === "message_end") {
      sample.end = now;
      this.finished.set(id, this.metrics(sample, now));
      if (this.finished.size > 512)
        this.finished.delete(this.finished.keys().next().value!);
      this.active = undefined;
    }
  }
  get(sessionId: string, timestamp: number, now = performance.now()) {
    const id = key(sessionId, timestamp);
    return this.active?.key === id
      ? this.metrics(this.active, now)
      : this.finished.get(id);
  }
  private metrics(sample: Sample, now: number): GenerationMetrics {
    const durationMs =
      sample.firstOutput === undefined
        ? undefined
        : Math.max(0, (sample.end ?? now) - sample.firstOutput);
    return {
      outputTokens: sample.outputTokens,
      durationMs,
      completed: sample.end !== undefined,
      tokensPerSecond:
        sample.outputTokens > 0 && durationMs !== undefined && durationMs > 0
          ? (sample.outputTokens * 1000) / durationMs
          : undefined,
    };
  }
}
