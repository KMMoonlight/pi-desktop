import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";

test("dialog timeout follows Pi's rounded positive countdown and exposes its original deadline", async (t) => {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout", "setInterval"],
    now: 10000,
  });
  const host = new DesktopHost();
  try {
    const result = host.ask({ kind: "input", title: "Timed", timeout: 1500 });
    const dialog = host.pendingDialogs[0];
    assert.equal(Reflect.get(dialog, "expiresAt"), 12000);
    t.mock.timers.tick(1500);
    assert.equal(host.pendingDialogs.length, 1);
    t.mock.timers.tick(500);
    assert.equal(await result, undefined);
    assert.equal(host.pendingDialogs.length, 0);
  } finally {
    await host.dispose();
  }
});

test("non-positive dialog timeouts do not expire", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] });
  const host = new DesktopHost();
  try {
    for (const timeout of [undefined, 0, -100]) {
      const result = host.ask({ kind: "select", title: "Untimed", timeout });
      const dialog = host.pendingDialogs[0];
      assert.equal(Reflect.get(dialog, "expiresAt"), undefined);
      t.mock.timers.tick(10000);
      assert.equal(host.pendingDialogs.length, 1);
      host.answer(dialog.id, "chosen");
      assert.equal(await result, "chosen");
    }
  } finally {
    await host.dispose();
  }
});

test("dialog cancellation and early answer release the timer and ignore late responses", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] });
  const host = new DesktopHost();
  const closed: string[] = [];
  host.on("event", (event) => {
    if (event.type === "dialog_closed") closed.push(event.id);
  });
  try {
    const controller = new AbortController();
    const first = host.ask(
      { kind: "confirm", title: "Abort", timeout: 2000 },
      controller.signal,
    );
    const firstId = host.pendingDialogs[0].id;
    controller.abort();
    assert.equal(await first, undefined);
    const second = host.ask({ kind: "input", title: "Answer", timeout: 2000 });
    const secondId = host.pendingDialogs[0].id;
    host.answer(secondId, "kept");
    t.mock.timers.tick(3000);
    host.answer(firstId, true);
    assert.equal(await second, "kept");
    assert.deepEqual(closed, [firstId, secondId]);
    assert.equal(
      await host.ask(
        { kind: "input", title: "Pre-aborted" },
        controller.signal,
      ),
      undefined,
    );
    assert.equal(host.pendingDialogs.length, 0);
  } finally {
    await host.dispose();
  }
});
