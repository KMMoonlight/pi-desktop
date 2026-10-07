import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const states = new WeakMap();
export default async function (
  { host, desktop, sdk },
  { action = "inspect", mode = "layout-theme", data = "x" } = {},
) {
  let state = states.get(host);
  if (action === "seed") {
    state = {
      originalCwd: host.runtime.cwd,
      workspace: join(host.runtime.cwd, `invocation-${mode}`),
      callbacks: [],
      events: [],
      token: {},
    };
    states.set(host, state);
    await mkdir(state.workspace, { recursive: true });
    const options = {
      tuiMode: "regular",
      initialThemeSetting: mode === "layout-theme" ? "light/dark" : "light",
      autoTrustOnReloadCwd: state.workspace,
    };
    if (mode === "terminal") {
      const terminal = {
        columns: 73,
        rows: 17,
        kittyProtocolActive: false,
        start(input, resize) {
          state.callbacks.push({ input, resize });
          state.events.push("start");
        },
        stop() {
          state.events.push("stop");
        },
        drainInput: async () => {},
        write(value) {
          if (this !== terminal) throw new Error("Wrong Terminal receiver");
          state.events.push(`write:${value}`);
          return state.token;
        },
        moveBy() {},
        hideCursor() {},
        showCursor() {},
        clearLine() {},
        clearFromCursor() {},
        clearScreen() {},
        setTitle(value) {
          if (this !== terminal) throw new Error("Wrong title receiver");
          state.events.push(`title:${value}`);
          return state.token;
        },
        setProgress(value) {
          state.events.push(`progress:${value}`);
          return state.token;
        },
      };
      options.terminal = terminal;
      state.terminal = terminal;
      state.titleMethod = terminal.setTitle;
    }
    await host.initialize(state.workspace, options);
    state.scope = desktop.terminalRuntime.capture();
    state.tui = state.scope.tui;
    const require = createRequire(join(sdk.getPackageDir(), "package.json"));
    state.api = await import(
      pathToFileURL(require.resolve("@earendil-works/pi-tui")).href
    );
  }
  if (!state) throw new Error("Invocation probe is not seeded");
  if (action === "resources") {
    await mkdir(join(state.workspace, ".pi"), { recursive: true });
    await writeFile(join(state.workspace, ".pi", "settings.json"), "{}");
  }
  if (action === "reload") await host.session.reload();
  if (action === "new") await host.sdk.runtime.newSession();
  if (action === "switch") state.scope.switchMode("fullscreen");
  if (action === "input") {
    state.callbacks.at(-1).input(data);
    for (
      let attempt = 0;
      attempt < 100 &&
      !host.session.extensionRunner
        .getUIContext()
        .getEditorText()
        .endsWith(data);
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (action === "direct") {
    state.writeSame =
      state.tui.terminal.write("Injected direct output") === state.token;
    state.titleSame =
      state.tui.terminal.setTitle("Invocation custom terminal") === state.token;
    state.tui.terminal.setProgress(true);
    const colors = state.tui.queryTerminalColors({ timeoutMs: 100 });
    state.callbacks.at(-1).input("\x1b]10;rgb:ffff/0000/0000\x1b\\");
    state.callbacks.at(-1).input("\x1b[?1;2c");
    state.colors = await colors;
    const schemes = [];
    const detach = state.tui.onTerminalColorSchemeChange((scheme) =>
      schemes.push(scheme),
    );
    state.tui.setTerminalColorSchemeNotifications(true);
    state.callbacks.at(-1).input("\x1b[?997;1n");
    detach();
    state.schemes = schemes;
  }
  if (action === "cleanup") {
    await host.initialize(state.originalCwd);
    new sdk.ProjectTrustStore(host.agentDir).set(state.workspace, null);
    await rm(state.workspace, { recursive: true, force: true });
    states.delete(host);
    return { stops: state.events.filter((event) => event === "stop").length };
  }
  const ui = host.session.extensionRunner.getUIContext();
  if (action !== "inspect") {
    const text = new state.api.Text(
      `Invocation layout: ${state.tui.mode}\nInvocation theme: ${ui.theme.name}`,
      0,
      0,
    );
    ui.setWidget("invocation-options", () => text);
    for (
      let attempt = 0;
      attempt < 100 &&
      desktop.nativeComponent("widget:invocation-options") !== text;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
  }
  host.publish();
  return {
    mode: state.tui.mode,
    theme: ui.theme.name,
    same: state.scope === desktop.terminalRuntime.capture(),
    setting: host.session.settingsManager.getThemeSetting() ?? null,
    trusted: new sdk.ProjectTrustStore(host.agentDir).get(state.workspace),
    input: ui.getEditorText(),
    starts: state.callbacks.length,
    stops: state.events.filter((event) => event === "stop").length,
    titleSame: state.titleSame,
    writeSame: state.writeSame,
    titleMethodSame: state.terminal?.setTitle === state.titleMethod,
    colors: state.colors,
    schemes: state.schemes,
    events: state.events,
  };
}
