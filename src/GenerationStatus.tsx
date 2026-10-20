import { t, useLocale } from "./i18n";
import type { ChatMessage } from "../shared/types";
import { number } from "./ui";
import { formatDuration } from "./format-duration";
import { useEffect, useLayoutEffect, useMemo, useReducer } from "react";
import {
  prepareReplySummary,
  observeReplyClock,
  replySummaryAt,
  type ReplyClock,
  type ReplyRow,
} from "./transcript-turns";

/** Tick only the current reply's metric, including silent tool execution. */
export function ReplyGenerationStatus({
  rows,
  running,
  activeWork = false,
  showTokens = true,
  clock,
}: {
  rows: ReplyRow[];
  running: boolean;
  activeWork?: boolean;
  showTokens?: boolean;
  clock: ReplyClock;
}) {
  const prepared = useMemo(() => prepareReplySummary(rows), [rows]);
  const [, tick] = useReducer((value) => value + 1, 0);
  const live = (running || activeWork) && (!clock.finished || activeWork);
  // Read the current time on the first running render as well as every tick.
  const now = live ? Date.now() : undefined;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [live]);
  useLayoutEffect(() => {
    observeReplyClock(clock, {
      running,
      activeWork,
      now: prepared?.endedAt === undefined ? undefined : now,
    });
  }, [clock, running, activeWork, now, prepared]);
  const summary = prepared
    ? replySummaryAt(prepared, now, clock.lastObservedAt)
    : undefined;
  return summary ? (
    <GenerationStatus message={summary} showTokens={showTokens} />
  ) : null;
}

const tokenNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function SessionTokenUsage({
  tokens,
}: {
  tokens: Record<string, number>;
}) {
  useLocale();
  const count = (key: string) =>
    Number.isFinite(tokens[key]) ? Math.max(0, tokens[key]) : 0;
  const input = count("input") + count("cacheRead") + count("cacheWrite");
  const output = count("output");
  const compact = (value: number) => tokenNumber.format(value).toLowerCase();
  return (
    <span
      className="session-token-usage inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] text-muted tabular-nums"
      aria-label={t("累计输入 {value1} tokens，输出 {value2} tokens", {
        value1: input,
        value2: output,
      })}
    >
      <span>↑ {compact(input)}</span>
      <span>↓ {compact(output)}</span>
      <span>tokens</span>
    </span>
  );
}

export function GenerationStatus({
  message,
  compact = false,
  showTokens = true,
}: {
  message: ChatMessage;
  compact?: boolean;
  showTokens?: boolean;
}) {
  useLocale();
  const output = message.generation?.outputTokens ?? message.outputTokens;
  const reportedRate = message.generation?.tokensPerSecond;
  const estimatedRate = message.generation?.estimatedTokensPerSecond;
  const rate = reportedRate ?? estimatedRate;
  const estimated = reportedRate === undefined && estimatedRate !== undefined;
  const elapsed = formatDuration(
    message.generation?.elapsedMs ?? message.generation?.durationMs,
  );
  const hasOutput =
    showTokens && output !== undefined && output > 0 && Number.isFinite(output);
  const hasElapsed = elapsed !== undefined;
  if (
    compact
      ? rate === undefined || !Number.isFinite(rate)
      : !hasOutput && !hasElapsed
  )
    return null;
  return (
    <span
      className={`generation-status${compact ? " is-compact" : ""}`}
      aria-label={
        compact
          ? t(estimated ? "估算输出速率" : "输出速率")
          : t("输出用量与耗时")
      }
    >
      {compact && (
        <span>
          {estimated ? "≈ " : ""}
          {number(rate)} tok/s
        </span>
      )}
      {!compact && hasElapsed && <span>{elapsed}</span>}
      {!compact && hasOutput && <span>{number(output)} tokens</span>}
    </span>
  );
}
