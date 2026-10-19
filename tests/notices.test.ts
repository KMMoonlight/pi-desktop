import test from "node:test";
import assert from "node:assert/strict";
import { enqueueNotice } from "../shared/notices.ts";
import type { DesktopEvent } from "../shared/types.ts";

type Notice = Extract<DesktopEvent, { type: "notice" }>;
const problem = (ray: string): Notice => ({
  type: "notice",
  level: "warning",
  message: `503 ${JSON.stringify({ status: 503, title: "Worker exceeded resource limits", ray_id: ray })}`,
});

test("each provider error retains its own full diagnostics in arrival order", () => {
  const first = problem("first request"),
    latest = problem("second request");
  const initial = enqueueNotice([], first, 20);
  assert.deepEqual(enqueueNotice(initial, latest, 20), [first, latest]);
  assert.deepEqual(initial, [first]);
});

test("identical ordinary notices are separate cards without occurrence counters", () => {
  const info: Notice = { type: "notice", level: "info", message: "Copied" };
  assert.deepEqual(enqueueNotice([info], { ...info }, 20), [info, info]);
});

test("the bounded queue removes only its oldest card when full", () => {
  const first = problem("first"),
    second = problem("second"),
    third = problem("third");
  assert.deepEqual(enqueueNotice([first, second], third, 2), [second, third]);
});

test("retry progress updates its own card while retaining individual ordinary notices", () => {
  const first = problem("first");
  const retry = {
    ...first,
    retry: { attempt: 1, maxAttempts: 3, errorMessage: first.message },
  };
  const next = {
    ...problem("second"),
    retry: { ...retry.retry, attempt: 2, errorMessage: "429 Rate limited" },
  };
  assert.deepEqual(enqueueNotice([first, retry], next, 20), [first, next]);
});
