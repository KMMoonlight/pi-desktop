import { t, useLocale } from "./i18n";
import type { ChatMessage } from "../shared/types";
import { number } from "./ui";

export function GenerationStatus({
  message,
  compact = false,
}: {
  message: ChatMessage;
  compact?: boolean;
}) {
  useLocale();
  const output = message.generation?.outputTokens ?? message.outputTokens;
  const rate = message.generation?.tokensPerSecond;
  if (!output || !Number.isFinite(output)) return null;
  return (
    <span
      className={`generation-status${compact ? " is-compact" : ""}`}
      title={
        rate !== undefined
          ? t("平均输出速率：SDK 输出 token 数 ÷ 首段输出到当前或完成的时间；含模型报告的思考和工具调用 token。")
          : t("SDK 报告的输出 token 数；该响应没有可用的生成计时。")
      }
      aria-label={t("输出用量与速率")}
    >
      {rate !== undefined && Number.isFinite(rate) && (
        <span>{number(rate)} tok/s</span>
      )}
      {!compact && <span>{number(output)} tokens</span>}
      {compact && rate === undefined && <span>{number(output)} tokens</span>}
    </span>
  );
}
