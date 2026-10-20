import test from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "../src/format-duration.ts";
import { setLocale } from "../src/i18n.ts";

test("durations carry rounded seconds into minutes and hours in both languages", () => {
  const cases = [
    [0, "用时 <1 毫秒", "Elapsed <1ms"],
    [999, "用时 999 毫秒", "Elapsed 999ms"],
    [1000, "用时 1 秒", "Elapsed 1s"],
    [59949, "用时 59.9 秒", "Elapsed 59.9s"],
    [59950, "用时 1 分 0 秒", "Elapsed 1m 0s"],
    [59960, "用时 1 分 0 秒", "Elapsed 1m 0s"],
    [60000, "用时 1 分 0 秒", "Elapsed 1m 0s"],
    [309500, "用时 5 分 9 秒", "Elapsed 5m 9s"],
    [369500, "用时 6 分 9 秒", "Elapsed 6m 9s"],
    [3599949, "用时 59 分 59 秒", "Elapsed 59m 59s"],
    [3599960, "用时 1 小时 0 分 0 秒", "Elapsed 1h 0m 0s"],
    [3600001, "用时 1 小时 0 分 0 秒", "Elapsed 1h 0m 0s"],
    [3661500, "用时 1 小时 1 分 1 秒", "Elapsed 1h 1m 1s"],
  ] as const;
  try {
    for (const locale of ["zh-CN", "en"] as const) {
      setLocale(locale);
      for (const [milliseconds, chinese, english] of cases)
        assert.equal(
          formatDuration(milliseconds),
          locale === "zh-CN" ? chinese : english,
          `${locale}: ${milliseconds}ms`,
        );
    }
  } finally {
    setLocale("zh-CN");
  }
});

test("missing or invalid durations remain hidden", () => {
  for (const value of [undefined, -1, NaN, Infinity, -Infinity])
    assert.equal(formatDuration(value), undefined);
});
