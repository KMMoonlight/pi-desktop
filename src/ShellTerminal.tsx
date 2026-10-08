import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { action, subscribeTerminal } from "./client";
import { TerminalAppearance } from "./terminal-appearance";
import { TerminalIO } from "./terminal-io";
import type { DesktopEvent } from "../shared/types";

export type ShellTerminalHandle = {
  focus(): void;
  clear(): void;
  interrupt(): void;
  restart(): void;
};

export function ShellTerminal({
  active,
  ref,
  onState,
}: {
  active: boolean;
  ref: Ref<ShellTerminalHandle>;
  onState(error: string, exitCode?: number): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef<ShellTerminalHandle | null>(null);
  const state = useRef(onState);
  state.current = onState;
  useImperativeHandle(
    ref,
    () => ({
      focus: () => controls.current?.focus(),
      clear: () => controls.current?.clear(),
      interrupt: () => controls.current?.interrupt(),
      restart: () => controls.current?.restart(),
    }),
    [],
  );
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: getComputedStyle(document.documentElement)
        .getPropertyValue("--ui-terminal-font")
        .trim(),
      minimumContrastRatio: 4.5,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current!);
    const appearance = new TerminalAppearance(term);
    const theme = () => {
      const styles = getComputedStyle(document.documentElement);
      appearance.update(
        styles.getPropertyValue("--ui-terminal-background").trim(),
        styles.getPropertyValue("--ui-terminal-foreground").trim(),
      );
      const fontFamily = styles.getPropertyValue("--ui-terminal-font").trim();
      if (term.options.fontFamily !== fontFamily) {
        term.options.fontFamily = fontFamily;
        if (container.current?.clientWidth && container.current.clientHeight) fit.fit();
      }
    };
    theme();
    const themeObserver = new MutationObserver(theme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    let disposed = false;
    let terminalId: string | undefined;
    let sequence = 0;
    let initialized = false;
    let generation = 0;
    let exitCode: number | undefined;
    let queue: Extract<
      DesktopEvent,
      { type: "shell_output" | "shell_exit" }
    >[] = [];
    let unlisten: (() => void) | undefined;
    let writes = Promise.resolve();
    const error = (reason: unknown) => {
      if (!disposed) state.current(String(reason), exitCode);
    };
    const send = (name: string, args: Record<string, unknown>) => {
      if (!initialized || !terminalId || exitCode !== undefined) return;
      const id = terminalId;
      writes = writes
        .then(() => action(name, { ...args, terminalId: id }))
        .then(() => {}, error);
    };
    const receive = (event: (typeof queue)[number], replay = false) => {
      if (event.terminalId !== terminalId) return;
      if (event.type === "shell_exit") {
        exitCode = event.exitCode;
        state.current("", exitCode);
      } else if (event.sequence > sequence) {
        sequence = event.sequence;
        if (replay) io.replay(event.data);
        else io.write(event.data);
      }
    };
    const synchronize = async (restart = false) => {
      const version = ++generation;
      initialized = false;
      const snapshot = await action<{
        terminalId: string;
        chunks: { sequence: number; data: string }[];
        exitCode?: number;
      }>(restart ? "shell.restart" : "shell.snapshot");
      if (disposed || version !== generation) return;
      if (terminalId !== snapshot.terminalId) {
        terminalId = snapshot.terminalId;
        sequence = 0;
        io.reset();
        appearance.reset();
      }
      exitCode = snapshot.exitCode;
      state.current("", exitCode);
      snapshot.chunks.forEach((chunk) =>
        receive(
          {
            type: "shell_output",
            terminalId: snapshot.terminalId,
            ...chunk,
          },
          true,
        ),
      );
      queue.forEach((event) => receive(event));
      queue = [];
      initialized = true;
      fit.fit();
      send("shell.resize", { cols: term.cols, rows: term.rows });
    };
    const io = new TerminalIO(
      term,
      (data) => {
        while (data.length) {
          let end = Math.min(16384, data.length);
          if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
          send("shell.input", { data: data.slice(0, end) });
          data = data.slice(end);
        }
      },
      () => {},
    );
    const resize = term.onResize(({ cols, rows }) =>
      send("shell.resize", { cols, rows }),
    );
    const observer = new ResizeObserver(() => {
      if (container.current?.clientWidth && container.current.clientHeight)
        fit.fit();
    });
    observer.observe(container.current!);
    controls.current = {
      focus: () => {
        fit.fit();
        term.focus();
      },
      clear: () => {
        term.clear();
        term.focus();
      },
      interrupt: () => {
        send("shell.input", { data: "\x03" });
        term.focus();
      },
      restart: () => {
        void synchronize(true)
          .then(() => term.focus())
          .catch(error);
      },
    };
    void subscribeTerminal(
      (event) => {
        if (
          disposed ||
          (event.type !== "shell_output" && event.type !== "shell_exit")
        )
          return;
        if (initialized) receive(event);
        else queue.push(event);
      },
      (connected) => {
        if (disposed) return;
        if (connected) void synchronize().catch(error);
        else {
          generation++;
          initialized = false;
        }
      },
    )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(error);
    return () => {
      disposed = true;
      controls.current = null;
      unlisten?.();
      observer.disconnect();
      themeObserver.disconnect();
      appearance.dispose();
      io.dispose();
      resize.dispose();
      term.dispose();
    };
  }, []);
  useEffect(() => {
    // Starting a shell can finish after the user has focused the resize handle.
    if (active && !document.activeElement?.matches(".terminal-resizer"))
      controls.current?.focus();
  }, [active]);
  return (
    <div
      ref={container}
      className="terminal-viewport"
      hidden={!active}
      data-terminal-source="shell"
    />
  );
}
