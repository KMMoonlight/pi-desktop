import test from "node:test";
import assert from "node:assert/strict";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { TerminalEffects } from "../src/terminal-effects.ts";
import { TerminalIO } from "../src/terminal-io.ts";
import {
  parseTerminalEffect,
  type TerminalEffect,
  type TerminalEffectDelivery,
} from "../shared/terminal-effect.ts";
import { DesktopHost } from "../backend/host.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";
import { isConPtyStartupTitle } from "../backend/conpty-startup.ts";

for (const { name, prefix, title = "node.exe", expected, output } of [
  { name: "canonical startup", prefix: "\x1b[2J\x1b[m", expected: true },
  {
    name: "cursor controls between clear and title",
    prefix: "\x1b[?25l\x1b[2J\x1b[m\x1b[H\x1b[?25h",
    expected: true,
  },
  {
    name: "split startup history",
    prefix: ["\x1b[2", "J\x1b[m", "\x1b[1;1H"].join(""),
    expected: true,
  },
  {
    name: "different SDK title",
    prefix: "\x1b[2J\x1b[m",
    title: "Original extension title",
    expected: false,
  },
  {
    name: "title without initialization clear",
    prefix: "\x1b[m",
    expected: false,
  },
  {
    name: "explicit console text before same title",
    prefix: "\x1b[2J\x1b[mOriginal extension output",
    expected: false,
  },
  {
    name: "earlier unrelated OSC",
    prefix: "\x1b[2J\x1b]0;Earlier SDK title\x07",
    expected: false,
  },
  {
    name: "missing executable title frame",
    prefix: "\x1b[2J",
    title: "node.exe",
    expected: false,
    output: "\x1b[2J\x1b]2;node.exe\x07",
  },
])
  test(`ConPTY initialization detection preserves ${name}`, () => {
    assert.equal(
      isConPtyStartupTitle(
        output ?? `${prefix}\x1b]0;node.exe\x07`,
        title,
        "node.exe",
      ),
      expected,
    );
  });
import type { DesktopNode, DesktopSurface } from "../shared/desktop-ui.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Terminal effects did not settle");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
function parser() {
  const handlers = new Map<
    number,
    (data: string) => boolean | Promise<boolean>
  >();
  return {
    handlers,
    terminal: {
      parser: {
        registerOscHandler(
          id: number,
          callback: (data: string) => boolean | Promise<boolean>,
        ) {
          handlers.set(id, callback);
          return { dispose: () => handlers.delete(id) };
        },
      },
    },
    osc(id: number, data: string) {
      return handlers.get(id)?.(data);
    },
  };
}

test("OSC parsing preserves frame order, Unicode, empty clipboard and original size limits", async () => {
  const source = parser();
  const received: {
    effect: TerminalEffect;
    delivery: TerminalEffectDelivery;
  }[] = [];
  const effects = new TerminalEffects(
    source.terminal,
    async (effect, delivery) => {
      received.push({ effect, delivery });
    },
  );
  try {
    effects.begin({ terminalId: "original", sequence: 4 });
    assert.equal(source.osc(0, "Original title"), false);
    source.osc(2, "Second title");
    for (const state of ["1", "2", "3", "4", "0"])
      source.osc(9, `4;${state};50`);
    const text = "\u4e2d\u6587 \ud83d\ude00";
    source.osc(52, `c;${Buffer.from(text).toString("base64")}`);
    source.osc(52, ";");
    source.osc(52, `c;${Buffer.from("x".repeat(75000)).toString("base64")}`);
    for (const invalid of [
      "c;?",
      "p;eA==",
      "c;!",
      "c;/w==",
      `c;${"eA==".repeat(25001)}`,
    ])
      source.osc(52, invalid);
    assert.equal(source.osc(9, "4;8"), false);
    assert.equal(source.osc(9, "3;1"), false);
    effects.end();
    source.osc(52, "c;eA==");
    await tick();
    assert.deepEqual(
      received.map(({ effect }) => effect),
      [
        { type: "title", title: "Original title" },
        { type: "title", title: "Second title" },
        ...[true, true, true, true, false].map((active) => ({
          type: "progress",
          active,
        })),
        { type: "clipboard", text },
        { type: "clipboard", text: "" },
        { type: "clipboard", text: "x".repeat(75000) },
      ],
    );
    assert.deepEqual(
      received.map(({ delivery }) => delivery),
      received.map((_, i) => ({
        terminalId: "original",
        sequence: 4,
        index: i + 1,
      })),
    );
    assert.deepEqual(
      parseTerminalEffect({ type: "clipboard", text: "\u4e2d".repeat(25000) }),
      { type: "clipboard", text: "\u4e2d".repeat(25000) },
    );
    for (const invalid of [
      null,
      { type: "progress", active: 1 },
      { type: "title" },
      { type: "clipboard", text: "\u4e2d".repeat(25001) },
    ])
      assert.throws(
        () => parseTerminalEffect(invalid),
        /Invalid terminal effect/,
      );
  } finally {
    effects.dispose();
  }
  assert.equal(source.handlers.size, 0);
});

