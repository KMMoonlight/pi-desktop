import type { Terminal } from "@xterm/xterm";
import type { TerminalQuery } from "../shared/types";
import type { TerminalEffectFrame } from "../shared/terminal-effect.ts";
import type { TerminalEffects } from "./terminal-effects.ts";

const colorReply =
  /^(?:\x1b\](?:10;|11;|4;\d+;)[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[\?[\d;]*c)$/;
const terminalReply =
  /^(?:\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[?>]?[\d;]*(?:[cnRt]|\$y)|\x1bP[^\x1b]*\x1b\\)$/;

/** Serialize probes with PTY output so only a probe's own replies are intercepted. */
export class TerminalIO {
  private writes = Promise.resolve();
  private probe?: string[];
  private replaying = false;
  private seen = new Set<string>();
  private closed = false;
  private generation = 0;
  private input;

  constructor(
    private terminal: Pick<Terminal, "write" | "onData"> &
      Partial<Pick<Terminal, "reset">>,
    sendInput: (data: string) => void,
    private sendReply: (id: string, data: string[]) => void,
    private effects?: TerminalEffects,
  ) {
    this.input = terminal.onData((data) => {
      if (this.replaying && terminalReply.test(data)) return;
      if (this.probe && colorReply.test(data)) this.probe.push(data);
      else sendInput(data);
    });
  }

  write(data: string, frame?: TerminalEffectFrame) {
    this.enqueue(data, undefined, frame);
  }

  /** Historical device queries must not inject replies into today's process. */
  replay(data: string, frame?: TerminalEffectFrame) {
    this.enqueue(data, undefined, frame, true);
  }

  query({ id, data }: TerminalQuery) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 2048)
      this.seen.delete(this.seen.values().next().value!);
    this.enqueue(data, id);
  }

  reset() {
    this.generation++;
    this.seen.clear();
    this.effects?.reset();
    this.writes = this.writes.then(() => {
      if (!this.closed) this.terminal.reset?.();
    });
  }

  private enqueue(
    data: string,
    id?: string,
    frame?: TerminalEffectFrame,
    replay = false,
  ) {
    const generation = this.generation;
    this.writes = this.writes.then(() => {
      if (this.closed || generation !== this.generation) return;
      return new Promise<void>((resolve) => {
        const replies = id ? ([] as string[]) : undefined;
        this.probe = replies;
        this.replaying = replay;
        this.effects?.begin(id ? undefined : frame);
        this.terminal.write(data, () => {
          this.probe = undefined;
          this.replaying = false;
          this.effects?.end();
          if (!this.closed && id && replies) this.sendReply(id, replies);
          resolve();
        });
      });
    });
  }

  dispose() {
    this.closed = true;
    this.effects?.dispose();
    this.input.dispose();
  }
}
