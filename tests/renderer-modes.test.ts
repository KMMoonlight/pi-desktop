import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { RendererTerminal } from "../backend/renderer-terminal.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import {
  loadComponentRuntime,
  componentField,
  componentFocus,
  callComponentMethod,
} from "../backend/component-runtime.ts";
import { createFixture } from "./fixture.ts";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 45));
async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Native renderer state did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function physical(geometry = { columns: 80, rows: 20 }) {
  const writes: string[] = [];
  const lifecycle: string[] = [];
  const terminal: DesktopTui["terminal"] = {
    get columns() {
      return geometry.columns;
    },
    get rows() {
      return geometry.rows;
    },
    kittyProtocolActive: false,
    start() {
      lifecycle.push("start");
    },
    stop() {
      lifecycle.push("stop");
    },
    drainInput: async () => {},
    write: (data) => writes.push(data),
    moveBy: (n) => writes.push(`\x1b[${Math.abs(n)}${n > 0 ? "B" : "A"}`),
    hideCursor: () => writes.push("\x1b[?25l"),
    showCursor: () => writes.push("\x1b[?25h"),
    clearLine: () => writes.push("\x1b[2K"),
    clearFromCursor: () => writes.push("\x1b[J"),
    clearScreen: () => writes.push("\x1b[2J\x1b[H"),
    setTitle: (s) => lifecycle.push(`title:${s}`),
    setProgress: (s) => lifecycle.push(`progress:${s}`),
  };
  return { terminal, writes, lifecycle, geometry };
}
async function fixture(fullscreen = false) {
  const files = await createFixture();
  if (fullscreen) {
    const path = join(files.agentDir, "settings.json");
    await writeFile(
      path,
      JSON.stringify({
        ...JSON.parse(await readFile(path, "utf8")),
        tuiMode: "fullscreen",
      }),
    );
  }
  const host = new DesktopHost(files.agentDir);
  await host.initialize(files.cwd);
  const scope = host.desktopUI.terminalRuntime.capture();
  const api = await loadTuiApi();
  const runtime = await loadComponentRuntime();
  const Text = Reflect.get(api, "Text");
  return {
    files,
    host,
    scope,
    api,
    runtime,
    Text,
    close: async () => {
      await host.dispose();
      await files.close();
    },
  };
}

for (const mode of ["regular", "fullscreen"] as const)
  test(`native ${mode} drawing, scheduling, force and stop options match original Pi`, async () => {
    const f = await fixture();
    const regular = physical(),
      raw = physical();
    const drawing: string[] = [];
    const driver = new RendererTerminal(raw.terminal, raw.geometry, (s) =>
      drawing.push(s),
    );
    const create = (terminal: DesktopTui["terminal"]) =>
      f.runtime.interactive.createInteractiveTui({
        tuiMode: mode,
        terminal,
        showHardwareCursor: true,
        logDirectory: f.files.agentDir,
      });
    const native = create(regular.terminal),
      desktop = create(driver.terminal);
    let frames = 0;
    driver.bind(
      desktop,
      () => frames++,
      () => true,
    );
    const texts = [native, desktop].map((tui) => {
      const text = new f.Text("Original native renderer", 0, 0);
      tui.addChild(text);
      return text;
    });
    const compare = () => {
      assert.deepEqual(drawing, regular.writes);
      assert.equal(desktop.fullRedraws, native.fullRedraws);
      if (mode === "regular")
        assert.deepEqual(
          callComponentMethod(desktop, "captureRenderState"),
          callComponentMethod(native, "captureRenderState"),
        );
      else
        assert.deepEqual(
          callComponentMethod(desktop, "getScreenLines"),
          callComponentMethod(native, "getScreenLines"),
        );
      assert.deepEqual(raw.writes, []);
      assert.deepEqual(raw.lifecycle, []);
    };
    try {
      native.start();
      driver.run(() => desktop.start());
      native.renderNow();
      desktop.renderNow();
      compare();
      assert.ok(native.fullRedraws > 0);
      for (const text of texts) text.setText("A changed frame");
      native.renderNow();
      desktop.renderNow();
      compare();
      const before = frames;
      for (let i = 0; i < 40; i++) {
        native.requestRender();
        desktop.requestRender();
      }
      await settle();
      compare();
      assert.equal(frames, before + 1);
      native.requestRender(true);
      desktop.requestRender(true);
      await settle();
      compare();
      assert.ok(native.fullRedraws >= 2);
      native.renderNow(true);
      desktop.renderNow(true);
      compare();
      native.stop({ preserveScreen: true });
      driver.run(() => desktop.stop({ preserveScreen: true }));
      compare();
      const stoppedFrames = frames;
      native.requestRender(true);
      desktop.requestRender(true);
      await settle();
      compare();
      assert.equal(frames, stoppedFrames);
      native.start();
      driver.run(() => desktop.start());
      native.renderNow();
      desktop.renderNow();
      compare();
      native.stop();
      driver.run(() => desktop.stop());
      compare();
    } finally {
      native.stop({ preserveScreen: true });
      driver.run(() => desktop.stop({ preserveScreen: true }));
      await f.close();
    }
  });

