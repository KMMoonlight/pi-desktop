import { t, useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { action, subscribeTerminal } from "./client";
import { TerminalIO } from "./terminal-io";
import { TerminalAppearance } from "./terminal-appearance";
import { TerminalEffects } from "./terminal-effects";
import { ShellTerminal, type ShellTerminalHandle } from "./ShellTerminal";
import {
  Eraser,
  Square,
  RotateCcw,
  X,
  Terminal as TerminalIcon,
} from "lucide-react";
import { IconButton } from "./ui";
import type {
  TerminalEffect,
  TerminalEffectDelivery,
} from "../shared/terminal-effect";
import type { TerminalQuery } from "../shared/types";

type Chunk = { sequence: number; data: string };
export function TerminalPanel({
  open,
  onOpenChange,
  cwd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cwd?: string;
}) {
  useLocale();
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | undefined>(undefined);
  const fit = useRef<FitAddon | undefined>(undefined);
  const shell = useRef<ShellTerminalHandle>(null);
  const [source, setSource] = useState<"shell" | "pi">("shell");
  const [shellCwd, setShellCwd] = useState<string>();
  const [shellState, setShellState] = useState<{
    error: string;
    exitCode?: number;
  }>({ error: "" });
  useEffect(() => {
    if (open && source === "shell" && cwd) setShellCwd(cwd);
  }, [open, source, cwd]);
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem("pi.terminalHeight"));
    return Number.isFinite(saved) && saved >= 160
      ? Math.min(saved, innerHeight * 0.6)
      : Math.min(300, innerHeight * 0.45);
  });
  const drag = useRef<{ y: number; height: number } | undefined>(undefined);
  const resize = (next: number) => {
    const value = Math.max(160, Math.min(next, innerHeight * 0.6));
    setHeight(value);
    localStorage.setItem("pi.terminalHeight", String(value));
  };
  const [error, setError] = useState("");
  const [exitCode, setExitCode] = useState<number>();
  const [mount] = useState(() => document.createElement("div"));
  const requestedHeight = useRef(height);
  requestedHeight.current = height;
  useEffect(() => {
    const dock = mount.parentElement;
    if (!dock?.matches("[data-workspace-terminal-dock]")) return;
    // Give the flex item its requested size before its contents fill 100%.
    // Otherwise the percentage-sized child can keep the dock at its old height.
    dock.style.height = open ? `${height}px` : "";
    return () => { dock.style.height = ""; };
  }, [mount, open, height]);
  useEffect(() => {
    // Keep one xterm instance while moving it into an extension modal's focus
    // scope. A terminal behind the backdrop cannot receive real pointer input.
    const place = () => {
      const dock = open ? document.querySelector("[data-terminal-dock]") : null;
      const destination =
        dock ??
        document.querySelector("[data-workspace-terminal-dock]") ??
        document.body;
      if (mount.parentElement !== destination) {
        if (mount.parentElement?.matches("[data-workspace-terminal-dock]"))
          mount.parentElement.style.height = "";
        destination.appendChild(mount);
      }
      if (destination.matches("[data-workspace-terminal-dock]"))
        (destination as HTMLElement).style.height = open ? `${requestedHeight.current}px` : "";
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mount.remove();
    };
  }, [mount, open]);
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: getComputedStyle(document.documentElement)
        .getPropertyValue("--ui-terminal-font")
        .trim(),
      minimumContrastRatio: 4.5,
      scrollback: 5000,
      theme: { background: "#13161c", foreground: "#e4e7ed" },
    });
    const addon = new FitAddon();
    terminal.current = term;
    fit.current = addon;
    term.loadAddon(addon);
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
        if (container.current?.clientWidth && container.current.clientHeight) addon.fit();
      }
    };
    theme();
    const themeObserver = new MutationObserver(theme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    let disposed = false;
    let sequence = 0;
    let terminalId: string | undefined;
    let initialized = false;
    let queue: Chunk[] = [];
    let queries: TerminalQuery[] = [];
    let unlisten: (() => void) | undefined;
    let synchronization = 0;
    let writes = Promise.resolve();
    const send = (name: string, args: Record<string, unknown>) => {
      writes = writes
        .then(() => action(name, args))
        .then(
          () => {},
          (reason) => {
            if (!disposed) setError(String(reason));
          },
        );
    };
    const io = new TerminalIO(
      term,
      (data) => {
        while (data.length) {
          let end = Math.min(16384, data.length);
          if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
          send("terminal.input", { data: data.slice(0, end) });
          data = data.slice(end);
        }
      },
      (id, data) => send("terminal.query.reply", { id, data }),
      new TerminalEffects(
        term,
        (effect, delivery) =>
          action("terminal.effect", { effect, ...delivery }),
        (reason) => {
          if (!disposed) setError(String(reason));
        },
      ),
    );
    const resized = term.onResize(({ cols, rows }) =>
      send("terminal.resize", { cols, rows }),
    );
    const receive = (chunk: Chunk, replay = false) => {
      if (chunk.sequence <= sequence) return;
      sequence = chunk.sequence;
      const write = replay ? io.replay.bind(io) : io.write.bind(io);
      write(
        chunk.data,
        terminalId ? { terminalId, sequence: chunk.sequence } : undefined,
      );
    };
    const query = (request: TerminalQuery) => {
      if (disposed) return;
      if (initialized) io.query(request);
      else queries.push(request);
    };
    const synchronize = async (restarted = false) => {
      const id = ++synchronization;
      initialized = false;
      if (restarted) {
        sequence = 0;
        queue = [];
        queries = [];
        io.reset();
        appearance.reset();
        setExitCode(undefined);
        setError("");
      }
      const state = await action<{
        terminalId: string;
        chunks: Chunk[];
        exitCode?: number;
      }>("terminal.snapshot");
      if (disposed || id !== synchronization) return;
      terminalId = state.terminalId;
      state.chunks.forEach((chunk) => receive(chunk, true));
      queue.forEach((chunk) => receive(chunk));
      queue = [];
      initialized = true;
      queries.forEach((request) => io.query(request));
      queries = [];
      setExitCode(state.exitCode);
    };
    void (async () => {
      unlisten = await subscribeTerminal(
        (event) => {
          if (disposed) return;
          if (event.type === "terminal_output") {
            if (initialized) receive(event);
            else queue.push(event);
          }
          if (event.type === "activity" && event.name === "terminal_active") {
            setSource("pi");
            onOpenChange(true);
          }
          if (event.type === "terminal_exit") setExitCode(event.exitCode);
          if (event.type === "terminal_query") query(event);
        },
        (connected, restarted) => {
          if (!connected) {
            synchronization++;
            initialized = false;
          }
          if (connected && !disposed) {
            void synchronize(restarted).catch((reason) => {
              if (!disposed) setError(String(reason));
            });
            void action<TerminalQuery[]>("terminal.query.list")
              .then((requests) => requests.forEach(query))
              .catch((reason) => {
                if (!disposed) setError(String(reason));
              });
          }
        },
      );
      if (disposed) {
        unlisten();
        return;
      }
    })().catch((reason) => {
      if (!disposed) setError(String(reason));
    });
    const observer = new ResizeObserver(() => {
      if (container.current?.clientWidth && container.current.clientHeight)
        addon.fit();
    });
    observer.observe(container.current!);
    return () => {
      disposed = true;
      observer.disconnect();
      themeObserver.disconnect();
      appearance.dispose();
      unlisten?.();
      io.dispose();
      resized.dispose();
      term.dispose();
    };
  }, []);
  useEffect(() => {
    if (open && source === "pi") {
      fit.current?.fit();
      terminal.current?.focus();
    }
    if (open && source === "shell") shell.current?.focus();
  }, [open, source]);
  const currentExitCode = source === "shell" ? shellState.exitCode : exitCode;
  const currentError = source === "shell" ? shellState.error : error;
  return createPortal(
    <section
      className={`terminal-panel ${open ? "is-open" : ""}`}
      id="pi-terminal-panel"
      data-theme="dark"
      style={{ height: open ? height : undefined }}
      aria-label={t("Pi 终端")}
      data-desktop-native-input
    >
      {open && (
        <div
          className="terminal-resizer"
          role="separator"
          aria-label={t("调整终端高度")}
          aria-orientation="horizontal"
          aria-valuemin={160}
          aria-valuemax={Math.round(innerHeight * 0.6)}
          aria-valuenow={Math.round(height)}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              resize(height + (event.key === "ArrowUp" ? 24 : -24));
            }
          }}
          onPointerDown={(event) => {
            drag.current = { y: event.clientY, height };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current)
              resize(drag.current.height + drag.current.y - event.clientY);
          }}
          onPointerUp={() => {
            drag.current = undefined;
          }}
          onLostPointerCapture={() => {
            drag.current = undefined;
          }}
        />
      )}
      <header>
        <button
          className="terminal-title"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-label={open ? t("收起终端") : t("终端")}
        >
          <TerminalIcon size={14} /> {t("终端")}
        </button>
        {open && (
          <div
            className="terminal-sources"
            role="group"
            aria-label={t("终端类型")}
          >
            <button
              aria-pressed={source === "shell"}
              onClick={() => setSource("shell")}
            >
              Shell
            </button>
            <button
              aria-pressed={source === "pi"}
              onClick={() => setSource("pi")}
            >
              {t("Pi 扩展")}
            </button>
          </div>
        )}
        {currentExitCode !== undefined && (
          <span>
            {t("已退出 ·")} {currentExitCode}
          </span>
        )}
        {open && (
          <div className="terminal-actions">
            {currentExitCode === undefined && (
              <IconButton
                icon={Square}
                label={t("中断 Ctrl+C")}
                onClick={() =>
                  source === "shell"
                    ? shell.current?.interrupt()
                    : void action("terminal.input", { data: "\x03" })
                        .then(() => terminal.current?.focus())
                        .catch((reason) => setError(String(reason)))
                }
              />
            )}
            {source === "shell" && currentExitCode !== undefined && (
              <IconButton
                icon={RotateCcw}
                label={t("重新启动终端")}
                onClick={() => shell.current?.restart()}
              />
            )}
            <IconButton
              icon={Eraser}
              label={t("清屏")}
              onClick={() => {
                if (source === "shell") shell.current?.clear();
                else {
                  terminal.current?.clear();
                  terminal.current?.focus();
                }
              }}
            />
            <IconButton
              icon={X}
              label={t("关闭终端")}
              onClick={() => onOpenChange(false)}
            />
          </div>
        )}
      </header>
      {currentError && open && <p role="alert">{currentError}</p>}
      <div
        ref={container}
        className="terminal-viewport"
        hidden={source !== "pi"}
        data-terminal-source="pi"
      />
      {shellCwd === cwd && cwd && (
        <ShellTerminal
          key={cwd}
          ref={shell}
          active={open && source === "shell"}
          onState={(error, exitCode) => setShellState({ error, exitCode })}
        />
      )}
    </section>,
    mount,
  );
}

