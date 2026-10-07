import test from "node:test";
import assert from "node:assert/strict";
import { subscribeWithDialogReplay } from "../src/dialog-replay.ts";
import type { DesktopEvent, DialogRequest } from "../shared/types.ts";

test("native dialog replay reconciles opens and closes during a stale list response", async () => {
  let receive!: (event: DesktopEvent) => void;
  let finish!: (dialogs: DialogRequest[]) => void;
  let stopped = 0;
  const output: DesktopEvent[] = [];
  const stale: DialogRequest = {
    id: "old",
    kind: "input",
    title: "Old",
    expiresAt: 1000,
  };
  const next: DialogRequest = {
    id: "new",
    kind: "confirm",
    title: "New",
    expiresAt: 2000,
  };
  const subscription = subscribeWithDialogReplay(
    async (handler) => {
      receive = handler;
      return () => {
        stopped++;
      };
    },
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    (event) => output.push(event),
  );
  await Promise.resolve();
  receive({ type: "dialog_closed", id: stale.id });
  receive({ type: "dialog", data: next });
  receive({ type: "activity", name: "unrelated" });
  finish([stale]);
  const stop = await subscription;
  assert.deepEqual(output, [
    { type: "activity", name: "unrelated" },
    { type: "dialog", data: next },
  ]);
  receive({ type: "dialog_closed", id: next.id });
  assert.deepEqual(output.at(-1), { type: "dialog_closed", id: next.id });
  stop();
  assert.equal(stopped, 1);
});

test("native dialog replay deduplicates existing dialogs and releases failed subscriptions", async () => {
  const dialog: DialogRequest = { id: "same", kind: "input", title: "Same" };
  const output: DesktopEvent[] = [];
  await subscribeWithDialogReplay(
    async (handler) => {
      handler({ type: "dialog", data: dialog });
      return () => {};
    },
    async () => [dialog],
    (event) => output.push(event),
  );
  assert.deepEqual(output, [{ type: "dialog", data: dialog }]);
  let stopped = false;
  const error = new Error("read failed");
  await assert.rejects(
    subscribeWithDialogReplay(
      async () => () => {
        stopped = true;
      },
      async () => {
        throw error;
      },
      () => {},
    ),
    (actual) => actual === error,
  );
  assert.equal(stopped, true);
});
