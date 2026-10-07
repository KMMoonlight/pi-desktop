import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  InteractiveMode,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { startupOptions } from "../backend/startup.ts";
import {
  callComponentMethod,
  loadComponentRuntime,
} from "../backend/component-runtime.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopTui } from "../backend/tui-api.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Injected terminal input did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function project(cwd: string) {
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "settings.json"), "{}");
}
test("JSON invocation options validate scalar fields and reject function-rich terminals", () => {
  assert.deepEqual(
    startupOptions({
      tuiMode: "fullscreen",
      initialThemeSetting: "light/dark",
      autoTrustOnReloadCwd: "project",
    }),
    {
      tuiMode: "fullscreen",
      initialThemeSetting: "light/dark",
      autoTrustOnReloadCwd: "project",
    },
  );
  for (const options of [
    { tuiMode: "other" },
    { tuiMode: 1 },
    { initialThemeSetting: false },
    { autoTrustOnReloadCwd: {} },
    { terminal: {} },
  ])
    assert.throws(() => startupOptions(options), /Invalid/);
});

for (const mode of ["regular", "fullscreen"] as const)
  test(`invocation ${mode} layout and theme override persist without changing saved settings`, async () => {
    const files = await createFixture();
    const savedMode = mode === "regular" ? "fullscreen" : "regular";
    const settingsPath = join(files.agentDir, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({
        ...JSON.parse(await readFile(settingsPath, "utf8")),
        tuiMode: savedMode,
        theme: "light",
      }),
    );
    const host = new DesktopHost(files.agentDir, {
      startup: { tuiMode: mode, initialThemeSetting: "dark" },
    });
    try {
      await host.initialize(files.cwd);
      const scope = host.desktopUI.terminalRuntime.capture(),
        reference = scope.tui;
      const oldTheme = host.session.extensionRunner.getUIContext().theme;
      for (const transition of [
        "reload",
        "new",
        "reconnect",
        "invalid",
      ] as const) {
        if (transition === "reload") await host.session.reload();
        if (transition === "new") await host.sdk.runtime.newSession();
        if (transition === "reconnect")
          await host.initialize(files.cwd, {
            tuiMode: savedMode,
            initialThemeSetting: "light",
          });
        if (transition === "invalid")
          await assert.rejects(
            host.initialize(join(files.root, "missing"), {
              tuiMode: savedMode,
              initialThemeSetting: "light",
            }),
          );
        assert.equal(scope.tui, reference);
        assert.equal(reference.mode, mode);
        assert.equal(
          host.session.extensionRunner.getUIContext().theme.name,
          "dark",
        );
        assert.equal(oldTheme.name, "dark");
        assert.equal(host.session.settingsManager.getTuiMode(), savedMode);
        assert.equal(host.session.settingsManager.getThemeSetting(), "light");
        assert.equal(host.startup.configuration.initialThemeSetting, "dark");
      }
      const switched = savedMode;
      assert.equal(scope.switchMode(switched), true);
      await host.session.reload();
      assert.equal(
        reference.mode,
        switched,
        "explicit native mode change survives reload",
      );
      const ui = host.session.extensionRunner.getUIContext();
      assert.equal(ui.setTheme("light").success, true);
      host.session.settingsManager.setTheme("dark");
      await host.session.reload();
      assert.equal(
        ui.theme.name,
        "light",
        "accepted named selection replaces the launch selection",
      );
      host.setThemeSetting("light/dark");
      await host.action({
        action: "desktop.appearance",
        args: { appearance: "dark" },
      });
      assert.equal(ui.theme.name, "dark");
      const successor = join(files.root, "successor");
      await mkdir(successor);
      await host.initialize(successor);
      assert.equal(
        host.desktopUI.terminalRuntime.capture().tui.mode,
        savedMode,
      );
      assert.equal(host.startup.configuration.initialThemeSetting, undefined);
      assert.equal(
        host.session.extensionRunner.getUIContext().theme.name,
        "dark",
      );
    } finally {
      await host.dispose();
      await files.close();
    }
  });

