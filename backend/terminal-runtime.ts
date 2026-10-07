import { AsyncLocalStorage } from "node:async_hooks";
import { createDesktopTerminal } from "./detached-tui.ts";
import { RendererTerminal } from "./renderer-terminal.ts";
import { loadTuiApi, type DesktopTui } from "./tui-api.ts";
import {
  componentFocus,
  callComponentMethod,
  loadComponentRuntime,
} from "./component-runtime.ts";
import { ApplicationComponents } from "./application-components.ts";
import type { DesktopSdkContext } from "./sdk-access.ts";
import type { TerminalInputScope } from "./terminal-input.ts";
import type { TerminalPresentationScope } from "./terminal-presentation.ts";
import type { PiComponent } from "./component-runtime.ts";
import type {
  DesktopInputResult,
  DesktopKeyEvent,
  DesktopSlot,
} from "../shared/desktop-ui.ts";

type Target = Parameters<DesktopTui["setFocus"]>[0];
type Handle = ReturnType<DesktopTui["showOverlay"]>;
type ApplicationRegion = DesktopSlot | "resources" | "pending" | "status";
type ContainerComponent = PiComponent & { children: PiComponent[] };
export type ApplicationContent = Partial<
  Record<
    ApplicationRegion,
    ({ id: string; text: string } | { id: string; component: PiComponent })[]
  >
>;
export interface TerminalRuntimeEndpoint {
  owns(target: PiComponent): boolean;
  claim?(target: PiComponent): void;
  retained?(): ReadonlySet<PiComponent>;
  focus(target: Target, revision: number, explicit: boolean): void;
  pause(value: boolean): void;
  invalidate(): void;
  refresh(): void;
  remember(): void;
  input(
    data: string,
    event?: DesktopKeyEvent,
  ): DesktopInputResult | Promise<DesktopInputResult>;
}
interface RuntimeHost {
  context(): DesktopSdkContext;
  geometry(): { columns: number; rows: number };
  changed(): void;
  activity(): void;
  error(error: unknown): void;
  overlay(
    target: PiComponent,
    options: Parameters<DesktopTui["showOverlay"]>[1],
    native: Handle,
    scope: TerminalRuntimeScope,
  ): Handle;
}

/** One extension-facing TUI and native overlay stack for an interactive workspace. */
export class TerminalRuntimeScope {
  application?: ApplicationComponents;
  private controller = new AbortController();
  private ready?: Promise<void>;
  private renderer?: DesktopTui;
  private reference?: DesktopTui;
  private endpoints = new Set<TerminalRuntimeEndpoint>();
  private roots = new Map<
    TerminalRuntimeEndpoint,
    { target: PiComponent; slot: DesktopSlot; parent?: PiComponent }
  >();
  private containers = new Map<ApplicationRegion, ContainerComponent>();
  private applicationRoots = new Set<PiComponent>();
  private applicationText = new Map<
    ApplicationRegion,
    Map<string, { component: PiComponent; text?: string }>
  >();
  private Text?: new (
    text: string,
    paddingX?: number,
    paddingY?: number,
  ) => PiComponent & { setText(text: string): void };
  private overlays = new Map<Handle, Handle>();
  private focused: Target = null;
  private revision = 0;
  private explicit = false;
  private paused = false;
  private rendering = false;
  private switching = false;
  private driver?: RendererTerminal;
  private runtime?: Awaited<ReturnType<typeof loadComponentRuntime>>;
  private viewport?: ReturnType<
    Awaited<
      ReturnType<typeof loadComponentRuntime>
    >["interactive"]["createChatViewport"]
  >;
  private mainScreenRenderState?: unknown;
  private unbindPresentation?: () => void;
  private lifecycle = new WeakMap<
    DesktopTui,
    {
      start: DesktopTui["start"];
      stop: DesktopTui["stop"];
    }
  >();
  private extra?: PiComponent;
  private nativeShow?: DesktopTui["showOverlay"];
  private keys?: Awaited<ReturnType<typeof loadTuiApi>>;
  private forwarded = new Set<Promise<unknown>>();
  private injectedTerminal = false;
  private factoryOwner = new AsyncLocalStorage<TerminalRuntimeEndpoint>();
  constructor(
    private host: RuntimeHost,
    private input: TerminalInputScope,
    private presentation: TerminalPresentationScope,
  ) {}
  get signal() {
    return this.controller.signal;
  }
  get stopped() {
    return this.paused || this.signal.aborted;
  }
  get focusRevision() {
    return this.revision;
  }
  retained(source: TerminalRuntimeEndpoint) {
    const targets = new Set<PiComponent>();
    for (const endpoint of this.endpoints) {
      if (endpoint === source) continue;
      for (const target of endpoint.retained?.() ?? []) targets.add(target);
    }
    return targets;
  }
  get forwarding() {
    return this.forwarded.size > 0;
  }
  get target() {
    return this.focused;
  }
  get registrations() {
    return this.extra!;
  }
  get registrationCount() {
    return (
      this.renderer?.children.filter(
        (child) => !this.applicationRoots.has(child),
      ).length ?? 0
    );
  }

