import { getSelectListTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { loadTuiApi, type DesktopTui } from "./tui-api.ts";

let themeInitialized = false;

/** Physical terminal ownership is shared by renderer replacements and raw extension programs. */
export async function createDesktopTerminal(
  geometry = { columns: 120, rows: 40 },
  window?: Pick<DesktopTui["terminal"], "setTitle" | "setProgress"> & {
    activate?(): void;
  },
  appearance?: {
    subscribe?(listener: (scheme: "light" | "dark") => void): () => void;
    signal: AbortSignal;
    queryColors?: DesktopTui["queryTerminalColors"];
  },
  processTerminal = true,
): Promise<DesktopTui["terminal"]> {
  // SDK components also use the global theme for key hints.
  if (!themeInitialized) {
    try {
      getSelectListTheme().selectedText("");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith("Theme not initialized")
      )
        throw error;
      initTheme(undefined, false);
    }
    themeInitialized = true;
  }
  const unsupported = () => {
    throw new Error(
      "This extension requires a native desktop presentation adapter",
    );
  };
  const terminal: DesktopTui["terminal"] = {
    get columns() {
      return geometry.columns;
    },
    get rows() {
      return geometry.rows;
    },
    kittyProtocolActive: false,
    start: unsupported,
    stop: () => {},
    drainInput: async () => {},
    write: unsupported,
    moveBy: unsupported,
    hideCursor: () => {},
    showCursor: () => {},
    clearLine: unsupported,
    clearFromCursor: unsupported,
    clearScreen: unsupported,
    setTitle: window?.setTitle ?? unsupported,
    setProgress: window?.setProgress ?? unsupported,
  };
  const { ProcessTerminal } = await loadTuiApi();
  let actualTerminal = terminal;
  if (
    processTerminal &&
    process.env.PI_DESKTOP_PTY === "1" &&
    process.stdin.isTTY &&
    process.stdout.isTTY
  ) {
    const native = new ProcessTerminal();
    let active = false;
    const start = native.start.bind(native);
    const stop = native.stop.bind(native);
    const write = native.write.bind(native);
    native.write = (data) => {
      window?.activate?.();
      write(data);
    };
    native.start = (input, resize) => {
      window?.activate?.();
      if (active) stop();
      active = true;
      start(input, resize);
    };
    native.stop = () => {
      if (active) {
        active = false;
        stop();
      }
    };
    if (window?.setTitle) native.setTitle = window.setTitle;
    if (window?.setProgress) native.setProgress = window.setProgress;
    appearance?.signal.addEventListener("abort", () => native.stop(), {
      once: true,
    });
    actualTerminal = native;
  }
  return actualTerminal;
}

/** Runs private surface layout without starting a renderer or writing terminal output. */
export async function createDetachedTui(
  invalidate: () => void,
  geometry = { columns: 120, rows: 40 },
  window?: Pick<DesktopTui["terminal"], "setTitle" | "setProgress"> & {
    activate?(): void;
  },
  appearance?: {
    subscribe?(listener: (scheme: "light" | "dark") => void): () => void;
    signal: AbortSignal;
    queryColors?: DesktopTui["queryTerminalColors"];
  },
  processTerminal = true,
): Promise<DesktopTui> {
  const actualTerminal = await createDesktopTerminal(
    geometry,
    window,
    appearance,
    processTerminal,
  );
  const { TuiMainScreen } = await loadTuiApi();
  const tui = new TuiMainScreen(actualTerminal, false);
  tui.requestRender = invalidate;
  tui.renderNow = invalidate;
  tui.queryTerminalColors = appearance?.queryColors ?? (async () => ({}));
  const listeners = new Set<(scheme: "light" | "dark") => void>();
  let enabled = false;
  let closed = appearance?.signal.aborted ?? false;
  tui.onTerminalColorSchemeChange = (listener) => {
    if (!closed) listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  tui.setTerminalColorSchemeNotifications = (value) => {
    enabled = value;
  };
  const unsubscribe = !closed
    ? appearance?.subscribe?.((scheme) => {
        if (closed || !enabled) return;
        for (const listener of listeners) listener(scheme);
      })
    : undefined;
  appearance?.signal.addEventListener(
    "abort",
    () => {
      closed = true;
      listeners.clear();
      unsubscribe?.();
    },
    { once: true },
  );
  return tui;
}
