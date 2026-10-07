import type { DesktopTui } from "./tui-api.ts";
import { callComponentMethod } from "./component-runtime.ts";

type Terminal = DesktopTui["terminal"];

/**
 * Pi's diff renderer computes its real frame/state against desktop geometry.
 * Its drawing bytes belong to desktop presentation, while direct extension
 * terminal calls own the physical PTY. A synchronous lease ends before any
 * extension timer or promise callback can take over the terminal.
 */
export class RendererTerminal {
  readonly terminal: Terminal;
  private drawing = 0;
  private resizeCallback?: () => void;
  private virtual: Terminal;
  private physicalActive = false;
  private physicalGeneration = 0;

  constructor(
    private physical: Terminal,
    geometry: { readonly columns: number; readonly rows: number },
    output: (data: string) => void = () => {},
    private injected?: {
      input(data: string): void;
      setTitle(title: string): void;
      setProgress(active: boolean): void;
    },
  ) {
    this.virtual = {
      get columns() {
        return geometry.columns;
      },
      get rows() {
        return geometry.rows;
      },
      kittyProtocolActive: false,
      start: (_input, resize) => {
        this.resizeCallback = resize;
        if (this.injected) {
          const generation = ++this.physicalGeneration;
          this.physicalActive = true;
          return physical.start(
            (data) => {
              if (this.physicalActive && generation === this.physicalGeneration)
                this.injected!.input(data);
            },
            () => {
              if (this.physicalActive && generation === this.physicalGeneration)
                resize();
            },
          );
        }
      },
      stop: () => {
        this.resizeCallback = undefined;
      },
      drainInput: async () => {},
      write: (data) => {
        // Startup device requests are protocol I/O, independent of diff frames.
        if (this.injected && /^\x1b\[(?:16t|\?2031[hl]|\?996n)$/.test(data))
          return physical.write(data);
        return output(data);
      },
      moveBy: (lines) => {
        if (lines) output(`\x1b[${Math.abs(lines)}${lines > 0 ? "B" : "A"}`);
      },
      hideCursor: () => output("\x1b[?25l"),
      showCursor: () => output("\x1b[?25h"),
      clearLine: () => output("\x1b[2K"),
      clearFromCursor: () => output("\x1b[J"),
      clearScreen: () => output("\x1b[2J\x1b[H"),
      setTitle: (title) => this.terminal.setTitle(title),
      setProgress: (active) => this.terminal.setProgress(active),
    };
    this.terminal = new Proxy(physical, {
      get: (_target, key) => {
        const value = Reflect.get(physical, key, physical);
        if (typeof value !== "function")
          return Reflect.get(this.drawing ? this.virtual : physical, key);
        return (...args: unknown[]) => {
          const target = this.drawing ? this.virtual : physical;
          // Title/progress always reach the supplied Terminal with its receiver;
          // observing the result also updates the desktop window presentation.
          if (key === "setTitle" || key === "setProgress") {
            const result = Reflect.apply(
              Reflect.get(physical, key),
              physical,
              args,
            );
            if (this.injected)
              Reflect.apply(
                Reflect.get(this.injected, key),
                this.injected,
                args,
              );
            return result;
          }
          if (this.injected && target === physical && key === "start") {
            this.physicalGeneration++;
            this.physicalActive = true;
          }
          if (this.injected && target === physical && key === "stop") {
            this.physicalGeneration++;
            this.physicalActive = false;
          }
          return Reflect.apply(Reflect.get(target, key), target, args);
        };
      },
    });
  }

  run<T>(operation: () => T): T {
    this.drawing++;
    try {
      return operation();
    } finally {
      this.drawing--;
    }
  }

  resize() {
    this.resizeCallback?.();
  }
  stopPhysical() {
    if (this.injected) {
      this.physicalGeneration++;
      if (!this.physicalActive) return;
      this.physicalActive = false;
    }
    this.physical.stop();
  }

  /** Instance decoration leaves the pinned renderer and scheduler unchanged. */
  bind(tui: DesktopTui, render: () => void, active: () => boolean) {
    const native = Reflect.get(tui, "doRender") as () => void;
    Reflect.set(tui, "doRender", () => {
      if (!active()) return;
      this.run(() => native.call(tui));
      render();
    });
    for (const method of ["setShowHardwareCursor"] as const) {
      const original = tui[method];
      tui[method] = (value) => this.run(() => original.call(tui, value));
    }
  }

  cancel(tui: DesktopTui) {
    callComponentMethod(tui, "cancelRenderTimer");
  }
}
