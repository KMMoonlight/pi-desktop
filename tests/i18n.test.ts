import test from "node:test";
import assert from "node:assert/strict";
import { english } from "../src/locales/en.ts";
import { t, setLocale, getLocale, localizeText, formatDate, formatNumber } from "../src/i18n.ts";

test("both interface languages preserve interpolation and unknown content", () => {
  for (const [key, translated] of Object.entries(english)) {
    assert(translated.trim(), key);
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(translated), placeholders(key), key);
  }
  setLocale("en");
  assert.equal(t("移除端点 {value1}？", { value1: "用户模型" }), "Remove endpoint 用户模型?");
  assert.equal(localizeText("文件或文件夹不存在：C:\\用户\\文件.txt"), "File or folder does not exist: C:\\用户\\文件.txt");
  assert.equal(localizeText("工作区路径不能为空"), "Workspace path must not be empty");
  assert.equal(localizeText("这是扩展自定义内容"), "这是扩展自定义内容");
  assert.equal(formatNumber(12345), "12,345");
  assert(formatDate(new Date(2026, 9, 7), { month: "long" }).includes("October"));
  setLocale("zh-CN");
  assert.equal(localizeText("Model IDs must be unique and nonempty"), "模型 ID 不能为空或重复");
  setLocale("invalid");
  assert.equal(getLocale(), "zh-CN");
});