test("direct terminal calls use physical ownership and async callbacks leave the drawing lease", async () => {
  const raw = physical();
  const drawing: string[] = [];
  const driver = new RendererTerminal(
    raw.terminal,
    { columns: 33, rows: 8 },
    (s) => drawing.push(s),
  );
  const terminal = driver.terminal;
  assert.equal(terminal.columns, 80);
  driver.run(() => {
    assert.equal(terminal.columns, 33);
    terminal.start(
      () => {},
      () => {},
    );
    terminal.write("Internal frame");
    terminal.stop();
  });
  assert.deepEqual(raw.lifecycle, []);
  assert.deepEqual(drawing, ["Internal frame"]);
  await driver.run(async () => {
    await Promise.resolve();
    terminal.write("Async extension output");
  });
  terminal.start(
    () => {},
    () => {},
  );
  terminal.write("Raw extension output");
  terminal.stop();
  assert.deepEqual(raw.writes, [
    "Async extension output",
    "Raw extension output",
  ]);
  assert.deepEqual(raw.lifecycle, ["start", "stop"]);
});

for (const initial of ["regular", "fullscreen"] as const)
  test(`settings initialize ${initial} and switching preserves shared originals and stored methods`, async () => {
    const f = await fixture(initial === "fullscreen");
    try {
      const tui = f.scope.tui,
        terminal = tui.terminal,
        roots = [...tui.children];
      const editor = f.host.desktopUI.nativeComponent("editor")!;
      const app = f.scope.application!,
        provider = app.footerData;
      tui.setFocus(editor);
      tui.renderNow(true);
      assert.equal(tui.mode, initial);
      const request = tui.requestRender,
        render = tui.renderNow,
        add = tui.addChild;
      tui.setShowHardwareCursor(true);
      tui.setClearOnShrink(true);
      const extra = new f.Text("Persistent renderer child");
      add(extra);
      const identity = f.host.desktopUI.surfaces.find(
        (s) => s.id === "tui:registrations",
      )!.instanceId;
      let disposed = 0;
      extra.dispose = () => disposed++;
      for (const mode of [
        "fullscreen",
        "regular",
        "fullscreen",
        "regular",
      ] as const) {
        assert.equal(f.scope.switchMode(mode), true);
        render(true);
        request(true);
        await settle();
        assert.equal(tui.mode, mode);
        assert.equal(tui.terminal, terminal);
        assert.deepEqual(tui.children, [...roots, extra]);
        assert.equal(componentFocus(tui), editor);
        assert.equal(f.scope.application, app);
        assert.equal(app.footerData, provider);
        assert.equal(tui.getShowHardwareCursor(), true);
        assert.equal(tui.getClearOnShrink(), true);
        assert.ok(tui.fullRedraws > 0);
        assert.equal(disposed, 0);
        assert.equal(
          f.host.desktopUI.surfaces.find((s) => s.id === "tui:registrations")!
            .instanceId,
          identity,
        );
      }
      tui.removeChild(extra);
      render();
      assert.equal(disposed, 1);
    } finally {
      await f.close();
    }
  });

