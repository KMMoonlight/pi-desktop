import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { TerminalPresentationPipeline } from "../backend/terminal-presentation.ts";
import { createDetachedTui } from "../backend/detached-tui.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";
import { callComponentMethod } from "../backend/component-runtime.ts";

async function fixture() {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  await host.initialize(files.cwd);
  const Text = Reflect.get(await loadTuiApi(), "Text");
  async function mount(id: string, setup: (tui: DesktopTui) => void) {
    let tui!: DesktopTui;
    await host.desktopUI.mount(
      (value: DesktopTui) => {
        tui = value;
        setup(tui);
        return new Text(id);
      },
      "header",
      id,
    );
    return tui;
  }
  return {
    host,
    mount,
    async close() {
      await host.dispose();
      await files.close();
    },
  };
}
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check());
}

test("cursor and shrink flags share one generation across current and retired factory handles", async () => {
  const f = await fixture();
  try {
    const first = await f.mount("first", (tui) => {
      tui.setShowHardwareCursor(true);
      tui.setClearOnShrink(true);
    });
    const second = await f.mount("second", () => {});
    assert.equal(second.getShowHardwareCursor(), true);
    assert.equal(second.getClearOnShrink(), true);
    f.host.desktopUI.close("first");
    first.setShowHardwareCursor(false);
    first.setClearOnShrink(false);
    assert.equal(second.getShowHardwareCursor(), false);
    assert.equal(second.getClearOnShrink(), false);
    await f.host.action({ action: "resources.reload" });
    const next = await f.mount("next", () => {});
    assert.equal(next, first);
    assert.equal(
      next.getShowHardwareCursor(),
      f.host.session.settingsManager.getShowHardwareCursor(),
    );
    assert.equal(
      next.getClearOnShrink(),
      f.host.session.settingsManager.getClearOnShrink(),
    );
    first.setShowHardwareCursor(true);
    first.setClearOnShrink(true);
    assert.equal(next.getShowHardwareCursor(), true);
    assert.equal(next.getClearOnShrink(), true);
  } finally {
    await f.close();
  }
});

test("shared color notifications retain original live Set ordering, duplicates and callback receivers", async () => {
  const listeners: ((scheme: "light" | "dark") => void)[] = [];
  const pipeline = new TerminalPresentationPipeline({
    settings: () => ({ cursor: false, clearOnShrink: false }),
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {};
    },
    query: async () => ({}),
    title() {},
    progress() {},
  });
  const first = await createDetachedTui(() => {});
  const second = await createDetachedTui(() => {});
  const scope = pipeline.capture();
  const detachFirst = scope.bind(first);
  const detachSecond = scope.bind(second);
  const calls: string[] = [];
  const late = function (this: unknown, scheme: string) {
    assert.equal(this, undefined);
    calls.push(`late:${scheme}`);
  };
  const removed = () => calls.push("removed");
  const remove = second.onTerminalColorSchemeChange(removed);
  first.onTerminalColorSchemeChange((scheme) => {
    calls.push(`first:${scheme}`);
    remove();
    second.onTerminalColorSchemeChange(late);
    second.onTerminalColorSchemeChange(late);
  });
  first.setTerminalColorSchemeNotifications(true);
  assert.equal(listeners.length, 1);
  listeners[0]("dark");
  assert.deepEqual(calls, ["removed", "first:dark", "late:dark"]);
  second.setTerminalColorSchemeNotifications(false);
  listeners[0]("light");
  assert.equal(calls.length, 3);
  detachFirst();
  detachSecond();
  first.setTerminalColorSchemeNotifications(true);
  listeners[0]("light");
  assert.deepEqual(calls.slice(3), ["first:light", "late:light"]);
  pipeline.reset();
  listeners[0]("dark");
  assert.equal(calls.length, 5);
  assert.equal(remove(), undefined);
});

