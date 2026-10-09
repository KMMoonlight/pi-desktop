import { EventEmitter } from "node:events";
import { createServer, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { spawn, type IPty } from "node-pty";
import { parseTerminalEffect } from "../shared/terminal-effect.ts";
import { isConPtyStartupTitle } from "./conpty-startup.ts";
import { ShellTerminal } from "./shell-terminal.ts";
import { listSystemFonts } from "./system-fonts.ts";
import type {
  ActionRequest,
  DesktopSnapshot,
  DialogRequest,
} from "../shared/types.ts";

/** Owns the PTY outside the SDK event loop, including during spawnSync. */
export class TerminalHost extends EventEmitter {
  private readonly terminalId = randomBytes(16).toString("hex");
  private lastEffect = { sequence: 0, index: 0 };
  private firstTitle = true;
  private pty?: IPty;
  private shell?: ShellTerminal;
  private channel?: Socket;
  private ready: Promise<void>;
  private pending = new Map<
    string,
    { resolve(value: any): void; reject(error: Error): void }
  >();
  private sequence = 0;
  private outputSequence = 0;
  private chunks: { sequence: number; data: string }[] = [];
  private outputLength = 0;
  private latest?: DesktopSnapshot;
  private dialogs = new Map<string, DialogRequest>();
  private closed = false;
  private disposal?: Promise<void>;
  private exitCode?: number;
  private shutdownReceived = false;
  private resolveExit!: () => void;
  private exited = new Promise<void>((resolve) => {
    this.resolveExit = resolve;
  });
  constructor() {
    super();
    this.ready = this.start();
    // Startup errors also remain available to the first action caller.
    void this.ready.catch(() => {});
  }
  get runtime() {
    return this.latest;
  }
  snapshot() {
    return this.latest;
  }
  get pendingDialogs() {
    return [...this.dialogs.values()];
  }
  private async start() {
    const token = randomBytes(16).toString("hex");
    const listener = createServer();
    const sockets = new Set<Socket>();
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectConnection: (error: Error) => void = () => {};
    const cleanup = () => {
      try {
        this.pty?.kill();
      } catch {}
    };
    process.once("exit", cleanup);
    try {
      await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
      });
      const address = listener.address();
      if (!address || typeof address === "string")
        throw new Error("Missing PTY channel");
      const connected = new Promise<void>((resolve, reject) => {
        rejectConnection = reject;
        listener.on("error", reject);
        startupTimer = setTimeout(
          () => reject(new Error("PTY SDK startup timed out")),
          30000,
        );
        startupTimer.unref();
        listener.on("connection", (socket) => {
          sockets.add(socket);
          socket.setTimeout(5000, () => socket.destroy());
          let authenticated = false;
          const lines = createInterface({ input: socket });
          lines.on("line", (line) => {
            if (!authenticated) {
              if (line !== token || this.channel) {
                socket.destroy();
                return;
              }
              authenticated = true;
              socket.setTimeout(0);
              socket.setNoDelay(true);
              this.channel = socket;
              clearTimeout(startupTimer);
              listener.close();
              for (const peer of sockets) if (peer !== socket) peer.destroy();
              resolve();
              return;
            }
            try {
              const packet = JSON.parse(line);
              if (packet.event) {
                const event = packet.event;
                if (event.type === "snapshot") {
                  this.latest = event.data;
                  if (this.shell && this.shell.cwd !== event.data.cwd) {
                    this.shell.dispose();
                    this.shell = undefined;
                  }
                }
                if (event.type === "workspace_closed") {
                  this.latest = undefined;
                  this.shell?.dispose();
                  this.shell = undefined;
                }
                if (event.type === "dialog")
                  this.dialogs.set(event.data.id, event.data);
                if (event.type === "dialog_closed")
                  this.dialogs.delete(event.id);
                if (event.type === "shutdown") this.shutdownReceived = true;
                this.emit("event", event);
              }
              const pending = this.pending.get(packet.id);
              if (pending) {
                this.pending.delete(packet.id);
                if (typeof packet.error === "string")
                  pending.reject(new Error(packet.error));
                else pending.resolve(packet.data);
              }
            } catch (error) {
              this.emit("event", {
                type: "notice",
                level: "error",
                message: String(error),
              });
            }
          });
          lines.on("error", (error) => {
            if (authenticated) this.failPending(error);
            socket.destroy();
          });
          socket.on("error", () => {});
          socket.on("close", () => {
            sockets.delete(socket);
            lines.close();
            if (authenticated) {
              if (this.channel === socket) this.channel = undefined;
              this.failPending(new Error("Pi SDK terminal connection closed"));
            }
          });
        });
      });
      // A synchronous spawn failure can precede the await below.
      void connected.catch(() => {});
      const entry = fileURLToPath(
        new URL(
          import.meta.url.endsWith(".ts") ? "./server.ts" : "./server.mjs",
          import.meta.url,
        ),
      );
      this.pty = spawn(
        process.execPath,
        [...process.execArgv, entry, "--sdk-worker", "--desktop-channel"],
        {
          name: "xterm-256color",
          cols: 100,
          rows: 30,
          cwd: process.cwd(),
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            PI_DESKTOP_PTY: "1",
            PI_DESKTOP_CHANNEL_PORT: String(address.port),
            PI_DESKTOP_CHANNEL_TOKEN: token,
          },
        },
      );
      this.pty.onData((data) => {
        const chunk = { sequence: ++this.outputSequence, data };
        this.chunks.push(chunk);
        this.outputLength += data.length;
        while (this.outputLength > 2_000_000 && this.chunks.length > 1)
          this.outputLength -= this.chunks.shift()!.data.length;
        this.emit("event", { type: "terminal_output", ...chunk });
      });
      this.pty.onExit(({ exitCode }) => {
        this.shell?.dispose();
        this.exitCode = exitCode;
        this.closed = true;
        process.removeListener("exit", cleanup);
        const error = new Error(`Pi SDK terminal exited (${exitCode})`);
        rejectConnection(error);
        this.failPending(error);
        this.channel?.destroy();
        this.dialogs.clear();
        this.resolveExit();
        this.emit("event", { type: "terminal_exit", exitCode });
      });
      await connected;
    } catch (error) {
      cleanup();
      if (!this.pty) {
        this.closed = true;
        this.resolveExit();
        process.removeListener("exit", cleanup);
      }
      throw error;
    } finally {
      clearTimeout(startupTimer);
      if (listener.listening) listener.close();
      for (const socket of sockets)
        if (socket !== this.channel) socket.destroy();
    }
  }
  private failPending(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  async action(request: ActionRequest): Promise<any> {
    if (request.action === "shutdown") {
      await this.dispose();
      return null;
    }
    if (request.action === "fonts.list") {
      if (this.closed || this.disposal) throw new Error("Pi SDK terminal has exited");
      return listSystemFonts(request.args?.refresh === true);
    }
    await this.ready;
    const args = request.args ?? {};
    if (request.action.startsWith("shell.")) {
      if (this.closed || this.disposal)
        throw new Error("Pi SDK terminal has exited");
      const cwd = this.latest?.cwd;
      if (!cwd) throw new Error("Select a workspace first");
      if (
        request.action === "shell.snapshot" ||
        request.action === "shell.restart"
      ) {
        if (
          !this.shell ||
          this.shell.cwd !== cwd ||
          request.action === "shell.restart"
        ) {
          this.shell?.dispose();
          this.shell = undefined;
          this.shell = new ShellTerminal(cwd, (event) =>
            this.emit("event", event),
          );
        }
        return this.shell.snapshot();
      }
      if (!this.shell || this.shell.cwd !== cwd)
        throw new Error("Shell terminal changed");
      return this.shell.action(request.action, args);
    }
    if (request.action === "terminal.snapshot")
      return {
        terminalId: this.terminalId,
        chunks: this.chunks,
        sequence: this.outputSequence,
        exitCode: this.exitCode,
        cols: this.pty!.cols,
        rows: this.pty!.rows,
      };
    if (this.closed) throw new Error("Pi SDK terminal has exited");
    if (request.action === "terminal.effect") {
      if (args.terminalId !== this.terminalId) return null;
      const sequence = Number(args.sequence),
        index = Number(args.index);
      if (
        !Number.isSafeInteger(sequence) ||
        sequence < 1 ||
        sequence > this.outputSequence ||
        !Number.isSafeInteger(index) ||
        index < 1
      )
        throw new Error("Invalid terminal effect delivery");
      const effect = parseTerminalEffect(args.effect);
      if (
        sequence < this.lastEffect.sequence ||
        (sequence === this.lastEffect.sequence &&
          index <= this.lastEffect.index)
      )
        return null;
      this.lastEffect = { sequence, index };
      if (this.disposal) throw new Error("Pi SDK terminal is shutting down");
      if (effect.type === "title" && this.firstTitle) {
        this.firstTitle = false;
        // ConPTY prefixes its first console write with the worker's default title.
        // That initialization frame is not an SDK window-title operation.
        if (
          process.platform === "win32" &&
          isConPtyStartupTitle(
            this.chunks
              .filter((chunk) => chunk.sequence <= sequence)
              .map((chunk) => chunk.data)
              .join(""),
            effect.title,
            process.execPath,
          )
        )
          return null;
      }
      return this.requestSdk({ action: "terminal.effect", args: { effect } });
    }
    if (request.action === "terminal.input") {
      if (typeof args.data !== "string" || args.data.length > 65536)
        throw new Error("Invalid terminal input");
      this.pty!.write(args.data);
      return null;
    }
    if (request.action === "terminal.resize") {
      const { cols, rows } = args;
      if (
        !Number.isInteger(cols) ||
        !Number.isInteger(rows) ||
        Number(cols) < 2 ||
        Number(cols) > 500 ||
        Number(rows) < 1 ||
        Number(rows) > 300
      )
        throw new Error("Invalid terminal size");
      this.pty!.resize(Number(cols), Number(rows));
      return null;
    }
    if (this.disposal) throw new Error("Pi SDK terminal is shutting down");
    return this.requestSdk(request);
  }
  private requestSdk(request: ActionRequest): Promise<any> {
    const channel = this.channel;
    if (!channel || channel.destroyed || channel.writableEnded)
      return Promise.reject(new Error("Pi SDK terminal connection closed"));
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        channel.write(JSON.stringify({ ...request, id }) + "\n", (error) => {
          if (error) {
            this.pending.delete(id);
            reject(error);
          }
        });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  dispose(): Promise<void> {
    return (this.disposal ??= Promise.resolve().then(async () => {
      this.shell?.dispose();
      let failure: unknown;
      try {
        await this.ready;
        if (!this.closed && !this.shutdownReceived && this.channel)
          await this.requestSdk({ action: "shutdown" });
      } catch (error) {
        failure = error;
      }
      await this.exited;
      if (this.exitCode && !failure)
        failure = new Error(`Pi SDK terminal exited (${this.exitCode})`);
      if (failure && !(this.shutdownReceived && this.exitCode === 0))
        throw failure;
    }));
  }
}