test("invocation theme pairs, missing names and native selection methods retain precedence", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  const notices: string[] = [];
  host.on("event", (event) => {
    if (event.type === "notice") notices.push(event.message);
  });
  try {
    await host.initialize(files.cwd, { initialThemeSetting: "light/dark" });
    const ui = host.session.extensionRunner.getUIContext();
    assert.equal(ui.theme.name, "light");
    await host.action({
      action: "desktop.appearance",
      args: { appearance: "dark" },
    });
    assert.equal(ui.theme.name, "dark");
    await host.session.reload();
    assert.equal(ui.theme.name, "dark");
    host.setThemeSetting("missing-invocation-theme");
    assert.equal(ui.theme.name, "system");
    assert.match(
      notices.at(-1)!,
      /Failed to load theme "missing-invocation-theme".*\nFell back to the system theme\./,
    );
    const runtime = await loadComponentRuntime();
    const selection = runtime.theme.createSelection(
      () => host.session.settingsManager,
      "light/dark",
    );
    assert.equal(selection.getThemeSetting(), "light/dark");
    assert.equal(selection.getThemeSelection(), "light/dark");
    assert.equal(selection.resolveThemeName(), "dark");
    selection.currentThemeSetting = undefined;
    assert.equal(
      selection.getThemeSetting(),
      host.session.settingsManager.getThemeSetting(),
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});

test("custom Terminal retains receivers, results, input, resize and workspace lifecycle", async () => {
  const files = await createFixture();
  const callbacks: { input(data: string): void; resize(): void }[] = [];
  const events: string[] = [],
    token = {},
    draining = Promise.resolve();
  let terminal: DesktopTui["terminal"];
  function result(name: string, receiver: unknown) {
    assert.equal(receiver, terminal);
    events.push(name);
    return token;
  }
  terminal = {
    columns: 61,
    rows: 19,
    kittyProtocolActive: true,
    start(input, resize) {
      callbacks.push({ input, resize });
      return result("start", this);
    },
    stop() {
      return result("stop", this);
    },
    drainInput() {
      result("drain", this);
      return draining;
    },
    write(data) {
      return result(`write:${data}`, this);
    },
    moveBy(lines) {
      return result(`move:${lines}`, this);
    },
    hideCursor() {
      return result("hide", this);
    },
    showCursor() {
      return result("show", this);
    },
    clearLine() {
      return result("line", this);
    },
    clearFromCursor() {
      return result("from", this);
    },
    clearScreen() {
      return result("screen", this);
    },
    setTitle(title) {
      return result(`title:${title}`, this);
    },
    setProgress(active) {
      return result(`progress:${active}`, this);
    },
  };
  const originals = Object.getOwnPropertyDescriptors(terminal);
  const host = new DesktopHost(files.agentDir, {
    startup: { terminal, tuiMode: "regular" },
  });
  try {
    await host.initialize(files.cwd);
    const scope = host.desktopUI.terminalRuntime.capture(),
      proxy = scope.tui.terminal;
    assert.equal(callbacks.length, 1);
    assert.equal(proxy.columns, 61);
    assert.equal(proxy.rows, 19);
    assert.equal(proxy.kittyProtocolActive, true);
    assert.equal(proxy.write("opaque output"), token);
    assert.equal(proxy.setTitle("Injected title"), token);
    assert.equal(host.snapshot().extensionUI.windowTitle, "Injected title");
    assert.equal(proxy.setProgress(true), token);
    assert.equal(proxy.drainInput(), draining);
    for (const method of [
      "hideCursor",
      "showCursor",
      "clearLine",
      "clearFromCursor",
      "clearScreen",
    ] as const)
      assert.equal(proxy[method](), token);
    assert.equal(proxy.moveBy(3), token);
    const before = events.filter((event) => event.startsWith("write:")).length;
    scope.tui.renderNow(true);
    assert.equal(
      events.filter((event) => event.startsWith("write:")).length,
      before,
    );
    let hooks = 0;
    const unhook = scope.tui.addInputListener((data) => {
      hooks++;
      return { data: data.toUpperCase() };
    });
    callbacks[0]!.input("x");
    await until(
      () => host.session.extensionRunner.getUIContext().getEditorText() === "X",
    );
    assert.equal(hooks, 1);
    unhook();
    const colors = scope.tui.queryTerminalColors({ timeoutMs: 100 });
    assert.ok(events.some((event) => event.includes("\x1b]10;?")));
    callbacks[0]!.input("\x1b]10;rgb:ffff/0000/0000\x1b\\");
    callbacks[0]!.input("\x1b]11;rgb:0000/0000/ffff\x1b\\");
    callbacks[0]!.input("\x1b[?1;2c");
    assert.deepEqual(await colors, {
      foreground: { r: 255, g: 0, b: 0 },
      background: { r: 0, g: 0, b: 255 },
      palette: undefined,
    });
    const schemes: string[] = [];
    const detachScheme = scope.tui.onTerminalColorSchemeChange((scheme) =>
      schemes.push(scheme),
    );
    scope.tui.setTerminalColorSchemeNotifications(true);
    callbacks[0]!.input("\x1b[?997;1n");
    callbacks[0]!.input("\x1b[?997;2n");
    assert.deepEqual(schemes, ["dark", "light"]);
    detachScheme();
    assert.equal(
      host.session.extensionRunner.getUIContext().getEditorText(),
      "X",
      "protocol replies never enter the desktop editor",
    );
    callbacks[0]!.resize();
    assert.equal(scope.switchMode("fullscreen"), true);
    assert.equal(scope.tui.terminal, proxy);
    assert.equal(callbacks.length, 2);
    const oldValue = host.session.extensionRunner
      .getUIContext()
      .getEditorText();
    callbacks[0]!.input("stale");
    assert.equal(
      host.session.extensionRunner.getUIContext().getEditorText(),
      oldValue,
    );
    await host.session.reload();
    await host.sdk.runtime.newSession();
    assert.equal(
      callbacks.length,
      2,
      "reload/new session keep the workspace terminal owner",
    );
    assert.equal(host.desktopUI.terminalRuntime.capture(), scope);
    const successor = join(files.root, "successor");
    await mkdir(successor);
    await host.initialize(successor);
    assert.equal(events.filter((event) => event === "stop").length, 2);
    callbacks[1]!.input("retired");
    callbacks[1]!.resize();
    assert.equal(
      host.session.extensionRunner.getUIContext().getEditorText(),
      "",
    );
    assert.deepEqual(Object.getOwnPropertyDescriptors(terminal), originals);
  } finally {
    await host.dispose();
    await files.close();
  }
});

for (const gate of [
  "late-resources",
  "untrusted",
  "cwd-mismatch",
  "saved-true",
  "saved-false",
  "saved-parent",
  "write-error",
] as const)
  test(`implicit trust after reload uses unchanged Pi gates and guard lifetime: ${gate}`, async () => {
    const files = await createFixture();
    const host = new DesktopHost(files.agentDir);
    // Removing saved trust deliberately makes a successor session ask again.
    host.on("event", (event) => {
      if (event.type === "dialog")
        host.answer(
          event.data.id,
          event.data.options?.find(
            (option: string) => option === "Trust (this session only)",
          ),
        );
    });
    const store = new ProjectTrustStore(files.agentDir);
    try {
      await host.initialize(files.cwd, {
        autoTrustOnReloadCwd: gate === "cwd-mismatch" ? files.root : files.cwd,
      });
      const app = host.desktopUI.terminalRuntime.capture().application!;
      await host.session.reload();
      assert.equal(
        store.get(files.cwd),
        null,
        "no resources means no saved decision",
      );
      await project(files.cwd);
      if (gate === "untrusted")
        host.session.settingsManager.setProjectTrusted(false);
      if (gate === "saved-true") store.set(files.cwd, true);
      if (gate === "saved-false") store.set(files.cwd, false);
      if (gate === "saved-parent") store.set(files.root, true);
      if (gate === "write-error")
        await writeFile(join(files.agentDir, "trust.json"), "invalid json");
      await host.session.reload();
      if (gate === "write-error") {
        assert.ok(
          app
            .noticeEntries(0)
            .some((entry) =>
              entry.component
                .render(120)
                .join("\n")
                .includes("Could not save project trust after reload"),
            ),
        );
        await writeFile(join(files.agentDir, "trust.json"), "{}");
        await host.session.reload();
        assert.equal(
          store.get(files.cwd),
          true,
          "failure keeps guard available for retry",
        );
      } else if (gate === "untrusted") {
        assert.equal(store.get(files.cwd), null);
        host.session.settingsManager.setProjectTrusted(true);
        await host.session.reload();
        assert.equal(
          store.get(files.cwd),
          true,
          "untrusted gate does not consume guard",
        );
      } else if (gate === "cwd-mismatch")
        assert.equal(store.get(files.cwd), null);
      else
        assert.equal(
          store.get(files.cwd),
          gate === "saved-false" ? false : true,
        );
      if (gate !== "cwd-mismatch") {
        store.set(files.cwd, null);
        store.set(files.root, null);
        await host.sdk.runtime.newSession();
        await host.session.reload();
        assert.equal(
          store.get(files.cwd),
          null,
          "saved/existing decision consumes guard across new sessions",
        );
      }
    } finally {
      await host.dispose();
      await files.close();
    }
  });

test("implicit trust delegates the original method and isolates a successor workspace", async () => {
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd, { autoTrustOnReloadCwd: files.cwd });
    const runtime = await loadComponentRuntime();
    const builder = runtime.application.create(
      () => host.session,
      host.desktopUI.terminalRuntime.capture().tui,
      runtime.keys.KeybindingsManager.create(files.agentDir),
    );
    builder.configure({ autoTrustOnReloadCwd: files.cwd });
    const native = Object.create(InteractiveMode.prototype);
    Object.defineProperties(native, {
      sessionManager: { value: host.session.sessionManager },
      settingsManager: { value: host.session.settingsManager },
    });
    Object.assign(native, {
      autoTrustOnReloadCwd: files.cwd,
      runtimeHost: { services: { agentDir: files.agentDir } },
    });
    assert.equal(
      builder.saveImplicitTrustAfterReload(files.agentDir).saved,
      callComponentMethod(native, "maybeSaveImplicitProjectTrustAfterReload"),
    );
    const successor = join(files.root, "successor");
    await mkdir(successor);
    await host.initialize(successor);
    await project(successor);
    await host.session.reload();
    assert.equal(new ProjectTrustStore(files.agentDir).get(successor), null);
  } finally {
    await host.dispose();
    await files.close();
  }
});