test("shared flags, live color listeners and window writes match the original native TUI", async () => {
  const api = await loadTuiApi();
  const traces: unknown[][] = [];
  for (const shared of [false, true]) {
    const trace: unknown[] = [];
    traces.push(trace);
    let report!: (scheme: "light" | "dark") => void;
    const native = await createDetachedTui(() => {}, undefined, {
      setTitle: (value) => trace.push(["title", value]),
      setProgress: (value) => trace.push(["progress", value]),
    });
    if (shared) {
      const pipeline = new TerminalPresentationPipeline({
        settings: () => ({ cursor: false, clearOnShrink: false }),
        subscribe: (listener) => {
          report = listener;
          return () => {};
        },
        query: async () => ({}),
        title: (value) => trace.push(["title", value]),
        progress: (_owner, value) => trace.push(["progress", value]),
      });
      pipeline.capture().bind(native);
      native.setTerminalColorSchemeNotifications(true);
    } else {
      native.onTerminalColorSchemeChange = Reflect.get(
        api.TuiMainScreen.prototype,
        "onTerminalColorSchemeChange",
      ).bind(native);
      report = (scheme) => {
        callComponentMethod(
          native,
          "consumeTerminalColorSchemeReport",
          `\x1b[?997;${scheme === "dark" ? 1 : 2}n`,
        );
      };
    }
    const inserted = function (this: unknown, scheme: string) {
      trace.push(["inserted", scheme, this === undefined]);
    };
    const removed = () => trace.push(["removed"]);
    let remove!: () => void;
    native.onTerminalColorSchemeChange((scheme) => {
      trace.push(["first", scheme]);
      remove();
      native.onTerminalColorSchemeChange(inserted);
    });
    remove = native.onTerminalColorSchemeChange(removed);
    native.onTerminalColorSchemeChange(inserted);
    native.onTerminalColorSchemeChange(inserted);
    native.setShowHardwareCursor(true);
    native.setClearOnShrink(true);
    trace.push([
      "flags",
      native.getShowHardwareCursor(),
      native.getClearOnShrink(),
    ]);
    report("dark");
    report("light");
    trace.push(["unsubscribe", remove()]);
    native.terminal.setTitle("First");
    native.terminal.setTitle("Last");
    native.terminal.setProgress(true);
    native.terminal.setProgress(false);
  }
  assert.deepEqual(traces[1], traces[0]);
});

test("color listeners survive successful and failed factories until explicit removal or generation reset", async () => {
  const f = await fixture();
  const calls: string[] = [];
  let off!: () => void;
  try {
    const first = await f.mount("first", (tui) => {
      off = tui.onTerminalColorSchemeChange((scheme) =>
        calls.push(`first:${scheme}`),
      );
      tui.setTerminalColorSchemeNotifications(true);
    });
    const second = await f.mount("second", () => {});
    f.host.desktopUI.close("first");
    await f.host.action({
      action: "desktop.appearance",
      args: { appearance: "dark" },
    });
    assert.deepEqual(calls, ["first:dark"]);
    await assert.rejects(
      f.mount("failed", (tui) => {
        tui.onTerminalColorSchemeChange((scheme) =>
          calls.push(`failed:${scheme}`),
        );
        throw new Error("original failure");
      }),
      /original failure/,
    );
    second.setTerminalColorSchemeNotifications(false);
    await f.host.action({
      action: "desktop.appearance",
      args: { appearance: "light" },
    });
    assert.equal(calls.length, 1);
    first.setTerminalColorSchemeNotifications(true);
    off();
    await f.host.action({
      action: "desktop.appearance",
      args: { appearance: "dark" },
    });
    assert.deepEqual(calls, ["first:dark", "failed:dark"]);
    f.host.desktopUI.clearSurfaces();
    first.onTerminalColorSchemeChange(() => calls.push("retired"));
    first.setTerminalColorSchemeNotifications(true);
    await f.host.action({
      action: "desktop.appearance",
      args: { appearance: "light" },
    });
    assert.equal(calls.length, 2);
  } finally {
    await f.close();
  }
});

test("an old color unsubscribe cannot remove an identical new-generation callback", async () => {
  const f = await fixture();
  let hits = 0;
  const listener = () => hits++;
  let oldOff!: () => void;
  try {
    await f.mount("old", (tui) => {
      oldOff = tui.onTerminalColorSchemeChange(listener);
    });
    f.host.desktopUI.clearSurfaces();
    const next = await f.mount("next", (tui) => {
      tui.onTerminalColorSchemeChange(listener);
      tui.setTerminalColorSchemeNotifications(true);
    });
    oldOff();
    await f.host.action({
      action: "desktop.appearance",
      args: { appearance: "dark" },
    });
    assert.equal(hits, 1);
    next.setTerminalColorSchemeNotifications(false);
  } finally {
    await f.close();
  }
});

