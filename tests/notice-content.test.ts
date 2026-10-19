import test from "node:test";
import assert from "node:assert/strict";
import { retryNoticeSummary } from "../src/notice-content.ts";

test("retry summaries use HTTP status while preserving untrusted diagnostics separately", () => {
  assert.deepEqual(
    retryNoticeSummary(
      '503 {"title":"Error 1102: Worker exceeded resource limits"}',
    ),
    {
      title: "服务暂时不可用",
      status: 503,
    },
  );
  assert.deepEqual(retryNoticeSummary('HTTP 429: {"error":"rate limit"}'), {
    title: "请求过于频繁",
    status: 429,
  });
  assert.deepEqual(retryNoticeSummary('{"status":403,"detail":"Forbidden"}'), {
    title: "请求被服务拒绝",
    status: 403,
  });
  for (const message of [
    "Connection reset",
    '5030 {"status":503}',
    '{"status":200,"title":"503"}',
    '{"status":503.5}',
    '{"status":503',
    'Request id 503: <script>alert("503")</script>',
  ])
    assert.deepEqual(retryNoticeSummary(message), {
      title: "请求暂时失败",
      status: undefined,
    });
});
