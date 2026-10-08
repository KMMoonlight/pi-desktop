import { randomBytes } from "node:crypto";
import { spawn, type IPty } from "node-pty";
import { getPowerShellConfig } from "@earendil-works/pi-coding-agent";
import type { DesktopEvent, RecordValue } from "../shared/types.ts";

/** A user shell has its own PTY; its input must never reach the SDK worker. */
export class ShellTerminal {
  readonly terminalId = randomBytes(16).toString("hex");
  private pty: IPty;
  private sequence = 0;
  private chunks: { sequence: number; data: string }[] = [];
  private length = 0;
  private exitCode?: number;
  private closed = false;
  private cleanup = () => this.dispose();

  constructor(
    readonly cwd: string,
    emit: (event: DesktopEvent) => void,
  ) {
    const shell =
      process.platform === "win32"
        ? getPowerShellConfig().shell
        : process.env.SHELL || "/bin/sh";
    this.pty = spawn(
      shell,
      process.platform === "win32" ? ["-NoLogo"] : ["-i"],
      {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      },
    );
    process.once("exit", this.cleanup);
    this.pty.onData((data) => {
      if (this.closed) return;
      const chunk = { sequence: ++this.sequence, data };
      this.chunks.push(chunk);
      this.length += data.length;
      while (this.length > 2_000_000 && this.chunks.length > 1)
        this.length -= this.chunks.shift()!.data.length;
      emit({ type: "shell_output", terminalId: this.terminalId, ...chunk });
    });
    this.pty.onExit(({ exitCode }) => {
      if (this.closed) return;
      this.exitCode = exitCode;
      process.removeListener("exit", this.cleanup);
      emit({ type: "shell_exit", terminalId: this.terminalId, exitCode });
    });
  }

  snapshot() {
    return {
      terminalId: this.terminalId,
      chunks: this.chunks,
      exitCode: this.exitCode,
    };
  }

  action(name: string, args: RecordValue) {
    if (args.terminalId !== this.terminalId)
      throw new Error("Shell terminal changed");
    if (this.closed || this.exitCode !== undefined)
      throw new Error("Shell terminal has exited");
    if (name === "shell.input") {
      if (typeof args.data !== "string" || args.data.length > 65536)
        throw new Error("Invalid terminal input");
      this.pty.write(args.data);
    } else if (name === "shell.resize") {
      const cols = Number(args.cols),
        rows = Number(args.rows);
      if (
        !Number.isInteger(cols) ||
        !Number.isInteger(rows) ||
        cols < 2 ||
        cols > 500 ||
        rows < 1 ||
        rows > 300
      )
        throw new Error("Invalid terminal size");
      this.pty.resize(cols, rows);
    } else throw new Error("Unknown shell action");
    return null;
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    process.removeListener("exit", this.cleanup);
    try {
      this.pty.kill();
    } catch {}
  }
}