test("blocked effect receivers preserve independent parsing and retire queued effects on reset or disposal", async () => {
  const source = parser();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const titles: string[] = [],
    errors: unknown[] = [];
  const effects = new TerminalEffects(
    source.terminal,
    async (effect) => {
      if (effect.type !== "title") return;
      titles.push(effect.title);
      if (effect.title === "blocked") await gate;
      if (effect.title === "failed") throw new Error("Clipboard writer failed");
    },
    (error) => {
      errors.push(error);
    },
  );
  effects.begin({ sequence: 1 });
  source.osc(2, "blocked");
  await tick();
  source.osc(2, "obsolete");
  effects.reset();
  effects.begin({ sequence: 2 });
  source.osc(2, "failed");
  source.osc(2, "recovered");
  effects.end();
  release();
  await tick();
  assert.deepEqual(titles, ["blocked", "failed", "recovered"]);
  assert.equal(errors.length, 1);
  effects.begin({ sequence: 3 });
  source.osc(2, "disposed");
  effects.dispose();
  await tick();
  assert.deepEqual(titles, ["blocked", "failed", "recovered"]);
});

test("terminal resets serialize behind active writes, drop obsolete output and isolate probe effects", async () => {
  const source = parser();
  const frames: string[] = [],
    titles: string[] = [],
    inputs: string[] = [],
    replies: string[] = [];
  let receive!: (data: string) => void, finish!: () => void;
  const terminal = {
    ...source.terminal,
    onData(callback: (data: string) => void) {
      receive = callback;
      return { dispose() {} };
    },
    write(data: string, callback: () => void) {
      frames.push(data);
      source.osc(2, data);
      finish = callback;
    },
    reset() {
      frames.push("reset");
    },
  };
  const effects = new TerminalEffects(terminal, async (effect) => {
    if (effect.type === "title") titles.push(effect.title);
  });
  const io = new TerminalIO(
    terminal,
    (data) => inputs.push(data),
    (id) => replies.push(id),
    effects,
  );
  try {
    io.write("active", { sequence: 1 });
    io.write("obsolete", { sequence: 2 });
    await tick();
    io.query({ id: "probe", data: "obsolete probe" });
    io.reset();
    io.query({ id: "probe", data: "new probe" });
    io.write("new output", { sequence: 3 });
    receive("key");
    finish();
    await tick();
    assert.deepEqual(frames, ["active", "reset", "new probe"]);
    finish();
    await tick();
    finish();
    await tick();
    assert.deepEqual(frames, ["active", "reset", "new probe", "new output"]);
    assert.deepEqual(titles, ["active", "new output"]);
    assert.deepEqual(inputs, ["key"]);
    assert.deepEqual(replies, ["probe"]);
  } finally {
    io.dispose();
  }
});

test("host terminal effects work before initialization and retain clipboard failures and closed-host guards", async () => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  const writes: string[] = [],
    events: any[] = [];
  host.on("event", (event) => events.push(event));
  const effect = (value: TerminalEffect) =>
    host.action({ action: "terminal.effect", args: { effect: value } });
  try {
    host.setClipboard({
      getText: async () => null,
      getImage: async () => null,
      setText: async (text) => {
        writes.push(text);
      },
    });
    await effect({ type: "title", title: "Before initialization" });
    await effect({ type: "progress", active: true });
    await effect({ type: "progress", active: false });
    await effect({ type: "clipboard", text: "" });
    assert.deepEqual(writes, [""]);
    assert.deepEqual(
      events.filter((e) => e.type === "activity").map((e) => [e.name, e.data]),
      [
        ["title", "Before initialization"],
        ["progress", true],
        ["progress", false],
      ],
    );
    host.setClipboard({
      getText: async () => null,
      getImage: async () => null,
    });
    await assert.rejects(
      effect({ type: "clipboard", text: "unavailable" }),
      /clipboard is unavailable/,
    );
    const failure = new Error("Original clipboard rejection");
    host.setClipboard({
      getText: async () => null,
      getImage: async () => null,
      setText: async () => {
        throw failure;
      },
    });
    await assert.rejects(
      effect({ type: "clipboard", text: "failed" }),
      (error) => error === failure,
    );
    await host.dispose();
    await assert.rejects(
      effect({ type: "title", title: "retired" }),
      /Pi .*关闭/,
    );
  } finally {
    await host.dispose();
    await setup.close();
  }
});

