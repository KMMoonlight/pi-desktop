import { randomUUID } from "node:crypto";
import { loadTuiApi, type DesktopTui } from "./tui-api.ts";
import type { DesktopEvent, TerminalQuery } from "../shared/types.ts";

type QueryOptions = Parameters<DesktopTui["queryTerminalColors"]>[0];
const deviceAttributes = /^\x1b\[\?[\d;]*c$/;

/** Each desktop probe owns an original Pi parser, including its late-reply timer. */
export class TerminalQueries {
  private pending = new Map<
    string,
    { request: TerminalQuery; input(data: string): void; cancel(): void }
  >();
  constructor(private emit: (event: DesktopEvent) => void) {}

  get requests() {
    return [...this.pending.values()].map(({ request }) => request);
  }

  async colors(options: QueryOptions, signal: AbortSignal) {
    const { timeoutMs, onLateReply } = options;
    const { TuiMainScreen } = await loadTuiApi();
    if (signal.aborted) return {};
    const id = randomUUID();
    let input: (data: string) => void = () => {};
    let querying = false;
    let closed = false;
    const noop = () => {};
    const terminal: DesktopTui["terminal"] = {
      columns: 80,
      rows: 24,
      kittyProtocolActive: false,
      start: (receive) => {
        input = receive;
      },
      stop: noop,
      drainInput: async () => {},
      write: (data) => {
        if (!querying || closed) return;
        const request: TerminalQuery = { id, data };
        this.pending.set(id, { request, input: receive, cancel });
        this.emit({ type: "terminal_query", ...request });
      },
      moveBy: noop,
      hideCursor: noop,
      showCursor: noop,
      clearLine: noop,
      clearFromCursor: noop,
      clearScreen: noop,
      setTitle: noop,
      setProgress: noop,
    };
    const tui = new TuiMainScreen(terminal, false);
    tui.requestRender = noop;
    tui.renderNow = noop;
    const close = () => {
      if (closed) return;
      closed = true;
      this.pending.delete(id);
      signal.removeEventListener("abort", cancel);
      tui.stop();
    };
    const cancel = () => {
      // DA1 settles the original promise and clears its timer. Generation retirement
      // suppresses extension callbacks, while still releasing awaiting factories.
      close();
      input("\x1b[?1;2c");
    };
    const receive = (data: string) => {
      if (closed) return;
      try {
        input(data);
      } finally {
        if (deviceAttributes.test(data)) close();
      }
    };
    tui.start();
    querying = true;
    signal.addEventListener("abort", cancel, { once: true });
    return tui.queryTerminalColors({
      timeoutMs,
      onLateReply: onLateReply
        ? function (this: unknown, colors) {
            if (!closed) Reflect.apply(onLateReply, this, [colors]);
          }
        : undefined,
    });
  }

  reply(id: string, data: unknown) {
    if (
      !Array.isArray(data) ||
      data.length > 64 ||
      data.some((value) => typeof value !== "string" || value.length > 512)
    )
      throw new Error("Invalid terminal query replies");
    const query = this.pending.get(id);
    if (!query) return false;
    for (const value of data) query.input(value);
    return true;
  }

  dispose() {
    for (const query of [...this.pending.values()]) query.cancel();
  }
}