test("visible, hidden and conditional overlays reject mode switching like original InteractiveMode", async () => {
  const f = await fixture();
  const raw = physical();
  const native = f.runtime.interactive.createInteractiveTui({
    tuiMode: "regular",
    terminal: raw.terminal,
    showHardwareCursor: false,
    logDirectory: f.files.agentDir,
  });
  try {
    for (const hidden of ["visible", "hidden", "conditional"] as const) {
      const options =
        hidden === "conditional" ? { visible: () => false } : undefined;
      const actual = f.scope.tui.showOverlay(
        new f.api.Input({ prompt: "Guarded overlay" }),
        options,
      );
      const expected = native.showOverlay(new f.api.Input(), options);
      if (hidden === "hidden") {
        actual.setHidden(true);
        expected.setHidden(true);
      }
      const nativeResult = Reflect.apply(
        Reflect.get(InteractiveMode.prototype, "switchTuiMode"),
        { renderer: native },
        ["fullscreen"],
      );
      assert.equal(f.scope.switchMode("fullscreen"), nativeResult);
      assert.equal(f.scope.tui.mode, "regular");
      assert.equal(f.scope.switchMode("regular"), true);
      actual.hide();
      expected.hide();
    }
    assert.equal(f.scope.switchMode("fullscreen"), true);
  } finally {
    native.stop({ preserveScreen: true });
    await f.close();
  }
});

test("mode replacement drops direct input hooks, rebinds context hooks, retains debug and isolates old unsubscribe", async () => {
  const f = await fixture();
  try {
    const tui = f.scope.tui;
    let direct = 0,
      context = 0,
      debug = 0;
    const listener = () => {
      direct++;
      return undefined;
    };
    const oldOff = tui.addInputListener(listener);
    const contextOff = f.host.session.extensionRunner
      .getUIContext()
      .onTerminalInput(() => {
        context++;
        return undefined;
      });
    tui.onDebug = () => debug++;
    await f.host.desktopUI.input("editor", "x");
    assert.equal(direct, 1);
    assert.equal(context, 1);
    f.scope.switchMode("fullscreen");
    await f.host.desktopUI.input("editor", "y");
    assert.equal(direct, 1);
    assert.equal(context, 2);
    tui.addInputListener(listener);
    oldOff();
    await f.host.desktopUI.input("editor", "z");
    assert.equal(direct, 2);
    assert.equal(context, 3);
    await f.host.desktopUI.input("editor", "\x1b[100;6u");
    assert.equal(debug, 1);
    contextOff();
    tui.removeInputListener(listener);
    await f.host.desktopUI.input("editor", "w");
    assert.equal(context, 4);
    assert.equal(direct, 3);
  } finally {
    await f.close();
  }
});

test("original fullscreen viewport hook consumes scroll/search keys before extensions exactly once", async () => {
  const f = await fixture();
  const raw = physical({ columns: 120, rows: 40 });
  const native = f.runtime.interactive.createInteractiveTui({
    tuiMode: "fullscreen",
    terminal: raw.terminal,
    showHardwareCursor: false,
    logDirectory: f.files.agentDir,
  });
  try {
    const text = Array.from({ length: 180 }, (_, n) => `Transcript ${n}`).join(
      "\n",
    );
    native.addChild(new f.Text(text));
    const roots = f.scope.tui.children;
    const document = roots[0]!;
    const content = componentField(document, "children") as object[];
    const message = content[2]!;
    const original = new f.Text(text);
    callComponentMethod(message, "addChild", original);
    f.scope.switchMode("fullscreen");
    native.start();
    native.renderNow();
    f.scope.tui.renderNow();
    let desktopHooks = 0,
      nativeHooks = 0;
    f.scope.tui.addInputListener(() => {
      desktopHooks++;
      return undefined;
    });
    native.addInputListener(() => {
      nativeHooks++;
      return undefined;
    });
    const keys = [
      "\x1b[5~",
      "\x1b[6~",
      "\x1b[1;5H",
      "\x1b[1;5F",
      "x",
      "\x1b[100;6u",
    ];
    for (const data of keys) {
      callComponentMethod(native, "handleTerminalInput", data);
      await f.host.desktopUI.input("editor", data);
      native.renderNow();
      f.scope.tui.renderNow();
      assert.equal(desktopHooks, nativeHooks);
    }
    assert.ok(desktopHooks < keys.length);
    callComponentMethod(message, "removeChild", original);
  } finally {
    native.stop({ preserveScreen: true });
    await f.close();
  }
});

