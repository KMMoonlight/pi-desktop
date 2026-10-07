import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CustomEditor, InteractiveMode } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { createDetachedTui } from "../backend/detached-tui.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import {
  componentField,
  callComponentMethod,
} from "../backend/component-runtime.ts";
import { createFixture } from "./fixture.ts";

const children = (value: object): object[] =>
  componentField(value, "children") as object[];
const editorOf = (tui: { children: object[] }) =>
  children(tui.children[4]!)[0] as CustomEditor;
async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Lifecycle transition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const transition of ["reload", "new", "switch", "fork", "import"] as const)
  test(
    `interactive objects and direct registrations survive SDK ${transition}`,
    { timeout: 30000 },
    async () => {
      const files = await createFixture();
      const host = new DesktopHost(files.agentDir);
      try {
        await host.initialize(files.cwd);
        await host.withSdk(({ session }) => session.prompt("Continuity seed"));
        const scope = host.desktopUI.terminalRuntime.capture();
        const tui = scope.tui;
        const terminal = tui.terminal;
        const roots = tui.children.slice();
        const editor = editorOf(tui);
        const application = scope.application!;
        const footer = application.footer;
        const provider = application.footerData;
        const bash = application.bash;
        const oldContext = host.session.extensionRunner.createContext();
        const path = host.session.sessionFile!;
        const entry = host.session.sessionManager
          .getEntries()
          .find((e) => e.type === "message" && e.message.role === "user")!;
        const Text = Reflect.get(await loadTuiApi(), "Text");
        const child = new Text("Persistent direct registration");
        let disposed = 0,
          direct = 0,
          context = 0,
          debug = 0;
        const colors: string[] = [];
        await host.action({
          action: "desktop.appearance",
          args: { appearance: "light" },
        });
        const colorOff = tui.onTerminalColorSchemeChange((value) =>
          colors.push(value),
        );
        tui.setTerminalColorSchemeNotifications(true);
        child.dispose = () => disposed++;
        const add = tui.addChild;
        add(child);
        add(child);
        tui.renderNow();
        const registrationId = host.desktopUI.surfaces.find(
          (s) => s.id === "tui:registrations",
        )!.instanceId;
        const off = tui.addInputListener(() => {
          direct++;
          return undefined;
        });
        tui.onDebug = () => {
          debug++;
        };
        host.session.extensionRunner.getUIContext().onTerminalInput(() => {
          context++;
          return undefined;
        });
        editor.addToHistory("Cross-session history");
        host.session.extensionRunner
          .getUIContext()
          .setEditorText("Saved draft");
        host.session.extensionRunner
          .getUIContext()
          .setStatus("continuity", "Retired status");
        host.notice("Retired notice", "warning");
        const live = bash.begin("Retired command", false, false);
        bash.append(live, "Original chunk");
        const output = (
          componentField(live.component, "outputLines") as string[]
        ).slice();
        tui.renderNow();
        if (transition === "reload") await host.session.reload();
        else if (transition === "new") await host.sdk.runtime.newSession();
        else if (transition === "switch")
          await host.sdk.runtime.switchSession(path);
        else if (transition === "fork") await host.sdk.runtime.fork(entry.id);
        else await host.sdk.runtime.importFromJsonl(path);
        host.snapshot();
        assert.equal(host.desktopUI.terminalRuntime.capture(), scope);
        assert.equal(scope.signal.aborted, false);
        assert.equal(scope.tui, tui);
        assert.equal(tui.terminal, terminal);
        assert.deepEqual(tui.children.slice(0, 7), roots);
        assert.equal(editorOf(tui), editor);
        assert.equal(scope.application, application);
        assert.equal(application.footer, footer);
        assert.equal(application.footerData, provider);
        assert.equal(componentField(footer, "session"), host.session);
        assert.equal(
          host.desktopUI.surfaces.find((s) => s.id === "tui:registrations")!
            .instanceId,
          registrationId,
        );
        assert.equal(scope.registrationCount, 2);
        assert.equal(disposed, 0);
        assert.throws(() => oldContext.cwd, /stale/i);
        assert.equal(host.snapshot().extensionUI.inputListeners, 0);
        assert.equal(provider.getExtensionStatuses().has("continuity"), false);
        assert.notEqual(application.bash, bash);
        bash.append(live, "Late old chunk");
        assert.deepEqual(componentField(live.component, "outputLines"), output);
        assert.deepEqual(application.bash.entries(false), []);
        assert.ok(!tui.render(100).join("\n").includes("Retired notice"));
        await host.desktopUI.input("editor", "x");
        await host.desktopUI.input("editor", "\x1b[100;6u");
        assert.equal(direct, 2);
        assert.equal(context, 0);
        assert.equal(debug, 1);
        await host.action({
          action: "desktop.appearance",
          args: { appearance: "dark" },
        });
        assert.equal(colors.at(-1), "dark");
        colorOff();
        off();
        editor.setText("");
        await host.desktopUI.input("editor", "\x1b[A");
        assert.equal(editor.getText(), "Cross-session history");
        add(new Text("Added through extracted method after transition"));
        assert.equal(scope.registrationCount, 3);
        tui.removeChild(child);
        tui.renderNow();
        assert.equal(disposed, 0);
        tui.removeChild(child);
        tui.renderNow();
        assert.equal(disposed, 1);
      } finally {
        await host.dispose();
        await files.close();
      }
    },
  );

