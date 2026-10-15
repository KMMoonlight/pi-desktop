import { formatNumber, t } from "./i18n";

export function formatDuration(durationMs: number | undefined) {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0)
    return undefined;
  // The SDK rounds execution times to whole milliseconds, including zero.
  if (durationMs < 1) return t("用时 <1 毫秒");
  if (durationMs < 1000)
    return t("用时 {value1} 毫秒", {
      value1: formatNumber(durationMs, { maximumFractionDigits: 0 }),
    });
  return t("用时 {value1} 秒", {
    value1: formatNumber(durationMs / 1000, { maximumFractionDigits: 1 }),
  });
}