test("SDK fullscreen APIs use real geometry, follow/scroll/search state and settings", async () => {
  const f = await fixture();
  try {
    const settings = f.host.session.settingsManager;
    settings.setTuiMode("fullscreen");
    settings.setFullscreenCopyOnSelect(false);
    settings.setFullscreenScrollbar("always");
    settings.setFullscreenWheelScrollLines(3);
    f.scope.applySettings();
    f.host.desktopUI.setViewport(48, 12);
    const message = (
      componentField(f.scope.tui.children[0]!, "children") as object[]
    )[2]!;
    const text = new f.Text(
      Array.from({ length: 100 }, (_, n) => `Frame row ${n}`).join("\n"),
    );
    callComponentMethod(message, "addChild", text);
    f.scope.tui.renderNow(true);
    const lines = callComponentMethod(
      f.scope.tui,
      "getScreenLines",
    ) as string[];
    assert.equal(lines.length, 12);
    assert.ok(lines.some((s) => s.includes("Frame row 99")));
    assert.equal(callComponentMethod(f.scope.tui, "getCopyOnSelect"), false);
    callComponentMethod(f.scope.tui, "scrollToTop");
    f.scope.tui.renderNow();
    assert.equal(componentField(f.scope.tui, "viewportTop"), 0);
    assert.equal(componentField(f.scope.tui, "isFollowingOutput"), false);
    callComponentMethod(f.scope.tui, "scrollToBottom");
    f.scope.tui.renderNow();
    assert.equal(componentField(f.scope.tui, "isFollowingOutput"), true);
    f.host.desktopUI.setViewport(63, 17);
    await until(
      () =>
        (callComponentMethod(f.scope.tui, "getScreenLines") as string[])
          .length === 17,
    );
    assert.equal(
      (callComponentMethod(f.scope.tui, "getScreenLines") as string[]).length,
      17,
    );
    callComponentMethod(message, "removeChild", text);
  } finally {
    await f.close();
  }
});

for (const policy of ["transcript", "resume-hint"] as const)
  test(`fullscreen ${policy} exit stops original renderer and retires timer work`, async () => {
    const f = await fixture(true);
    try {
      f.host.session.settingsManager.setFullscreenExitOutput(policy);
      const tui = f.scope.tui;
      tui.renderNow(true);
      callComponentMethod(tui, "flash", "Timed flash", 1000);
      f.scope.stopInteractive();
      assert.equal(
        tui.mode,
        policy === "transcript" ? "regular" : "fullscreen",
      );
      assert.equal(f.scope.stopped, true);
      const count = tui.fullRedraws;
      tui.requestRender(true);
      await settle();
      assert.equal(tui.fullRedraws, count);
      tui.start();
      tui.renderNow(true);
      assert.ok(tui.fullRedraws > count);
      await f.host.dispose();
      const final = tui.fullRedraws;
      tui.start();
      tui.renderNow(true);
      tui.requestRender(true);
      await settle();
      assert.equal(tui.fullRedraws, final);
    } finally {
      await f.close();
    }
  });

test("the unconfigured SDK default initializes the original fullscreen renderer", async () => {
  const files = await createFixture();
  const path = join(files.agentDir, "settings.json");
  const settings = JSON.parse(await readFile(path, "utf8"));
  delete settings.tuiMode;
  await writeFile(path, JSON.stringify(settings));
  const host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const tui = host.desktopUI.terminalRuntime.capture().tui;
    assert.equal(host.session.settingsManager.getTuiMode(), "fullscreen");
    assert.equal(tui.mode, "fullscreen");
    assert.equal(
      Object.getPrototypeOf(tui),
      Reflect.get(await loadTuiApi(), "TuiAltScreen").prototype,
    );
    tui.renderNow(true);
    assert.ok(
      (callComponentMethod(tui, "getScreenLines") as string[]).length > 0,
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});

test("fullscreen retirement releases ownership after an original remount invalidation throws", async () => {
  const f = await fixture(true);
  const notices: string[] = [];
  f.host.on("event", (event) => {
    if (event.type === "notice") notices.push(event.message);
  });
  try {
    const broken = new f.Text("Broken exit invalidation");
    await f.host.desktopUI.mount(() => broken, "header", "broken-exit");
    broken.invalidate = () => {
      throw new Error("Original exit invalidation failed");
    };
    await f.host.dispose();
    assert.equal(f.scope.signal.aborted, true);
    assert.equal(f.host.desktopUI.surfaces.length, 0);
    assert.ok(notices.includes("Original exit invalidation failed"));
  } finally {
    await f.close();
  }
});
