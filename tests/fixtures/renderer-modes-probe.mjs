import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const states = new WeakMap();
export default async function (
  { host, desktop, session, sdk },
  { action = "inspect", mode = "native", next = "fullscreen" } = {},
) {
  const current = desktop.terminalRuntime.capture();
  let state = states.get(host);
  if (action === "seed") {
    if (state) {
      states.delete(host);
      cleanup(state, current, session);
    }
    const require = createRequire(join(sdk.getPackageDir(), "package.json"));
    const api = await import(
      pathToFileURL(require.resolve("@earendil-works/pi-tui")).href
    );
    state = {
      scope: current,
      tui: current.tui,
      terminal: current.tui.terminal,
      roots: [...current.tui.children],
      footer: current.application.footer,
      editor: desktop.nativeComponent("editor"),
      direct: 0,
      context: 0,
      debug: 0,
      disposed: 0,
      value: "",
      redraw: current.tui.renderNow,
    };
    state.child =
      mode === "native"
        ? new api.Input({ prompt: "模式切换输入" })
        : {
            render: (width) => [
              api.truncateToWidth(
                `Renderer opaque input: ${state.value}`,
                width,
              ) + api.CURSOR_MARKER,
            ],
            handleInput(data) {
              if (data.length === 1 && data >= " ") state.value += data;
              state.tui.requestRender();
            },
            handleMouse(event) {
              if (event.type !== "wheel")
                return { handled: true, focus: event.type === "press" };
            },
            invalidate() {},
          };
    state.child.dispose = () => state.disposed++;
    state.directListener = () => {
      state.direct++;
    };
    state.oldOff = state.tui.addInputListener(state.directListener);
    state.contextOff = session.extensionRunner
      .getUIContext()
      .onTerminalInput(() => {
        state.context++;
      });
    state.tui.onDebug = () => state.debug++;
    state.tui.addChild(state.child);
    states.set(host, state);
  }
  if (!state) throw new Error("Renderer probe is not seeded");
  if (action === "switch") state.switched = current.switchMode(next);
  if (action === "settings") {
    session.settingsManager.setTuiMode(next);
    session.settingsManager.setFullscreenCopyOnSelect(false);
    session.settingsManager.setFullscreenWheelScrollLines(2);
    session.settingsManager.setFullscreenScrollbar("always");
    current.applySettings();
  }
  if (action === "force") state.redraw(true);
  if (action === "stop") state.tui.stop({ preserveScreen: true });
  if (action === "start") state.tui.start();
  if (action === "reregister") {
    state.tui.addInputListener(state.directListener);
    state.oldOff();
  }
  if (action === "debug") await desktop.input("editor", "\x1b[100;6u");
  if (action === "overlay")
    state.overlay = state.tui.showOverlay(
      new (await loadApi(sdk)).Input({ prompt: "模式覆盖层" }),
    );
  if (action === "hide-overlay") state.overlay.setHidden(true);
  if (action === "remove-overlay") {
    state.overlay.hide();
    state.overlay = undefined;
  }
  if (action === "cleanup") {
    states.delete(host);
    cleanup(state, current, session);
  }
  host.snapshot();
  if (!current.stopped) state.redraw();
  const report = {
    mode: state.tui.mode,
    stopped: current.stopped,
    switched: state.switched,
    same: current === state.scope,
    terminalSame: state.tui.terminal === state.terminal,
    rootsSame: state.roots.every(
      (root, index) => current.tui.children[index] === root,
    ),
    editorSame: desktop.nativeComponent("editor") === state.editor,
    footerSame: current.application.footer === state.footer,
    direct: state.direct,
    context: state.context,
    debug: state.debug,
    disposed: state.disposed,
    value: state.child.getValue?.() ?? state.value,
    fullRedraws: state.tui.fullRedraws,
    screenRows: state.tui.getScreenLines?.().length,
  };
  if (action === "cleanup") states.delete(host);
  return report;
}
async function loadApi(sdk) {
  const require = createRequire(join(sdk.getPackageDir(), "package.json"));
  return import(pathToFileURL(require.resolve("@earendil-works/pi-tui")).href);
}
function cleanup(state, current, session) {
  try {
    state.contextOff();
  } finally {
    state.oldOff();
    state.tui.removeInputListener(state.directListener);
    state.tui.onDebug = undefined;
    state.overlay?.hide();
    if (current.stopped) state.tui.start();
    state.tui.removeChild(state.child);
    state.redraw();
    current.switchMode("regular");
    session.settingsManager.setTuiMode("regular");
  }
}
