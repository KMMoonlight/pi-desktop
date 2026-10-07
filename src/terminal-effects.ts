import type { Terminal } from "@xterm/xterm";
import type {
  TerminalEffect,
  TerminalEffectDelivery,
  TerminalEffectFrame,
} from "../shared/terminal-effect.ts";

/** xterm parses split OSC sequences; effects retain their originating output frame. */
export class TerminalEffects {
  private frame?: TerminalEffectDelivery;
  private generation = 0;
  private closed = false;
  private pending = Promise.resolve();
  private handlers;

  constructor(
    terminal: { parser: Pick<Terminal["parser"], "registerOscHandler"> },
    private receive: (
      effect: TerminalEffect,
      delivery: TerminalEffectDelivery,
    ) => Promise<unknown>,
    private error: (error: unknown) => void = console.error,
  ) {
    const title = (title: string) => {
      this.emit({ type: "title", title });
      return false;
    };
    this.handlers = [
      terminal.parser.registerOscHandler(0, title),
      terminal.parser.registerOscHandler(2, title),
      terminal.parser.registerOscHandler(9, (data) => {
        const [operation, state] = data.split(";");
        if (operation !== "4" || !state || !/^[0-4]$/.test(state)) return false;
        this.emit({ type: "progress", active: state !== "0" });
        return true;
      }),
      terminal.parser.registerOscHandler(52, (data) => {
        const separator = data.indexOf(";");
        if (separator < 0) return false;
        const selection = data.slice(0, separator);
        const encoded = data.slice(separator + 1);
        if (encoded === "?" || (selection && !selection.includes("c")))
          return false;
        if (
          encoded.length > 100000 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            encoded,
          )
        )
          return true;
        try {
          const bytes = Uint8Array.from(atob(encoded), (character) =>
            character.charCodeAt(0),
          );
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          this.emit({ type: "clipboard", text });
        } catch {
          /* Invalid payloads never become clipboard writes. */
        }
        return true;
      }),
    ];
  }

  begin(frame?: TerminalEffectFrame) {
    this.frame = frame ? { ...frame, index: 0 } : undefined;
  }
  end() {
    this.frame = undefined;
  }
  reset() {
    this.generation++;
    this.end();
  }
  private emit(effect: TerminalEffect) {
    if (this.closed || !this.frame) return;
    const delivery = { ...this.frame, index: ++this.frame.index };
    const generation = this.generation;
    // Parsing keeps running while the SDK worker is blocked in spawnSync.
    this.pending = this.pending
      .then(async () => {
        if (!this.closed && generation === this.generation)
          await this.receive(effect, delivery);
      })
      .catch((error) => {
        if (!this.closed && generation === this.generation) this.error(error);
      });
  }
  dispose() {
    this.closed = true;
    this.reset();
    for (const handler of this.handlers) handler.dispose();
  }
}
