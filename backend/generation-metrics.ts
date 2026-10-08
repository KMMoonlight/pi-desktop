import {
  estimateTokens,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { GenerationMetrics } from "../shared/types.ts";

type Sample = {
  key: string;
  startedAt: number;
  firstOutput?: number;
  end?: number;
  outputTokens: number;
  estimatedOutputTokens: number;
};
const key = (sessionId: string, timestamp: number) =>
  `${sessionId}:${timestamp}`;

/** Pi appends an assistant entry on completion; its message timestamp is the start. */
export function recordedGeneration(
  timestamp: number,
  completedAt: string | undefined,
  outputTokens = 0,
): GenerationMetrics | undefined {
  const end = completedAt === undefined ? NaN : Date.parse(completedAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(end) || end < timestamp)
    return;
  return {
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0,
    elapsedMs: end - timestamp,
    completed: true,
  };
}

/** Usage stays provider-reported; a separate live rate can use Pi's content estimate. */
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
      this.active = {
        key: id,
        startedAt: now,
        outputTokens: 0,
        estimatedOutputTokens: 0,
      };
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
      ) {
        sample.firstOutput ??= now;
        sample.estimatedOutputTokens = estimateTokens(message);
      }
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
      elapsedMs: Math.max(0, (sample.end ?? now) - sample.startedAt),
      completed: sample.end !== undefined,
      tokensPerSecond:
        sample.outputTokens > 0 && durationMs !== undefined && durationMs > 0
          ? (sample.outputTokens * 1000) / durationMs
          : undefined,
      ...(sample.end === undefined &&
      sample.outputTokens === 0 &&
      sample.estimatedOutputTokens > 0 &&
      durationMs !== undefined &&
      durationMs > 0
        ? {
            estimatedTokensPerSecond:
              (sample.estimatedOutputTokens * 1000) / durationMs,
          }
        : {}),
    };
  }
}