test("reload applies settings and keybindings to the retained original editor", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const tui = host.desktopUI.terminalRuntime.capture().tui;
    const editor = editorOf(tui);
    const keys = componentField(editor, "keybindings") as object;
    editor.addToHistory("Updated keybinding history");
    await writeFile(
      join(files.agentDir, "keybindings.json"),
      JSON.stringify({ "tui.editor.historyPrevious": "ctrl+p" }),
    );
    host.session.settingsManager.setEditorPaddingX(2);
    host.session.settingsManager.setAutocompleteMaxVisible(3);
    host.session.settingsManager.setShowHardwareCursor(true);
    host.session.settingsManager.setClearOnShrink(true);
    await host.session.reload();
    assert.equal(editorOf(tui), editor);
    assert.equal(componentField(editor, "keybindings"), keys);
    assert.equal(editor.getPaddingX(), 2);
    assert.equal(editor.getAutocompleteMaxVisible(), 3);
    assert.equal(tui.getShowHardwareCursor(), true);
    assert.equal(tui.getClearOnShrink(), true);
    assert.equal(
      callComponentMethod(
        keys,
        "matches",
        "\x10",
        "tui.editor.historyPrevious",
      ),
      true,
    );
    editor.setText("");
    await host.desktopUI.input("editor", "\x10");
    assert.equal(editor.getText(), "Updated keybinding history");
  } finally {
    await host.dispose();
    await files.close();
  }
});

test("extension reset hides the top direct overlay just as original InteractiveMode does", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const api = await loadTuiApi();
    const Text = Reflect.get(api, "Text");
    const native = await createDetachedTui(() => {});
    const desktop = host.desktopUI.terminalRuntime.capture().tui;
    const traces: boolean[][] = [];
    for (const tui of [native, desktop]) {
      const one = tui.showOverlay(new Text("Lower retained overlay"));
      const two = tui.showOverlay(new Text("Top removed overlay"));
      if (tui === desktop) {
        await until(
          () =>
            host.desktopUI.surfaces.filter((s) => s.slot === "dialog")
              .length === 2,
        );
        await host.session.reload();
      } else {
        const defaultEditor = {
          render: () => [],
          invalidate() {},
          getText: () => "",
          setText() {},
        };
        const receiver = {
          ui: tui,
          footer: { invalidate() {} },
          footerDataProvider: { clearExtensionStatuses() {} },
          defaultEditor,
          editor: defaultEditor,
          editorContainer: new (Reflect.get(api, "Container"))(),
          disposeActiveSelector() {},
          setExtensionFooter() {},
          setExtensionHeader() {},
          clearExtensionWidgets() {},
          clearExtensionTerminalInputListeners() {},
          setCustomEditorComponent: Reflect.get(
            InteractiveMode.prototype,
            "setCustomEditorComponent",
          ),
          setupAutocompleteProvider() {},
          updateTerminalTitle() {},
          setWorkingIndicator() {},
          setHiddenThinkingLabel() {},
        };
        Reflect.get(InteractiveMode.prototype, "resetExtensionUI").call(
          receiver,
        );
      }
      traces.push([tui.hasOverlay(), one.isFocused(), two.isFocused()]);
      one.hide();
      two.hide();
    }
    assert.deepEqual(traces[1], traces[0]);
    assert.deepEqual(traces[1], [true, false, false]);
  } finally {
    await host.dispose();
    await files.close();
  }
});

test("late factory output cannot revive cleared session UI on the persistent TUI", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  let release!: () => void;
  try {
    await host.initialize(files.cwd);
    const scope = host.desktopUI.terminalRuntime.capture();
    const api = await loadTuiApi();
    const Text = Reflect.get(api, "Text");
    let entered = false,
      disposed = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = host.desktopUI.mount(
      async () => {
        entered = true;
        await gate;
        const child = new Text("Late retired header");
        child.dispose = () => disposed++;
        return child;
      },
      "header",
      "late",
    );
    await until(() => entered);
    await host.session.reload();
    release();
    await pending;
    assert.equal(host.desktopUI.terminalRuntime.capture(), scope);
    assert.equal(
      host.desktopUI.surfaces.some((s) => s.id === "late"),
      false,
    );
    assert.equal(disposed, 1);
    assert.ok(
      !scope.tui.render(100).join("\n").includes("Late retired header"),
    );
  } finally {
    release?.();
    await host.dispose();
    await files.close();
  }
});

test("workspace replacement and shutdown retire persistent interactive ownership", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const old = host.desktopUI.terminalRuntime.capture();
    const Text = Reflect.get(await loadTuiApi(), "Text");
    let disposed = 0,
      hits = 0;
    const child = new Text("Old workspace child");
    child.dispose = () => disposed++;
    old.tui.addChild(child);
    old.tui.addInputListener(() => {
      hits++;
      return undefined;
    });
    old.tui.renderNow();
    await host.initialize(files.root);
    const current = host.desktopUI.terminalRuntime.capture();
    assert.notEqual(current, old);
    assert.equal(old.signal.aborted, true);
    assert.notEqual(editorOf(old.tui), editorOf(current.tui));
    assert.equal(disposed, 1);
    old.tui.addChild(new Text("Stale workspace registration"));
    await host.desktopUI.input("editor", "x");
    assert.equal(hits, 0);
    assert.equal(current.registrationCount, 0);
    await host.dispose();
    assert.equal(current.signal.aborted, true);
  } finally {
    await host.dispose();
    await files.close();
  }
});