  initialize() {
    return (this.ready ??= this.create());
  }
  private async create() {
    const scope = this;
    const geometry = {
      get columns() {
        return scope.host.geometry().columns;
      },
      get rows() {
        return scope.host.geometry().rows;
      },
    };
    const options = this.host.context().host.startup.configuration;
    this.injectedTerminal = options.terminal !== undefined;
    const physical =
      options.terminal ??
      (await createDesktopTerminal(
        geometry,
        {
          activate: () => {
            if (!this.signal.aborted) this.host.activity();
          },
          setTitle: this.presentation.setTitle,
          setProgress: this.presentation.setProgress,
        },
        { signal: this.signal, queryColors: this.presentation.queryColors },
      ));
    const api = await loadTuiApi();
    this.keys = api;
    this.runtime = await loadComponentRuntime();
    this.driver = new RendererTerminal(
      physical,
      geometry,
      undefined,
      this.injectedTerminal
        ? {
            input: (data) => {
              if (this.stopped) return;
              // Native device responses belong to this supplied Terminal;
              // ordinary keys continue through the shared desktop pipeline.
              for (const parser of [
                "consumeTerminalColorResponse",
                "consumeTerminalColorSchemeReport",
                "consumeCellSizeResponse",
              ])
                if (callComponentMethod(this.renderer!, parser, data)) return;
              void this.host
                .context()
                .desktop.input("editor", data)
                .catch(this.host.error);
            },
            setTitle: this.presentation.setTitle,
            setProgress: this.presentation.setProgress,
          }
        : undefined,
    );
    const renderer = this.createRenderer(
      options.tuiMode ?? this.host.context().settingsManager.getTuiMode(),
    );
    this.renderer = renderer;
    this.bindRenderer(renderer);
    const Container = Reflect.get(api, "Container") as new () => PiComponent & {
      children: PiComponent[];
    };
    this.Text = Reflect.get(api, "Text");
    for (const slot of [
      "header",
      "resources",
      "message",
      "pending",
      "status",
      "aboveEditor",
      "editor",
      "belowEditor",
      "footer",
    ] as ApplicationRegion[]) {
      const container = new Container();
      this.containers.set(slot, container);
    }
    const document = new Container();
    document.children.push(
      this.containers.get("header")!,
      this.containers.get("resources")!,
      this.containers.get("message")!,
    );
    for (const root of [
      document,
      ...(
        [
          "pending",
          "status",
          "aboveEditor",
          "editor",
          "belowEditor",
          "footer",
        ] as const
      ).map((region) => this.containers.get(region)!),
    ]) {
      this.applicationRoots.add(root);
      renderer.addChild(root);
    }
    const extra = new Container();
    Object.defineProperty(extra, "children", {
      configurable: true,
      get: () =>
        this.renderer!.children.filter(
          (child) => !this.applicationRoots.has(child),
        ),
    });
    this.extra = extra;
    const settings = this.host.context().settingsManager;
    this.viewport = this.runtime.interactive.createChatViewport({
      document,
      pendingMessages: this.containers.get("pending")!,
      status: this.containers.get("status")!,
      editor: this.containers.get("editor")!,
      footer: this.containers.get("footer")!,
      widgetsAbove: this.containers.get("aboveEditor")!,
      widgetsBelow: this.containers.get("belowEditor")!,
      scrollbar: settings.getFullscreenScrollbar(),
      scrollbarTrackStyle: (text) =>
        this.host
          .context()
          .session.extensionRunner.getUIContext()
          .theme.fg("scrollbarTrack", text),
      scrollbarThumbStyle: (text) =>
        this.host
          .context()
          .session.extensionRunner.getUIContext()
          .theme.fg("scrollbarThumb", text),
    });
    if (renderer.mode === "fullscreen")
      callComponentMethod(renderer, "setLayoutRoot", this.viewport.root);
    this.reference = this.runtime.interactive.createInteractiveTuiReference(
      () => this.renderer!,
    );
    this.application = new ApplicationComponents(
      this.reference,
      this.host.context,
      this.runtime,
    );
    await this.application.initialize();
    if (this.signal.aborted) {
      this.application.dispose();
      this.driver.stopPhysical();
    } else renderer.start();
  }
  private createRenderer(mode: "regular" | "fullscreen") {
    const context = this.host.context();
    const settings = context.settingsManager;
    return this.runtime!.interactive.createInteractiveTui({
      tuiMode: mode,
      terminal: this.driver!.terminal,
      showHardwareCursor: settings.getShowHardwareCursor(),
      logDirectory: context.host.agentDir,
      fullscreenCopyOnSelect: settings.getFullscreenCopyOnSelect(),
      fullscreenWheelScrollLines: settings.getFullscreenWheelScrollLines(),
      onRightClickPaste: () => {
        void context.host
          .action({ action: "clipboard.paste" })
          .catch(this.host.error);
      },
    });
  }
  private bindRenderer(renderer: DesktopTui) {
    const active = () => !this.signal.aborted && this.renderer === renderer;
    this.driver!.bind(
      renderer,
      () => {
        this.syncFocus(false);
        this.refreshEndpoints();
      },
      () => active() && !this.paused,
    );
    this.input.bind(renderer, true);
    this.unbindPresentation = this.presentation.bind(
      renderer,
      !this.injectedTerminal,
    );
    const invalidate = renderer.invalidate.bind(renderer);
    const nativeFocus = renderer.setFocus.bind(renderer);
    renderer.setFocus = (target) => {
      if (!active()) return;
      const owner = this.factoryOwner.getStore();
      if (
        target &&
        owner &&
        ![...this.endpoints].some(
          (endpoint) => endpoint !== owner && endpoint.owns(target),
        )
      )
        owner.claim?.(target);
      nativeFocus(target);
      if (!this.switching) this.syncFocus(true);
    };
    const request = renderer.requestRender.bind(renderer);
    const render = renderer.renderNow.bind(renderer);
    renderer.requestRender = (force) => {
      if (active()) request(force);
    };
    renderer.renderNow = (force) => {
      if (active()) render(force);
    };
    renderer.invalidate = () => {
      if (active()) invalidate();
    };
    this.lifecycle.set(renderer, {
      start: renderer.start.bind(renderer),
      stop: renderer.stop.bind(renderer),
    });
    renderer.stop = (options) => {
      if (!active()) return;
      this.driver!.run(() => this.lifecycle.get(renderer)!.stop(options));
      this.driver!.stopPhysical();
      this.setPaused(true);
    };
    renderer.start = () => {
      if (!active()) return;
      this.driver!.stopPhysical();
      this.setPaused(false);
      this.driver!.run(() => this.lifecycle.get(renderer)!.start());
    };
    for (const method of ["addChild", "removeChild", "clear"] as const) {
      const original = renderer[method];
      Reflect.set(renderer, method, (...args: unknown[]) => {
        if (!active()) return;
        for (const endpoint of this.endpoints) endpoint.remember();
        try {
          return Reflect.apply(original, renderer, args);
        } finally {
          for (const endpoint of this.endpoints) endpoint.remember();
        }
      });
    }
    const show = renderer.showOverlay.bind(renderer);
    this.nativeShow = show;
    renderer.showOverlay = (target, options) => {
      if (!active())
        throw new Error("Pi interactive generation is no longer active");
      const native = this.installOverlay(target, options);
      const desktop = this.host.overlay(target, options, native, this);
      this.overlays.set(native, desktop);
      return desktop;
    };
    renderer.hideOverlay = () => [...this.overlays.values()].at(-1)?.hide();
  }
  get tui() {
    return this.reference!;
  }
  factory<T>(endpoint: TerminalRuntimeEndpoint, callback: () => T): T {
    return this.factoryOwner.run(endpoint, callback);
  }
  visible(endpoint: TerminalRuntimeEndpoint) {
    const root = this.roots.get(endpoint);
    if (!root || !this.renderer) return true;
    const container = this.containers.get(
      root.slot === "dialog"
        ? "editor"
        : ["entry", "tool"].includes(root.slot)
          ? "message"
          : root.slot,
    );
    return (
      !!container &&
      this.contains(this.renderer, container) &&
      container.children.includes(root.parent ?? root.target)
    );
  }
  private contains(
    root: PiComponent,
    target: PiComponent,
    seen = new Set<PiComponent>(),
  ): boolean {
    if (root === target) return true;
    if (seen.has(root)) return false;
    seen.add(root);
    const children = Reflect.get(root, "children");
    return (
      Array.isArray(children) &&
      children.some((child) => this.contains(child, target, seen))
    );
  }
  /** Populate the native tree from current desktop state, keeping native instances stable. */
  updateApplication(content: ApplicationContent) {
    if (this.signal.aborted || !this.Text) return;
    let changed = false;
    for (const [region, entries] of Object.entries(content)) {
      const container = this.containers.get(region as ApplicationRegion);
      if (!container) continue;
      let owned = this.applicationText.get(region as ApplicationRegion);
      if (!owned)
        this.applicationText.set(
          region as ApplicationRegion,
          (owned = new Map()),
        );
      const current = new Set(entries.map((entry) => entry.id));
      for (const [id, entry] of owned) {
        if (current.has(id)) continue;
        const index = container.children.indexOf(entry.component);
        if (index >= 0) container.children.splice(index, 1);
        owned.delete(id);
        changed = true;
      }
      for (const source of entries) {
        const { id } = source;
        const entry = owned.get(id);
        if ("component" in source) {
          if (entry?.component === source.component) continue;
          if (entry) {
            const index = container.children.indexOf(entry.component);
            if (index >= 0) container.children.splice(index, 1);
          }
          owned.set(id, { component: source.component });
          changed = true;
        } else if (!entry) {
          const component = new this.Text(source.text, 0, 0);
          owned.set(id, { component, text: source.text });
          container.children.push(component);
          changed = true;
        } else if (entry.text !== source.text) {
          entry.text = source.text;
          callComponentMethod(entry.component, "setText", source.text);
          changed = true;
        }
      }
      // Reorder owned occurrences in place while retaining extension children.
      const ordered = entries.map((entry) => owned!.get(entry.id)!.component);
      // Several widget keys can intentionally return the same original object.
      // Reuse already mounted occurrences, but retain the native Map's count.
      const remaining = new Map<PiComponent, number>();
      for (const component of container.children)
        remaining.set(component, (remaining.get(component) ?? 0) + 1);
      for (const component of ordered) {
        const count = remaining.get(component) ?? 0;
        if (count > 0) remaining.set(component, count - 1);
        else {
          container.children.push(component);
          changed = true;
        }
      }
      const targets = new Set(ordered);
      let next = 0;
      for (let index = 0; index < container.children.length; index++)
        if (next < ordered.length && targets.has(container.children[index]!)) {
          const component = ordered[next++]!;
          if (component !== container.children[index]) changed = true;
          container.children[index] = component;
        }
    }
    if (changed) this.requestRender();
  }
  attach(endpoint: TerminalRuntimeEndpoint) {
    if (!this.signal.aborted) this.endpoints.add(endpoint);
    endpoint.pause(this.stopped);
    endpoint.focus(this.focused, this.revision, this.explicit);
    return () => {
      this.endpoints.delete(endpoint);
      const previous = this.roots.get(endpoint);
      this.roots.delete(endpoint);
      if (previous) this.removeRoot(previous);
      if (
        this.focused &&
        endpoint.owns(this.focused) &&
        ![...this.endpoints].some((item) => item.owns(this.focused!))
      )
        this.renderer?.setFocus(
          [...this.roots.values()].find((item) => item.slot === "editor")
            ?.target ?? null,
        );
    };
  }
  root(
    endpoint: TerminalRuntimeEndpoint,
    target: PiComponent,
    slot: DesktopSlot,
    parent?: PiComponent,
  ) {
    if (this.signal.aborted || !this.endpoints.has(endpoint)) return;
    const previous = this.roots.get(endpoint);
    if (
      previous?.target === target &&
      previous.slot === slot &&
      previous.parent === parent
    )
      return;
    if (previous) this.removeRoot(previous);
    this.roots.set(endpoint, { target, slot, parent });
    if (!parent) this.containers.get(this.slot(slot))?.children.push(target);
  }
  private slot(slot: DesktopSlot): DesktopSlot {
    return slot === "dialog"
      ? "editor"
      : slot === "entry" || slot === "tool"
        ? "message"
        : slot;
  }
  private removeRoot(root: {
    target: PiComponent;
    slot: DesktopSlot;
    parent?: PiComponent;
  }) {
    if (root.parent) return;
    const container = this.containers.get(this.slot(root.slot));
    const index = container?.children.indexOf(root.target) ?? -1;
    if (container && index >= 0) container.children.splice(index, 1);
  }
  focus(target: Target, explicit = false, supersedeRequest = false) {
    if (this.signal.aborted || !this.renderer) return;
    callComponentMethod(this.renderer, "setFocusInternal", {
      component: target,
      overlayFocusRestore: "clear",
    });
    this.syncFocus(explicit, supersedeRequest);
  }
  private syncFocus(explicit: boolean, supersedeRequest = false) {
    if (!this.renderer) return;
    const target = componentFocus(this.renderer) ?? null;
    // Forwarding a listener's key to its newly focused recipient must retain
    // that explicit request until the browser receives it. A genuine DOM focus
    // notification or input can acknowledge and retire the request.
    if (!supersedeRequest && target === this.focused && this.explicit)
      explicit = true;
    const changed = this.focused !== target || explicit !== this.explicit;
    this.focused = target;
    this.explicit = explicit;
    if (!changed) return;
    this.revision++;
    for (const endpoint of this.endpoints)
      endpoint.focus(target, this.revision, explicit);
  }
  private wrapOverlay(original: Handle): Handle {
    const run = (operation: () => void) => {
      if (this.signal.aborted) return;
      operation();
      this.syncFocus(true);
      this.requestRender();
    };
    const handle: Handle = {
      hide: () =>
        run(() => {
          original.hide();
          this.overlays.delete(handle);
        }),
      setHidden: (value) => run(() => original.setHidden(value)),
      isHidden: () => original.isHidden(),
      focus: () => run(() => original.focus()),
      unfocus: (options) => run(() => original.unfocus(options)),
      isFocused: () => !this.signal.aborted && original.isFocused(),
      getBounds: () =>
        !this.signal.aborted ? original.getBounds() : undefined,
    };
    return handle;
  }
  installOverlay(
    target: PiComponent,
    options?: Parameters<DesktopTui["showOverlay"]>[1],
  ) {
    if (this.signal.aborted || !this.nativeShow)
      throw new Error("Pi interactive generation is no longer active");
    const handle = this.wrapOverlay(this.nativeShow(target, options));
    this.overlays.set(handle, handle);
    this.syncFocus(true);
    return handle;
  }
  linkOverlay(native: Handle, desktop: Handle) {
    if (this.overlays.has(native)) this.overlays.set(native, desktop);
  }
  requestRender(force = false) {
    this.renderer?.requestRender(force);
  }
  resize() {
    if (!this.signal.aborted) this.driver?.resize();
  }
  renderNow(force = false) {
    this.renderer?.renderNow(force);
  }
  private refreshEndpoints() {
    if (this.stopped || this.rendering) return;
    this.rendering = true;
    try {
      for (const endpoint of this.endpoints) {
        try {
          endpoint.refresh();
        } catch (error) {
          this.host.error(error);
        }
      }
    } finally {
      this.rendering = false;
    }
    this.host.changed();
  }
  private setPaused(value: boolean) {
    if (this.signal.aborted || this.paused === value) return;
    this.paused = value;
    for (const endpoint of this.endpoints) endpoint.pause(value);
    if (value) this.host.activity();
    else {
      this.renderer?.invalidate();
      this.refreshEndpoints();
    }
    this.host.changed();
  }
  dispatch(
    source: TerminalRuntimeEndpoint | undefined,
    data: string,
    event?: DesktopKeyEvent,
  ): DesktopInputResult | undefined {
    if (this.stopped) return { consume: true };
    const target = this.focused;
    if (!target) return this.explicit ? { consume: true } : undefined;
    if (source?.owns(target)) return undefined;
    const endpoint = [...this.endpoints].find((item) => item.owns(target));
    if (endpoint === source) return undefined;
    if (endpoint) {
      const result = endpoint.input(data, event);
      if (result instanceof Promise) {
        const pending = result.finally(() => this.forwarded.delete(pending));
        this.forwarded.add(pending);
        void pending.catch((error) => this.host.error(error));
        return { consume: true };
      }
      return result;
    }
    if (this.keys?.isKeyRelease(data) && !target.wantsKeyRelease)
      return { consume: true };
    target.handleInput?.(data);
    this.requestRender();
    return { consume: true };
  }
  dispatchSlot(slot: DesktopSlot, data: string, event?: DesktopKeyEvent) {
    const source = [...this.roots].find(([, item]) => item.slot === slot)?.[0];
    return this.dispatch(source, data, event);
  }
  async flush() {
    while (this.forwarded.size) await Promise.all([...this.forwarded]);
  }
  resetSession() {
    if (this.signal.aborted) return;
    this.updateApplication(
      Object.fromEntries([...this.containers.keys()].map((key) => [key, []])),
    );
    this.application?.resetSession();
  }
  /** Same remount/overlay guard as Pi's InteractiveMode, with a stable public reference. */
  switchMode(mode: "regular" | "fullscreen", startRenderer = true): boolean {
    if (mode !== "regular" && mode !== "fullscreen")
      throw new Error(`Unknown Pi TUI mode: ${mode}`);
    const previous = this.renderer;
    if (this.signal.aborted || !previous) return false;
    if (previous.mode === mode) return true;
    if (Reflect.get(previous, "hasOverlayEntries")) return false;
    const components = [...previous.children];
    const focus = componentFocus(previous) ?? null;
    const cursor = previous.getShowHardwareCursor();
    const clearOnShrink = previous.getClearOnShrink();
    const onDebug = previous.onDebug;
    if (previous.mode === "regular")
      this.mainScreenRenderState = callComponentMethod(
        previous,
        "captureRenderState",
      );
    this.switching = true;
    try {
      this.driver!.run(() =>
        this.lifecycle.get(previous)!.stop({ preserveScreen: true }),
      );
      this.driver!.stopPhysical();
      previous.setFocus(null);
      previous.clear();
      if (previous.mode === "fullscreen")
        callComponentMethod(previous, "setLayoutRoot", undefined);
      this.unbindPresentation?.();
      const next = this.createRenderer(mode);
      this.renderer = next;
      this.input.replaceRenderer();
      this.bindRenderer(next);
      next.setShowHardwareCursor(cursor);
      next.setClearOnShrink(clearOnShrink);
      next.onDebug = onDebug;
      if (mode === "regular" && this.mainScreenRenderState)
        callComponentMethod(
          next,
          "restoreRenderState",
          this.mainScreenRenderState,
        );
      for (const component of components) next.addChild(component);
      if (mode === "fullscreen")
        callComponentMethod(next, "setLayoutRoot", this.viewport!.root);
      next.invalidate();
      next.setFocus(focus);
      this.paused = !startRenderer;
      for (const endpoint of this.endpoints) endpoint.pause(this.paused);
      this.host.context().host.rebindTerminalInputListeners();
      if (startRenderer)
        this.driver!.run(() => this.lifecycle.get(next)!.start());
    } finally {
      this.switching = false;
    }
    this.syncFocus(this.explicit);
    this.refreshEndpoints();
    return true;
  }
  /** Applies Pi's fullscreen exit-output policy before workspace teardown. */
  stopInteractive() {
    if (!this.renderer || this.signal.aborted) return;
    if (
      this.renderer.mode === "fullscreen" &&
      this.host.context().settingsManager.getFullscreenExitOutput() ===
        "transcript"
    ) {
      while (Reflect.get(this.renderer, "hasOverlayEntries"))
        this.renderer.hideOverlay();
      this.switchMode("regular", false);
      // Native renderNow must run before the final stop even when no input is accepted.
      this.paused = false;
      this.renderer.renderNow();
    }
    this.renderer.stop({ preserveScreen: this.renderer.mode === "fullscreen" });
  }
  applySettings(preserveMode = false) {
    if (this.signal.aborted || !this.reference) return;
    const settings = this.host.context().settingsManager;
    this.reference.setShowHardwareCursor(settings.getShowHardwareCursor());
    this.reference.setClearOnShrink(settings.getClearOnShrink());
    if (!preserveMode) this.switchMode(settings.getTuiMode());
    this.viewport?.transcript.setScrollbar(settings.getFullscreenScrollbar());
    if (this.renderer?.mode === "fullscreen") {
      callComponentMethod(
        this.renderer,
        "setCopyOnSelect",
        settings.getFullscreenCopyOnSelect(),
      );
      callComponentMethod(
        this.renderer,
        "setWheelScrollLines",
        settings.getFullscreenWheelScrollLines(),
      );
    }
    this.application?.syncFooter();
    this.requestRender();
  }
  retire() {
    if (this.signal.aborted) return;
    try {
      this.stopInteractive();
    } catch (error) {
      // An extension's invalidate/render hook can throw while the transcript
      // exit policy remounts roots. Retirement must still stop timers and free
      // every endpoint, component and physical terminal owner.
      try {
        if (this.renderer)
          this.driver?.run(() =>
            this.lifecycle.get(this.renderer!)!.stop({ preserveScreen: true }),
          );
      } catch (stopError) {
        this.host.error(stopError);
      }
      this.host.error(error);
    }
    this.controller.abort();
    try {
      this.application?.dispose();
    } catch (error) {
      this.host.error(error);
    }
    if (this.renderer) this.driver?.cancel(this.renderer);
    this.unbindPresentation?.();
    this.driver?.stopPhysical();
    for (const endpoint of this.endpoints) endpoint.pause(true);
    this.endpoints.clear();
    this.roots.clear();
    this.overlays.clear();
  }
}

export class TerminalRuntimePipeline {
  private scope: TerminalRuntimeScope;
  constructor(
    private host: RuntimeHost,
    private input: () => TerminalInputScope,
    private presentation: () => TerminalPresentationScope,
  ) {
    this.scope = this.create();
  }
  private create() {
    return new TerminalRuntimeScope(
      this.host,
      this.input(),
      this.presentation(),
    );
  }
  capture() {
    return this.scope;
  }
  reset() {
    this.scope.retire();
    this.scope = this.create();
  }
}
