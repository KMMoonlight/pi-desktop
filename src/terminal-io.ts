import type { Terminal } from "@xterm/xterm";
import type { TerminalQuery } from "../shared/types";
import type { TerminalEffectFrame } from "../shared/terminal-effect.ts";
import type { TerminalEffects } from "./terminal-effects.ts";

const colorReply =
  /^(?:\x1b\](?:10;|11;|4;\d+;)[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[\?[\d;]*c)$/;

/** Serialize probes with PTY output so only a probe's own replies are intercepted. */
export class TerminalIO {
  private writes = Promise.resolve();
  private probe?: string[];
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
      if (this.probe && colorReply.test(data)) this.probe.push(data);
      else sendInput(data);
    });
  }

  write(data: string, frame?: TerminalEffectFrame) {
    this.enqueue(data, undefined, frame);
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

  private enqueue(data: string, id?: string, frame?: TerminalEffectFrame) {
    const generation = this.generation;
    this.writes = this.writes.then(() => {
      if (this.closed || generation !== this.generation) return;
      return new Promise<void>((resolve) => {
        const replies = id ? ([] as string[]) : undefined;
        this.probe = replies;
        this.effects?.begin(id ? undefined : frame);
        this.terminal.write(data, () => {
          this.probe = undefined;
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
