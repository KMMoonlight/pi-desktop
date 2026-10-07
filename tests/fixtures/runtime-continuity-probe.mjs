import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const states = new WeakMap();
const children = (value) => Reflect.get(value, "children") ?? [];
export default async function (
  { host, desktop, session, sdk },
  { action = "inspect", mode = "native" } = {},
) {
  let state = states.get(host);
  const current = desktop.terminalRuntime.capture();
  if (action === "seed") {
    if (state) {
      state.off?.();
      state.colorOff?.();
      state.tui.removeChild(state.child);
    }
    const require = createRequire(join(sdk.getPackageDir(), "package.json"));
    const api = await import(
      pathToFileURL(require.resolve("@earendil-works/pi-tui")).href
    );
    const editor = children(current.tui.children[4])[0];
    state = {
      scope: current,
      tui: current.tui,
      terminal: current.tui.terminal,
      editor,
      footer: current.application.footer,
      provider: current.application.footerData,
      oldContext: session.extensionRunner.createContext(),
      path: session.sessionFile,
      entry: session.sessionManager
        .getEntries()
        .find((e) => e.type === "message" && e.message.role === "user")?.id,
      direct: 0,
      context: 0,
      debug: 0,
      colors: [],
      disposed: 0,
      value: "",
    };
    state.child =
      mode === "native"
        ? new api.Input({ prompt: "持久注册输入" })
        : {
            render: () => [
              `Persistent opaque registration: ${state.value}${api.CURSOR_MARKER}`,
            ],
            handleInput(data) {
              if (data.length === 1 && data >= " ") state.value += data;
              state.tui.requestRender();
            },
            handleMouse(event) {
              if (event.type === "wheel") return;
              return { handled: true, focus: event.type === "press" };
            },
            invalidate() {},
          };
    state.child.dispose = () => state.disposed++;
    state.off = state.tui.addInputListener((data) => {
      state.direct++;
      if (data === "x") return { data: "y" };
    });
    state.tui.onDebug = () => state.debug++;
    state.colorOff = state.tui.onTerminalColorSchemeChange((value) =>
      state.colors.push(value),
    );
    state.tui.setTerminalColorSchemeNotifications(true);
    session.extensionRunner.getUIContext().onTerminalInput(() => {
      state.context++;
    });
    editor.addToHistory("Persistent desktop history");
    state.tui.addChild(state.child);
    states.set(host, state);
  }
  if (!state) throw new Error("Continuity probe is not seeded");
  if (action === "debug") {
    await desktop.input("editor", "\x1b[100;6u");
  }
  if (action === "history") {
    state.editor.setText("");
    await desktop.input("editor", "\x1b[A");
  }
  if (action === "cleanup") {
    state.off();
    state.colorOff();
    state.tui.onDebug = undefined;
    state.tui.removeChild(state.child);
    state.tui.renderNow();
  }
  host.snapshot();
  state.tui.renderNow();
  let stale = false;
  try {
    void state.oldContext.cwd;
  } catch (error) {
    stale = /stale/i.test(error.message);
  }
  return {
    same: current === state.scope && current.tui === state.tui,
    terminalSame: current.tui.terminal === state.terminal,
    editorSame: children(current.tui.children[4])[0] === state.editor,
    footerSame:
      current.application.footer === state.footer &&
      current.application.footerData === state.provider,
    registrationCount: current.registrationCount,
    value: state.child.getValue?.() ?? state.value,
    editorText: state.editor.getText(),
    direct: state.direct,
    context: state.context,
    debug: state.debug,
    colors: state.colors.slice(),
    disposed: state.disposed,
    stale,
    path: state.path,
    entry: state.entry,
  };
}