/** ANSI fallback keeps the original component's input handler and callbacks. */
export function ComponentTerminal({
  action,
  data,
  effectSequence,
  cols,
  rows,
  cursor,
  showCursor,
  onInput,
  onEffect,
}: {
  action: string;
  data: string;
  effectSequence?: number;
  cols: number;
  rows: number;
  cursor?: { row: number; col: number };
  showCursor?: boolean;
  onInput(data: string): void;
  onEffect(
    effect: TerminalEffect,
    delivery: TerminalEffectDelivery,
  ): Promise<unknown>;
}) {
  useLocale();
  const element = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | undefined>(undefined);
  const callback = useRef(onInput);
  const effectCallback = useRef(onEffect);
  const io = useRef<TerminalIO | undefined>(undefined);
  const frame = useRef({ data: undefined as string | undefined, sequence: 0 });
  callback.current = onInput;
  effectCallback.current = onEffect;
  useEffect(() => {
    const terminal = new Terminal({
      cols,
      rows,
      fontSize: 13,
      scrollback: 0,
      convertEol: true,
      cursorBlink: true,
    });
    term.current = terminal;
    terminal.open(element.current!);
    terminal.attachCustomKeyEventHandler(() => false);
    terminal.textarea!.dataset.desktopRawInput = "true";
    const input = new TerminalIO(
      terminal,
      (value) => callback.current(value),
      () => {},
      new TerminalEffects(terminal, (effect, delivery) =>
        effectCallback.current(effect, delivery),
      ),
    );
    io.current = input;
    return () => {
      input.dispose();
      io.current = undefined;
      terminal.dispose();
    };
  }, []);
  useEffect(() => {
    term.current?.resize(cols, rows);
    const position = cursor
      ? `\x1b[${Math.min(rows, cursor.row + 1)};${Math.min(cols, cursor.col + 1)}H`
      : "";
    const changed = frame.current.data !== data;
    if (changed) {
      frame.current.data = data;
      frame.current.sequence++;
    }
    io.current?.write(
      "\x1b[?2004h\x1b[?25l\x1b[H\x1b[2J" +
        data +
        position +
        (cursor && showCursor ? "\x1b[?25h" : ""),
      changed
        ? { sequence: effectSequence ?? frame.current.sequence }
        : undefined,
    );
  }, [data, effectSequence, cols, rows, cursor?.row, cursor?.col, showCursor]);
  return (
    <div
      ref={element}
      className="component-terminal"
      data-desktop-action={action}
      data-terminal-cols={cols}
      data-terminal-rows={rows}
      aria-label={t("扩展终端组件")}
      style={{ height: `${rows * 16 + 8}px` }}
    />
  );
}