function terminalNode(
  surface: DesktopSurface,
): Extract<DesktopNode, { kind: "terminal" }> {
  function find(node: DesktopNode): DesktopNode | undefined {
    if (node.kind === "terminal") return node;
    if ("children" in node) return node.children.map(find).find(Boolean);
    if (node.kind === "region") return find(node.child);
  }
  const node = find(surface.view);
  assert.ok(node?.kind === "terminal");
  return node;
}

test("opaque component effects deduplicate renders, reject retired frames and release only their progress owner", async () => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  const writes: string[] = [];
  try {
    await host.initialize(setup.cwd);
    host.setClipboard({
      getText: async () => null,
      getImage: async () => null,
      setText: async (text) => {
        writes.push(text);
      },
    });
    const ui = host.session.extensionRunner.getUIContext();
    const Text = Reflect.get(await loadTuiApi(), "Text");
    let clearProgress!: () => void;
    ui.setWidget("progress-owner", (tui) => {
      tui.terminal.setProgress(true);
      clearProgress = () => tui.terminal.setProgress(false);
      return new Text("Other owner", 0, 0);
    });
    let data = "Opaque original frame";
    ui.setHeader(() => ({ render: () => [data], invalidate() {} }));
    await until(() => host.desktopUI.surfaces.some((s) => s.slot === "header"));
    const surface = () =>
      host.desktopUI.surfaces.find((s) => s.slot === "header")!;
    const original = surface(),
      node = terminalNode(original);
    const send = (
      s: DesktopSurface,
      n: typeof node,
      index: number,
      effect: TerminalEffect,
    ) =>
      host.action({
        action: "desktop.action",
        args: {
          id: s.id,
          instanceId: s.instanceId,
          action: n.action,
          value: { sequence: n.effectSequence, index, effect },
        },
      });
    await send(original, node, 1, { type: "clipboard", text: "once" });
    await send(original, node, 1, { type: "clipboard", text: "duplicate" });
    assert.equal(terminalNode(surface()).effectSequence, node.effectSequence);
    await send(original, node, 2, { type: "progress", active: true });
    data = "Next opaque frame";
    host.desktopUI.invalidate();
    const next = terminalNode(surface());
    assert.notEqual(next.effectSequence, node.effectSequence);
    await send(original, node, 3, { type: "clipboard", text: "retired data" });
    await send(surface(), next, 1, { type: "clipboard", text: "next" });
    assert.deepEqual(writes, ["once", "next"]);
    ui.setHeader(undefined);
    await until(
      () => !host.desktopUI.surfaces.some((s) => s.slot === "header"),
    );
    assert.equal(host.snapshot().extensionUI.windowProgress, true);
    await send(original, next, 2, {
      type: "clipboard",
      text: "retired instance",
    });
    assert.deepEqual(writes, ["once", "next"]);
    ui.setWidget("progress-owner", undefined);
    assert.equal(host.snapshot().extensionUI.windowProgress, true);
    clearProgress();
    assert.equal(host.snapshot().extensionUI.windowProgress, false);
  } finally {
    await host.dispose();
    await setup.close();
  }
});

