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
  // Normalize to the displayed tenth of a second before selecting units, so
  // 59.96 seconds carries into a minute instead of being printed as 60 seconds.
  const displayedSeconds = Math.round(durationMs / 100) / 10;
  const seconds = Math.floor(displayedSeconds);
  if (seconds >= 3600) {
    return t("用时 {value1} 小时 {value2} 分 {value3} 秒", {
      value1: formatNumber(Math.floor(seconds / 3600)),
      value2: formatNumber(Math.floor(seconds / 60) % 60),
      value3: formatNumber(seconds % 60),
    });
  }
  if (seconds >= 60) {
    return t("用时 {value1} 分 {value2} 秒", {
      value1: formatNumber(Math.floor(seconds / 60)),
      value2: formatNumber(seconds % 60),
    });
  }
  return t("用时 {value1} 秒", {
    value1: formatNumber(displayedSeconds, { maximumFractionDigits: 1 }),
  });
}
