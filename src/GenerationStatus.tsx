import { t, useLocale } from "./i18n";
import type { ChatMessage } from "../shared/types";
import { number } from "./ui";

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
}: {
  message: ChatMessage;
  compact?: boolean;
}) {
  useLocale();
  const output = message.generation?.outputTokens ?? message.outputTokens;
  const reportedRate = message.generation?.tokensPerSecond;
  const estimatedRate = message.generation?.estimatedTokensPerSecond;
  const rate = reportedRate ?? estimatedRate;
  const estimated = reportedRate === undefined && estimatedRate !== undefined;
  const elapsed =
    message.generation?.elapsedMs ?? message.generation?.durationMs;
  const hasOutput =
    output !== undefined && output > 0 && Number.isFinite(output);
  const hasElapsed = elapsed !== undefined && Number.isFinite(elapsed);
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
        <span>{estimated ? "≈ " : ""}{number(rate)} tok/s</span>
      )}
      {!compact && hasElapsed && (
        <span>{t("用时 {value1} 秒", { value1: number(elapsed / 1000) })}</span>
      )}
      {!compact && hasOutput && <span>{number(output)} tokens</span>}
    </span>
  );
}