test(
  "real supervisor deduplicates OSC deliveries across history replay and rejects invalid output provenance",
  { timeout: 45000 },
  async () => {
    const setup = await createFixture();
    const path = join(setup.agentDir, "desktop", "terminal-effects.mjs");
    await cp(new URL("./fixtures/terminal-effects.mjs", import.meta.url), path);
    const child = spawn(
      process.env.PI_DESKTOP_TEST_NODE ?? process.execPath,
      process.env.PI_DESKTOP_TEST_SERVER
        ? [process.env.PI_DESKTOP_TEST_SERVER]
        : ["--import", "tsx", "backend/server.ts"],
      {
        env: {
          ...process.env,
          PI_DESKTOP_AGENT_DIR: setup.agentDir,
          PI_DESKTOP_PORT: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        cwd: process.env.PI_DESKTOP_TEST_CWD,
      },
    );
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.stdout.resume();
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    try {
      await until(() => /http:\/\/127.0.0.1:\d+/.test(stderr));
      const base = stderr.match(/http:\/\/127.0.0.1:\d+/)![0];
      const { token } = (await (await fetch(base + "/api/token")).json()) as {
        token: string;
      };
      const action = async (action: string, args = {}): Promise<any> => {
        const { data, error } = (await (
          await fetch(base + "/api/action", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-desktop-token": token,
            },
            body: JSON.stringify({ action, args }),
            signal: AbortSignal.timeout(20000),
          })
        ).json()) as { data: unknown; error?: string };
        if (error !== undefined) throw new Error(error);
        return data;
      };
      await action("terminal.snapshot");
      await action("initialize", { cwd: setup.cwd });
      const run = (mode: string) => action("sdk.run", { path, args: { mode } });
      await run("setup");
      await run("direct-title");
      const windows = process.platform === "win32";
      await run(windows ? "raw-initialize" : "raw-start");
      const ready = windows
        ? "ConPTY initialization ready"
        : "Standalone terminal ready";
      let state = await action("terminal.snapshot");
      const deadline = Date.now() + 15000;
      while (
        !state.chunks
          .map((chunk: { data: string }) => chunk.data)
          .join("")
          .includes(ready)
      ) {
        assert.ok(Date.now() < deadline, "No PTY output received");
        await tick();
        state = await action("terminal.snapshot");
      }
      const deliverEffect = (
        index: number,
        effect: TerminalEffect,
        overrides = {},
      ) =>
        action("terminal.effect", {
          terminalId: state.terminalId,
          sequence: state.sequence,
          index,
          effect,
          ...overrides,
        });
      if (windows) {
        const node = process.env.PI_DESKTOP_TEST_NODE ?? process.execPath;
        let output = "";
        const startup = state.chunks.find((chunk: { data: string }) => {
          output += chunk.data;
          return output.includes(`\x1b]0;${node}\x07`);
        });
        assert.ok(
          startup,
          `Expected the actual ConPTY initialization title; observed ${JSON.stringify(
            state.chunks
              .map((chunk: { data: string }) => chunk.data)
              .join("")
              .slice(0, 2000),
          )}`,
        );
        await deliverEffect(
          1,
          { type: "title", title: node },
          { sequence: startup.sequence },
        );
        assert.equal(
          (await action("snapshot")).extensionUI.windowTitle,
          "Direct SDK window title",
        );
        await deliverEffect(
          2,
          { type: "title", title: node },
          { sequence: startup.sequence },
        );
        assert.equal((await action("snapshot")).extensionUI.windowTitle, node);
        await run("raw-start");
        do {
          assert.ok(
            Date.now() < deadline,
            "No explicit terminal output received",
          );
          state = await action("terminal.snapshot");
        } while (
          !state.chunks
            .map((chunk: { data: string }) => chunk.data)
            .join("")
            .includes("Standalone terminal ready")
        );
      }
      const deliver = (index: number, text: string, overrides = {}) =>
        deliverEffect(index, { type: "clipboard", text }, overrides);
      await deliver(3, "original");
      await deliver(3, "duplicate");
      await deliver(4, "next");
      await deliver(1, "old terminal", { terminalId: "retired" });
      await assert.rejects(
        deliver(5, "future", { sequence: state.sequence + 100 }),
        /Invalid terminal effect delivery/,
      );
      await assert.rejects(
        deliver(5, "bad index", { index: 0 }),
        /Invalid terminal effect delivery/,
      );
      assert.deepEqual((await run("inspect")).writes, [
        { length: 8, text: "original" },
        { length: 4, text: "next" },
      ]);
      await run("raw-stop");
      await run("cleanup");
      await action("shutdown");
      await exited;
      assert.equal(child.exitCode, 0, stderr);
    } finally {
      if (child.exitCode === null) child.kill();
      await exited;
      await setup.close();
    }
  },
);
