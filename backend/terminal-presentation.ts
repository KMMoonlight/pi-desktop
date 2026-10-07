import type { DesktopTui } from "./tui-api.ts";

type SchemeListener = Parameters<DesktopTui["onTerminalColorSchemeChange"]>[0];
type QueryOptions = Parameters<DesktopTui["queryTerminalColors"]>[0];
interface PresentationHost {
  settings(): { cursor: boolean; clearOnShrink: boolean };
  subscribe(listener: SchemeListener): () => void;
  query(
    options: QueryOptions,
    signal: AbortSignal,
  ): ReturnType<DesktopTui["queryTerminalColors"]>;
  title(value: string): void;
  progress(owner: object, value: boolean): void;
}
interface Binding {
  cursor(value: boolean): void;
  clearOnShrink(value: boolean): void;
}

/** Terminal state follows the interactive workspace, not a presentation factory or session. */
export class TerminalPresentationScope {
  private controller = new AbortController();
  private owner = {};
  private bindings = new Set<Binding>();
  private listeners = new Set<SchemeListener>();
  private unsubscribe?: () => void;
  private notifications = false;
  private initialized = false;
  private cursor = false;
  private clearOnShrink = false;

  constructor(private host: PresentationHost) {}

  private initialize() {
    if (this.initialized || this.controller.signal.aborted) return;
    this.initialized = true;
    const settings = this.host.settings();
    this.cursor = settings.cursor;
    this.clearOnShrink = settings.clearOnShrink;
    this.unsubscribe = this.host.subscribe((scheme) => {
      if (!this.notifications || this.controller.signal.aborted) return;
      for (const listener of this.listeners) {
        listener(scheme);
        if (this.controller.signal.aborted) return;
      }
    });
  }

  setTitle = (value: string) => {
    if (!this.controller.signal.aborted) this.host.title(value);
  };

  setProgress = (value: boolean) => {
    if (!this.controller.signal.aborted) this.host.progress(this.owner, value);
  };

  queryColors = (options: QueryOptions) =>
    this.host.query(options, this.controller.signal);

  bind(tui: DesktopTui, bindTerminal = true) {
    this.initialize();
    const binding: Binding = {
      cursor: tui.setShowHardwareCursor.bind(tui),
      clearOnShrink: tui.setClearOnShrink.bind(tui),
    };
    if (!this.controller.signal.aborted) {
      this.bindings.add(binding);
      binding.cursor(this.cursor);
      binding.clearOnShrink(this.clearOnShrink);
    }
    tui.getShowHardwareCursor = () => this.cursor;
    tui.setShowHardwareCursor = (value) => {
      if (this.controller.signal.aborted || value === this.cursor) return;
      this.cursor = value;
      for (const item of this.bindings) item.cursor(value);
    };
    tui.getClearOnShrink = () => this.clearOnShrink;
    tui.setClearOnShrink = (value) => {
      if (this.controller.signal.aborted) return;
      this.clearOnShrink = value;
      for (const item of this.bindings) item.clearOnShrink(value);
    };
    if (bindTerminal) {
      tui.onTerminalColorSchemeChange = (listener) => {
        if (!this.controller.signal.aborted) this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      };
      tui.setTerminalColorSchemeNotifications = (value) => {
        if (!this.controller.signal.aborted) this.notifications = value;
      };
      tui.queryTerminalColors = this.queryColors;
      tui.terminal.setTitle = this.setTitle;
      tui.terminal.setProgress = this.setProgress;
    }
    return () => this.bindings.delete(binding);
  }

  retire() {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    this.listeners.clear();
    this.bindings.clear();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.host.progress(this.owner, false);
  }
}

export class TerminalPresentationPipeline {
  private scope: TerminalPresentationScope;

  constructor(private host: PresentationHost) {
    this.scope = new TerminalPresentationScope(host);
  }

  capture() {
    return this.scope;
  }

  reset() {
    this.scope.retire();
    this.scope = new TerminalPresentationScope(this.host);
  }
}