test("window setters share last-writer progress and stay callable after their factory retires", async () => {
  const f = await fixture();
  try {
    const first = await f.mount("first", (tui) =>
      tui.terminal.setProgress(true),
    );
    const second = await f.mount("second", () => {});
    assert.equal(f.host.snapshot().extensionUI.windowProgress, true);
    second.terminal.setProgress(false);
    assert.equal(f.host.snapshot().extensionUI.windowProgress, false);
    first.terminal.setProgress(true);
    f.host.desktopUI.close("first");
    assert.equal(f.host.snapshot().extensionUI.windowProgress, true);
    first.terminal.setTitle("Still active generation");
    assert.equal(
      f.host.snapshot().extensionUI.windowTitle,
      "Still active generation",
    );
    second.terminal.setProgress(false);
    f.host.desktopUI.clearSurfaces();
    first.terminal.setTitle("Retired generation");
    first.terminal.setProgress(true);
    assert.equal(
      f.host.snapshot().extensionUI.windowTitle,
      "Still active generation",
    );
    assert.equal(f.host.snapshot().extensionUI.windowProgress, false);
  } finally {
    await f.close();
  }
});

test("global progress reset retains independent opaque or PTY progress owners", async () => {
  const f = await fixture();
  const owner = {};
  try {
    const tui = await f.mount("first", (value) =>
      value.terminal.setProgress(true),
    );
    await f.host.applyTerminalEffect({ type: "progress", active: true }, owner);
    tui.terminal.setProgress(false);
    assert.equal(f.host.snapshot().extensionUI.windowProgress, true);
    f.host.desktopUI.clearSurfaces();
    assert.equal(f.host.snapshot().extensionUI.windowProgress, true);
    await f.host.applyTerminalEffect(
      { type: "progress", active: false },
      owner,
    );
    assert.equal(f.host.snapshot().extensionUI.windowProgress, false);
  } finally {
    await f.close();
  }
});

test("color queries survive factory retirement, preserve partial results and deliver late replies", async () => {
  const f = await fixture();
  const late: unknown[] = [];
  try {
    const tui = await f.mount("query", () => {});
    const reads: PropertyKey[] = [];
    const options = {
      timeoutMs: 100,
      onLateReply: function (this: unknown, colors: unknown) {
        assert.equal(this, undefined);
        late.push(colors);
      },
    };
    const query = tui.queryTerminalColors(
      new Proxy(options, {
        get(target, key, receiver) {
          reads.push(key);
          return Reflect.get(target, key, receiver);
        },
      }),
    );
    assert.deepEqual(reads, ["timeoutMs", "onLateReply"]);
    options.timeoutMs = 10000;
    options.onLateReply = () =>
      assert.fail("Options must be captured at call entry");
    await until(() => f.host.terminalQueries.requests.length === 1);
    const request = f.host.terminalQueries.requests[0];
    f.host.terminalQueries.reply(request.id, ["\x1b]10;#123456\x07"]);
    f.host.desktopUI.close("query");
    const partial = await query;
    assert.deepEqual(partial.foreground, { r: 18, g: 52, b: 86 });
    assert.equal(f.host.terminalQueries.requests.length, 1);
    f.host.terminalQueries.reply(request.id, [
      "\x1b]11;#abcdef\x07",
      "\x1b[?1;2c",
    ]);
    assert.deepEqual(late, [
      { ...partial, background: { r: 171, g: 205, b: 239 } },
    ]);
    assert.equal(f.host.terminalQueries.requests.length, 0);
  } finally {
    await f.close();
  }
});

test("generation reset settles pending color queries and rejects old late callbacks and new queries", async () => {
  const f = await fixture();
  let late = 0;
  try {
    const tui = await f.mount("query", () => {});
    const query = tui.queryTerminalColors({
      timeoutMs: 10000,
      onLateReply: () => late++,
    });
    await until(() => f.host.terminalQueries.requests.length === 1);
    const request = f.host.terminalQueries.requests[0];
    f.host.desktopUI.clearSurfaces();
    await query;
    assert.equal(f.host.terminalQueries.requests.length, 0);
    assert.equal(
      f.host.terminalQueries.reply(request.id, [
        "\x1b]10;#ffffff\x07",
        "\x1b[?1;2c",
      ]),
      false,
    );
    assert.deepEqual(await tui.queryTerminalColors({ timeoutMs: 1000 }), {});
    assert.equal(late, 0);
  } finally {
    await f.close();
  }
});
