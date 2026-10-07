import type { DesktopInputResult } from "../shared/desktop-ui.ts";
import type { DesktopTui } from "./tui-api.ts";

type Listener = Parameters<DesktopTui["addInputListener"]>[0];
interface KeyApi {
  matchesKey(data: string, key: string): boolean;
}

/** Direct registrations follow the interactive workspace, rather than a factory or session. */
export class TerminalInputScope {
  private listeners = new Set<Listener>();
  private active = true;
  private onDebug: DesktopTui["onDebug"];
  private debugReceiver?: DesktopTui;
  private rendererListeners?: Set<Listener>;

  constructor(
    private keys: () => KeyApi | undefined,
    private intercept: (data: string) => boolean,
  ) {}

  get hasHooks() {
    return (
      this.active &&
      (this.listeners.size > 0 ||
        !!this.rendererListeners?.size ||
        !!this.onDebug)
    );
  }

  add(listener: Listener) {
    const listeners = this.listeners;
    if (this.active) listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  remove(listener: Listener) {
    this.listeners.delete(listener);
  }

  bind(tui: DesktopTui, renderer = false) {
    // Fullscreen's constructor registers its viewport hook before extensions.
    // Keep that original live Set and run it once before desktop/global hooks.
    if (renderer) this.rendererListeners = Reflect.get(tui, "inputListeners");
    tui.addInputListener = (listener) => this.add(listener);
    tui.removeInputListener = (listener) => this.remove(listener);
    Object.defineProperty(tui, "onDebug", {
      configurable: true,
      get: () => this.onDebug,
      set: (value: DesktopTui["onDebug"]) => {
        if (!this.active) return;
        this.onDebug = value;
        this.debugReceiver = value ? tui : undefined;
      },
    });
  }

  replaceRenderer() {
    this.listeners = new Set();
    this.rendererListeners = undefined;
  }

  run(
    data: string,
    cancelled: () => boolean = () => false,
  ): DesktopInputResult {
    const inactive = () => !this.active || cancelled();
    if (inactive()) return { consume: true };
    for (const listener of this.rendererListeners ?? []) {
      const result = listener(data);
      if (inactive() || result?.consume) return { consume: true };
      if (result?.data !== undefined) data = result.data;
    }
    if (this.listeners.size > 0) {
      // Pi iterates a live Set: deletion, insertion and duplicate registration
      // during the current event must retain the same behavior.
      for (const listener of this.listeners) {
        const result = listener(data);
        if (inactive() || result?.consume) return { consume: true };
        if (result?.data !== undefined) data = result.data;
      }
      if (data.length === 0) return { consume: true };
    }
    if (this.keys()?.matchesKey(data, "shift+ctrl+d") && this.onDebug) {
      this.onDebug.call(this.debugReceiver);
      return { consume: true };
    }
    if (this.intercept(data) || inactive()) return { consume: true };
    return { consume: false, data };
  }

  retire() {
    this.active = false;
    this.listeners.clear();
    this.rendererListeners = undefined;
    this.onDebug = undefined;
    this.debugReceiver = undefined;
  }
}

export class TerminalInputPipeline {
  private keys?: KeyApi;
  private interceptor?: (data: string) => boolean;
  private scope = this.createScope();

  private createScope() {
    return new TerminalInputScope(
      () => this.keys,
      (data) => this.interceptor?.(data) === true,
    );
  }

  initialize(keys: KeyApi) {
    this.keys = keys;
  }

  setInterceptor(interceptor: (data: string) => boolean) {
    this.interceptor = interceptor;
  }

  capture() {
    return this.scope;
  }

  reset() {
    this.scope.retire();
    this.scope = this.createScope();
  }
}
