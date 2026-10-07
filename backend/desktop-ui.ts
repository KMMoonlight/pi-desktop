import { randomUUID } from "node:crypto";
import type {
  DesktopNode,
  DesktopSlot,
  DesktopSurface,
  DesktopUIAction,
  DesktopKeyEvent,
  DesktopOverlay,
  DesktopInputResult,
  DesktopSelection,
  DesktopInputContext,
  DesktopMouseEvent,
  DesktopMouseResult,
} from "../shared/desktop-ui.ts";
import type { DesktopSdkContext } from "./sdk-access.ts";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { desktopKeyFromId, encodeDesktopKey } from "../shared/keyboard.ts";
import { errorMessage } from "../shared/errors.ts";
import { loadTuiApi, type DesktopTui } from "./tui-api.ts";
import {
  TerminalInputPipeline,
  type TerminalInputScope,
} from "./terminal-input.ts";
import {
  TerminalPresentationPipeline,
  type TerminalPresentationScope,
} from "./terminal-presentation.ts";
import {
  TerminalRuntimePipeline,
  type TerminalRuntimeScope,
} from "./terminal-runtime.ts";
import type { PiComponent } from "./component-runtime.ts";
import type { NativeToolRow } from "./native-tool-rows.ts";
import type { DesktopAutocompleteProvider } from "./autocomplete.ts";
import {
  componentField,
  resolveComponentOverlayLayout,
} from "./component-runtime.ts";

type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];
type OverlayHandle = Parameters<
  NonNullable<NonNullable<CustomOptions>["onHandle"]>
>[0];
type OverlayOptions = Parameters<DesktopTui["showOverlay"]>[1];
export interface DesktopRenderSource {
  nativeToolRow?: NativeToolRow;
  kind: "toolCall" | "toolResult" | "message" | "entry";
  renderer: Function;
  value: unknown;
  context: {
    expanded: boolean;
    isStreaming: boolean;
    isPartial: boolean;
    isError: boolean;
    argsComplete: boolean;
    executionStarted: boolean;
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    cwd: string;
    state?: Record<string, unknown>;
    showImages?: boolean;
    outputPad?: number;
    codeBlockIndent?: string;
    hasResult?: boolean;
    toolDefinitionAvailable?: boolean;
  };
}

export interface DesktopComponent {
  original?: PiComponent;
  terminalOverlay?: OverlayHandle;
  handlesTerminalInput?: boolean;
  acceptsInput?(): boolean;
  title?: string;
  view(): DesktopNode;
  resolveAction?(action: string): string;
  handleAction(event: DesktopUIAction): void | Promise<void>;
  dispose?(): void;
  invalidate?(): void;
  invalidateRenderer?(): void;
  getText?(): string;
  getExpandedText?(): string;
  expandText?(text: string): string;
  setText?(text: string): void;
  pasteText?(text: string): void;
  getSelection?(): DesktopSelection;
  setSelection?(selection: DesktopSelection): void;
  addToHistory?(text: string): void;
  setAutocompleteProvider?(provider: DesktopAutocompleteProvider): void;
  update?(source: DesktopRenderSource): void | Promise<void>;
  handleKey?(event: DesktopKeyEvent): boolean | void | Promise<boolean | void>;
  handleInput?(
    data: string,
    event?: DesktopKeyEvent,
    context?: DesktopInputContext,
  ): DesktopInputResult | Promise<DesktopInputResult>;
  focusTarget?: object;
  focus?(): void;
  focusControl?(action: string): boolean;
  getFocusRequest?(): DesktopSurface["focusRequest"];
  overlayState?(): Pick<DesktopOverlay, "hidden" | "focused">;
  getOverlayHeight?(width: number): number;
  handleMouse?(
    action: string,
    event: DesktopMouseEvent,
  ): DesktopMouseResult | Promise<DesktopMouseResult>;
  cancelMouse?(pointerId: number): void;
  cancelInput?(): void;
}
export interface DesktopAdapterContext {
  terminalRuntime: TerminalRuntimeScope;
  terminalRegion?: boolean;
  runtimeOverlay?: OverlayHandle;
  customOptions?: CustomOptions;
  terminalInput: TerminalInputScope;
  terminalPresentation: TerminalPresentationScope;
  sdk: DesktopSdkContext;
  slot: DesktopSlot;
  source: unknown;
  signal: AbortSignal;
  done(value?: unknown): void;
  invalidate(): void;
  showOverlay(
    component: DesktopComponent,
    options?: OverlayOptions,
  ): OverlayHandle;
}
export interface DesktopUIAdapter {
  id: string;
  fallback?: boolean;
  matches(source: unknown, slot: DesktopSlot): boolean;
  create(
    context: DesktopAdapterContext,
  ): DesktopComponent | Promise<DesktopComponent>;
}
interface MountedComponent {
  runtimeOverlay?: OverlayHandle;
  beforeClose?(): void;
  closing?: boolean;
  detached?: boolean;
  instanceId: string;
  slot: DesktopSlot;
  component?: DesktopComponent;
  close(value?: unknown): void;
  pending: Promise<void>;
  controller: AbortController;
  target?: DesktopSurface["target"];
  source?: unknown;
  fingerprint?: string;
  overlay?: DesktopOverlay;
  options?: CustomOptions;
  overlayHeight?: { key: string; height: number };
}
function findFocusAction(node: DesktopNode, action: string): boolean {
  if (node.inert || ("disabled" in node && node.disabled)) return false;
  if (
    node.component?.action === action ||
    node.rendered?.control?.action === action ||
    ("action" in node && node.action === action)
  )
    return true;
  const children =
    node.kind === "row" || node.kind === "column" || node.kind === "scroll"
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : node.kind === "tabs"
          ? (node.tabs.find((tab) => tab.value === node.value)?.children ?? [])
          : [];
  return children.some((child) => findFocusAction(child, action));
}
function findAction(node: DesktopNode, action: string): boolean {
  if (
    node.kind === "scroll" &&
    [`${node.action}:layout`, `${node.action}:scrollbar`].includes(action)
  )
    return true;
  if (
    (node.kind === "input" || node.kind === "textarea") &&
    (node.selectionAction === action ||
      node.completionAction === action ||
      node.pasteAction === action) &&
    !node.disabled
  )
    return true;
  if (
    "action" in node &&
    node.action === action &&
    !("disabled" in node && node.disabled)
  )
    return true;
  if (node.kind === "row" || node.kind === "column" || node.kind === "scroll")
    return node.children.some((child) => findAction(child, action));
  if (node.kind === "region") return findAction(node.child, action);
  if (node.kind === "tabs")
    return (
      node.tabs
        .find((tab) => tab.value === node.value)
        ?.children.some((child) => findAction(child, action)) ?? false
    );
  return false;
}

/** Adapters translate extension UI into native controls without a terminal renderer. */
export class DesktopUIRegistry {
  readonly terminalInput = new TerminalInputPipeline();
  readonly terminalPresentation: TerminalPresentationPipeline;
  readonly terminalRuntime: TerminalRuntimePipeline;
  private registrationScope?: TerminalRuntimeScope;
  private nativeEndpoints = new WeakMap<
    DesktopComponent,
    import("./terminal-runtime.ts").TerminalRuntimeEndpoint
  >();
  private invalidationRevision = 0;
  private adapters = new Map<string, DesktopUIAdapter>();
  private mounted = new Map<string, MountedComponent>();
  private viewport = { width: 120, height: 40 };
  private overlayRuntime?: object;
  private computingOverlays = new WeakMap<MountedComponent, DesktopOverlay>();
  get viewportSize() {
    return this.viewport;
  }
  private invalidateComponent(component: DesktopComponent) {
    try {
      component.invalidate?.();
    } catch (error) {
      this.context().host.notice(errorMessage(error), "error");
    }
  }
  invalidate() {
    this.invalidationRevision++;
    for (const [id, mounted] of [...this.mounted]) {
      if (this.mounted.get(id) === mounted && mounted.component)
        this.invalidateComponent(mounted.component);
    }
  }
  private order = 0;
  private editorRevision = 0;
  get editorVersion() {
    return this.editorRevision;
  }
  nativeComponent(id: string) {
    return this.mounted.get(id)?.component?.original;
  }
  private rendererStates = new Map<string, Record<string, unknown>>();
  private failedRenderers = new Map<
    string,
    { renderer: Function; fingerprint: string }
  >();
  constructor(
    private context: () => DesktopSdkContext,
    private changed: () => void,
  ) {
    this.terminalPresentation = new TerminalPresentationPipeline({
      settings: () => ({
        cursor: this.context().settingsManager.getShowHardwareCursor(),
        clearOnShrink: this.context().settingsManager.getClearOnShrink(),
      }),
      subscribe: (listener) =>
        this.context().host.onDesktopAppearanceChange(listener),
      query: (options, signal) =>
        this.context().host.terminalQueries.colors(options, signal),
      title: (value) => this.context().host.setWindowTitle(value),
      progress: (owner, value) =>
        this.context().host.setWindowProgress(owner, value),
    });
    this.terminalRuntime = new TerminalRuntimePipeline(
      {
        context: this.context,
        geometry: () => ({
          columns: this.viewport.width,
          rows: this.viewport.height,
        }),
        changed: () => this.changed(),
        activity: () =>
          this.context().host.emitEvent({
            type: "activity",
            name: "terminal_active",
          }),
        error: (error) =>
          this.context().host.notice(errorMessage(error), "error"),
        overlay: (target, options, native, scope) =>
          this.mountRuntimeOverlay(target, options, native, scope),
      },
      () => this.terminalInput.capture(),
      () => this.terminalPresentation.capture(),
    );
  }
  private mountRuntimeOverlay(
    target: PiComponent,
    options: OverlayOptions,
    native: OverlayHandle,
    scope: TerminalRuntimeScope,
  ): OverlayHandle {
    const id = randomUUID();
    let desktop: OverlayHandle | undefined;
    let removed = false;
    const abort = () => this.close(id);
    scope.signal.addEventListener("abort", abort, { once: true });
    void this.mount(
      target,
      "dialog",
      id,
      () => scope.signal.removeEventListener("abort", abort),
      {
        runtimeOverlay: native,
        options: {
          overlay: true,
          overlayOptions: options,
          onHandle: (value) => {
            desktop = value;
            if (removed || scope.signal.aborted) desktop.hide();
          },
        },
      },
    ).catch((error) => {
      native.hide();
      this.context().host.notice(errorMessage(error), "error");
    });
    return {
      hide: () => {
        removed = true;
        native.hide();
        desktop?.hide();
      },
      setHidden: (value) => {
        native.setHidden(value);
        desktop?.setHidden(value);
      },
      isHidden: () => native.isHidden(),
      focus: () => {
        native.focus();
        desktop?.focus();
      },
      unfocus: (options) => {
        native.unfocus(options);
        this.changed();
      },
      isFocused: () => native.isFocused(),
      getBounds: () => desktop?.getBounds(),
    };
  }
  registerAdapter(adapter: DesktopUIAdapter): () => void {
    if (this.adapters.has(adapter.id))
      throw new Error(`Desktop adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    return () => {
      if (this.adapters.get(adapter.id) === adapter)
        this.adapters.delete(adapter.id);
    };
  }
  /** Inspect semantic desktop link nodes, independent of extension identity or text. */
  presentsLink(id: string, url: string): boolean {
    const contains = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return false;
      if ("href" in value && value.href === url) return true;
      return Object.values(value).some(contains);
    };
    const surface = this.surfaces.find((surface) => surface.id === id);
    return !!surface && contains(surface.view);
  }
  get surfaces(): DesktopSurface[] {
    return [...this.mounted].flatMap(([id, mounted]) => {
      if (!mounted.component || mounted.detached) return [];
      let view: DesktopNode;
      let overlay: DesktopOverlay | undefined;
      let acceptsKeys =
        !!mounted.component.handleKey || !!mounted.component.handleInput;
      try {
        overlay = mounted.overlay ? this.overlayState(mounted) : undefined;
        view = mounted.component.view();
        if (
          id === "tui:registrations" &&
          this.terminalRuntime.capture().registrationCount === 0
        )
          return [];
        if (this.terminalRuntime.capture().stopped) {
          view = { ...view, inert: true };
          acceptsKeys = false;
        }
      } catch (error) {
        view = {
          kind: "text",
          text: errorMessage(error),
        };
        acceptsKeys = false;
      }
      return [
        {
          id,
          instanceId: mounted.instanceId,
          slot: mounted.slot,
          title: mounted.component.title,
          view,
          target: mounted.target,
          overlay,
          acceptsKeys,
          focusRequest: mounted.component.getFocusRequest?.(),
          terminalFocusRevision: this.terminalRuntime.capture().focusRevision,
        },
      ];
    });
  }
  isCurrent(id: string, instanceId: string) {
    return this.mounted.get(id)?.instanceId === instanceId;
  }
  private adapter(source: unknown, slot: DesktopSlot): DesktopUIAdapter {
    const adapters = [...this.adapters.values()];
    const adapter = [
      ...adapters.filter((item) => !item.fallback),
      ...adapters.filter((item) => item.fallback),
    ].find((candidate) => candidate.matches(source, slot));
    if (!adapter)
      throw new Error(`此 TUI 扩展组件需要注册桌面适配器 (${slot})`);
    return adapter;
  }
  canAdapt(source: unknown, slot: DesktopSlot): boolean {
    return [...this.adapters.values()].some((adapter) =>
      adapter.matches(source, slot),
    );
  }
  async mount(
    source: unknown,
    slot: DesktopSlot,
    id: string = randomUUID(),
    onDone?: (value?: unknown) => void,
    details?: {
      target?: DesktopSurface["target"];
      options?: CustomOptions;
      fingerprint?: string;
      component?: DesktopComponent;
      beforeClose?: () => void;
      terminalRegion?: boolean;
      runtimeOverlay?: OverlayHandle;
    },
  ) {
    this.close(id);
    const mounted: MountedComponent = {
      instanceId: randomUUID(),
      slot,
      pending: Promise.resolve(),
      controller: new AbortController(),
      close: (value) => {
        onDone?.(value);
      },
      source,
      target: details?.target,
      fingerprint: details?.fingerprint,
      options: details?.options,
      runtimeOverlay: details?.runtimeOverlay,
      beforeClose: details?.beforeClose,
    };
    this.mounted.set(id, mounted);
    const terminalRuntime = this.terminalRuntime.capture();
    const terminalInput = this.terminalInput.capture();
    const terminalPresentation = this.terminalPresentation.capture();
    const invalidationRevision = this.invalidationRevision;
    try {
      if (!this.overlayRuntime) {
        const api = await loadTuiApi();
        this.terminalInput.initialize(api);
        this.overlayRuntime = componentField(
          api.TuiMainScreen,
          "prototype",
        ) as object;
      }
      if (!details?.component) await terminalRuntime.initialize();
      if (
        !details?.component &&
        !details?.terminalRegion &&
        !terminalRuntime.signal.aborted &&
        this.registrationScope !== terminalRuntime
      ) {
        this.registrationScope = terminalRuntime;
        await this.mount(
          terminalRuntime.registrations,
          "aboveEditor",
          "tui:registrations",
          undefined,
          { terminalRegion: true },
        );
      }
      const component =
        details?.component ??
        (await this.adapter(source, slot).create({
          terminalRuntime,
          terminalRegion: details?.terminalRegion,
          runtimeOverlay: details?.runtimeOverlay,
          customOptions: details?.options,
          terminalInput,
          terminalPresentation,
          sdk: this.context(),
          source,
          slot,
          signal: mounted.controller.signal,
          done: (value) => {
            if (this.mounted.get(id) === mounted) this.close(id, value);
          },
          invalidate: () => {
            if (this.mounted.get(id) === mounted) this.changed();
          },
          showOverlay: (component, options) => {
            let handle: OverlayHandle | undefined;
            const childId = randomUUID();
            const abort = () => this.close(childId);
            mounted.controller.signal.addEventListener("abort", abort, {
              once: true,
            });
            void this.mount(
              undefined,
              "dialog",
              childId,
              () => {
                mounted.controller.signal.removeEventListener("abort", abort);
              },
              {
                component,
                options: {
                  overlay: true,
                  overlayOptions: options,
                  onHandle: (value) => {
                    handle = value;
                  },
                },
              },
            ).catch((error) =>
              this.context().host.notice(errorMessage(error), "error"),
            );
            if (!handle)
              throw new Error("Desktop overlay did not mount synchronously");
            if (mounted.controller.signal.aborted) this.close(childId);
            return handle;
          },
        }));
      if (this.mounted.get(id) !== mounted) component.dispose?.();
      else {
        if (invalidationRevision !== this.invalidationRevision)
          this.invalidateComponent(component);
        if (this.mounted.get(id) !== mounted) {
          component.dispose?.();
          return id;
        }
        if (slot === "editor" && (!component.getText || !component.setText)) {
          component.dispose?.();
          throw new Error(
            "Desktop editor adapters must implement getText() and setText()",
          );
        }
        mounted.component = component;
        if (!component.original && !details?.component) {
          const facade: PiComponent = {
            render: () => (component.getText?.() ?? "").split("\n"),
            invalidate: () => component.invalidate?.(),
            handleInput: (data) => {
              void component.handleInput?.(data);
            },
          };
          const endpoint = {
            owns: (target: PiComponent) => target === facade,
            focus() {},
            pause() {},
            invalidate: () => component.invalidate?.(),
            refresh: () => {},
            remember: () => {},
            input: async (data: string, event?: DesktopKeyEvent) => {
              const result = await component.handleInput?.(data, event, {
                terminalFiltered: true,
              } as DesktopInputContext);
              if (result?.consume === false) {
                const api = await loadTuiApi();
                const text =
                  api.decodeKittyPrintable(result.data ?? data) ??
                  result.data ??
                  data;
                if (/^[^\x00-\x1f\x7f]+$/.test(text))
                  component.pasteText?.(text);
              }
              return { consume: true };
            },
          };
          component.original = facade;
          this.nativeEndpoints.set(component, endpoint);
          const detach = terminalRuntime.attach(endpoint);
          terminalRuntime.root(endpoint, facade, slot);
          mounted.controller.signal.addEventListener("abort", detach, {
            once: true,
          });
          if (slot === "editor") terminalRuntime.focus(facade);
        }
        if (slot === "editor") this.editorRevision++;
        if (details?.options?.overlay) {
          const options = this.overlayOptions(mounted);
          const capturing =
            !options.nonCapturing &&
            options.visible?.(this.viewport.width, this.viewport.height) !==
              false;
          if (capturing)
            for (const other of this.mounted.values())
              if (other.overlay) other.overlay.focused = false;
          mounted.overlay = {
            hidden: false,
            focused: capturing,
            order: ++this.order,
          };
          const active = () => this.mounted.get(id) === mounted;
          const native = component.terminalOverlay;
          const desktop: OverlayHandle = {
            hide: () => {
              if (active()) {
                native?.hide();
                this.detachOverlay(id);
              }
            },
            setHidden: (hidden) => {
              if (active() && mounted.overlay!.hidden !== hidden) {
                native?.setHidden(hidden);
                mounted.overlay!.hidden = hidden;
                if (hidden && mounted.overlay!.focused) {
                  mounted.overlay!.focused = false;
                  this.focusNext(mounted);
                } else if (
                  !hidden &&
                  !mounted.detached &&
                  !this.overlayOptions(mounted).nonCapturing &&
                  !this.overlayState(mounted).hidden
                ) {
                  this.focus(id);
                }
                this.changed();
              }
            },
            isHidden: () => native?.isHidden() ?? mounted.overlay!.hidden,
            focus: () => {
              if (
                !active() ||
                mounted.detached ||
                this.overlayState(mounted).hidden
              )
                return;
              mounted.component?.focus?.();
              for (const other of this.mounted.values())
                if (other.overlay) other.overlay.focused = false;
              mounted.overlay!.focused = true;
              mounted.overlay!.order = ++this.order;
              this.changed();
            },
            unfocus: (options) => {
              if (!active()) return;
              if (native) {
                native.unfocus(options);
                this.changed();
                return;
              }
              mounted.overlay!.focused = false;
              if (options) {
                const next = [...this.mounted].find(
                  ([, item]) =>
                    item.component?.focusTarget === options.target ||
                    item.source === options.target,
                );
                if (options.target === null)
                  this.context().host.emitEvent({
                    type: "activity",
                    name: "desktop_focus",
                    data: null,
                  });
                else if (next) this.focus(next[0]);
                else
                  this.context().host.notice(
                    "Desktop focus target needs a component mapping",
                    "warning",
                  );
              } else this.focusNext(mounted);
              this.changed();
            },
            isFocused: () =>
              active() &&
              !mounted.detached &&
              !this.overlayState(mounted).hidden &&
              mounted.overlay!.focused,
            getBounds: () =>
              active() && !mounted.detached
                ? this.overlayState(mounted).bounds
                : undefined,
          };
          if (native) terminalRuntime.linkOverlay(native, desktop);
          details.options.onHandle?.(desktop);
        }
      }
    } catch (error) {
      if (this.mounted.get(id) !== mounted) return id;
      this.mounted.delete(id);
      mounted.controller.abort();
      mounted.component?.dispose?.();
      this.changed();
      throw error;
    }
    this.changed();
    return id;
  }
  async custom<T>(
    source: unknown,
    options?: CustomOptions,
    signal?: AbortSignal,
    lifecycle?: { id: string; beforeClose(): void },
  ): Promise<T> {
    if (signal?.aborted) return undefined as T;
    const id = lifecycle?.id ?? randomUUID();
    const abort = () => this.close(id);
    signal?.addEventListener("abort", abort, { once: true });
    return new Promise<T>((resolve, reject) => {
      void this.mount(
        source,
        "dialog",
        id,
        (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value as T);
        },
        { options, beforeClose: lifecycle?.beforeClose },
      ).catch((error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      });
    });
  }
  private overlayOptions(mounted: MountedComponent) {
    const options = mounted.options?.overlayOptions;
    return (typeof options === "function" ? options() : options) ?? {};
  }
  private overlayState(mounted: MountedComponent): DesktopOverlay {
    const computing = this.computingOverlays.get(mounted);
    if (computing) return computing;
    const options = this.overlayOptions(mounted);
    const viewport = this.viewport;
    const initial = resolveComponentOverlayLayout(
      this.overlayRuntime!,
      options,
      0,
      viewport,
    );
    const desktopHeightLimit =
      initial.maxHeight ??
      resolveComponentOverlayLayout(
        this.overlayRuntime!,
        { ...options, maxHeight: "100%" },
        0,
        viewport,
      ).maxHeight;
    const native = mounted.component?.overlayState?.();
    const hidden =
      (native?.hidden ?? mounted.overlay!.hidden) ||
      options.visible?.(viewport.width, viewport.height) === false;
    const layoutKey = JSON.stringify([
      viewport,
      options,
      initial.width,
      initial.maxHeight,
    ]);
    const state: DesktopOverlay = {
      ...mounted.overlay!,
      hidden,
      focused: !hidden && (native?.focused ?? mounted.overlay!.focused),
      viewport,
      maxHeight: desktopHeightLimit,
      layoutKey,
      bounds: hidden
        ? undefined
        : {
            row: initial.row,
            col: initial.col,
            width: initial.width,
            height: 0,
          },
    };
    if (hidden) return state;
    this.computingOverlays.set(mounted, state);
    try {
      const intrinsic =
        mounted.component?.getOverlayHeight?.(initial.width) ?? 24;
      const measured = mounted.overlayHeight;
      const contentHeight =
        measured?.key === layoutKey ? measured.height : intrinsic;
      const height = Math.max(
        0,
        Math.min(contentHeight, initial.maxHeight ?? Infinity),
      );
      const layout = resolveComponentOverlayLayout(
        this.overlayRuntime!,
        options,
        height,
        viewport,
      );
      state.bounds = {
        row: layout.row,
        col: layout.col,
        width: layout.width,
        height,
      };
      return state;
    } finally {
      this.computingOverlays.delete(mounted);
    }
  }
  measureOverlay(
    id: string,
    instanceId: string,
    key: string,
    height: number,
  ): boolean {
    const mounted = this.mounted.get(id);
    if (
      !mounted?.overlay ||
      mounted.detached ||
      mounted.instanceId !== instanceId
    )
      return false;
    if (!Number.isFinite(height) || height < 0 || height > 100000)
      throw new Error("Invalid desktop overlay height");
    const state = this.overlayState(mounted);
    if (state.hidden || state.layoutKey !== key) return false;
    if (
      mounted.overlayHeight?.key === key &&
      mounted.overlayHeight.height === height
    )
      return true;
    mounted.overlayHeight = { key, height };
    this.changed();
    return true;
  }
  private focusNext(exclude: MountedComponent) {
    const next = [...this.mounted.values()]
      .filter(
        (item) =>
          item !== exclude &&
          !item.detached &&
          item.overlay &&
          !this.overlayState(item).hidden &&
          !this.overlayOptions(item).nonCapturing,
      )
      .sort((a, b) => b.overlay!.order - a.overlay!.order)[0];
    if (next?.overlay) next.overlay.focused = true;
    else
      this.context().host.emitEvent({
        type: "activity",
        name: "desktop_focus",
        data: null,
      });
  }
  focus(
    id: string,
    expectedRevision?: number,
    control?: { action: string; instanceId: string },
  ) {
    if (
      expectedRevision !== undefined &&
      expectedRevision !== this.terminalRuntime.capture().focusRevision
    )
      return;
    const mounted = this.mounted.get(id);
    if (
      !mounted?.component ||
      mounted.detached ||
      (control && mounted.instanceId !== control.instanceId) ||
      (mounted.overlay && this.overlayState(mounted).hidden)
    )
      return;
    if (control) {
      if (!findFocusAction(mounted.component.view(), control.action)) return;
      if (!mounted.component.focusControl?.(control.action)) return;
    } else mounted.component.focus?.();
    if (!control && !mounted.component.focus && mounted.component.original)
      this.terminalRuntime.capture().focus(mounted.component.original);
    for (const item of this.mounted.values())
      if (item.overlay) item.overlay.focused = item === mounted;
    if (mounted.overlay) mounted.overlay.order = ++this.order;
    // A DOM notification acknowledges existing browser focus. Echoing it as a
    // focus command would select the surface's first control instead of its leaf.
    if (!control)
      this.context().host.emitEvent({
        type: "activity",
        name: "desktop_focus",
        data: id,
      });
    this.changed();
  }
  toolState(id: string): Record<string, unknown> {
    let state = this.rendererStates.get(id);
    if (!state) {
      state = {};
      this.rendererStates.set(id, state);
    }
    return state;
  }
  invalidateToolRenderers(id: string, nativeAlreadyInvalidated = false) {
    if (!nativeAlreadyInvalidated)
      this.terminalRuntime.capture().application?.tools.get(id)?.invalidate();
    const targets = [...this.mounted].filter(
      ([, mounted]) => mounted.target?.toolCallId === id,
    );
    for (const [, mounted] of targets) {
      if (mounted.component?.invalidateRenderer)
        mounted.component.invalidateRenderer();
      else {
        mounted.fingerprint = undefined;
        if (mounted.component) this.invalidateComponent(mounted.component);
      }
    }
    for (const [surfaceId, mounted] of targets) {
      if (
        this.mounted.get(surfaceId) !== mounted ||
        !mounted.component?.invalidateRenderer
      )
        continue;
      try {
        mounted.component.view();
      } catch (error) {
        this.context().host.notice(errorMessage(error), "error");
      }
    }
    this.changed();
  }
  setViewport(width: number, height: number) {
    this.viewport = { width: Math.max(1, width), height: Math.max(1, height) };
    this.terminalRuntime.capture().resize();
    this.changed();
  }
  reconcile(
    specs: {
      id: string;
      source: DesktopRenderSource;
      slot: DesktopSlot;
      target: DesktopSurface["target"];
    }[],
  ) {
    const wanted = new Set(specs.map((spec) => spec.id));
    for (const id of this.failedRenderers.keys())
      if (!wanted.has(id)) this.failedRenderers.delete(id);
    const tools = new Set(specs.map((spec) => spec.target?.toolCallId));
    for (const id of this.rendererStates.keys())
      if (!tools.has(id)) this.rendererStates.delete(id);
    for (const [id, mounted] of this.mounted)
      if (mounted.target && !wanted.has(id)) this.close(id);
    for (const spec of specs) {
      if (!this.canAdapt(spec.source, spec.slot)) continue;
      const fingerprint = JSON.stringify([
        spec.source.value,
        { ...spec.source.context, state: undefined },
      ]);
      const failed = this.failedRenderers.get(spec.id);
      if (
        failed?.renderer === spec.source.renderer &&
        failed.fingerprint === fingerprint
      )
        continue;
      this.failedRenderers.delete(spec.id);
      const mounted = this.mounted.get(spec.id);
      if (
        mounted?.fingerprint === fingerprint &&
        (mounted.source as DesktopRenderSource).renderer ===
          spec.source.renderer
      )
        continue;
      if (
        mounted?.component?.update &&
        (mounted.source as DesktopRenderSource).renderer ===
          spec.source.renderer
      ) {
        mounted.source = spec.source;
        mounted.fingerprint = fingerprint;
        mounted.pending = mounted.pending
          .then(async () => {
            if (this.mounted.get(spec.id) !== mounted) return;
            await mounted.component!.update!(spec.source);
            this.changed();
          })
          .catch((error) =>
            this.context().host.notice(errorMessage(error), "error"),
          );
      } else {
        void this.mount(spec.source, spec.slot, spec.id, undefined, {
          target: spec.target,
          fingerprint,
        }).catch((error) => {
          if (!this.mounted.has(spec.id))
            this.failedRenderers.set(spec.id, {
              renderer: spec.source.renderer,
              fingerprint,
            });
          this.context().host.notice(errorMessage(error), "error");
        });
      }
    }
  }
  async key(id: string, event: DesktopKeyEvent): Promise<boolean> {
    const data = encodeDesktopKey(event);
    if (data === undefined) return false;
    return (await this.input(id, data, event)).consume;
  }
  async input(
    id: string,
    data: string,
    event?: DesktopKeyEvent,
    selection?: DesktopSelection,
    context?: DesktopInputContext,
  ): Promise<DesktopInputResult> {
    const mounted = this.mounted.get(id);
    if (this.terminalRuntime.capture().stopped) {
      await mounted?.pending;
      return { consume: true };
    }
    if (context?.instanceId && context.instanceId !== mounted?.instanceId)
      return { consume: true };
    if (
      !mounted?.component ||
      mounted.detached ||
      (mounted.overlay && this.overlayState(mounted).hidden)
    )
      return { consume: false, data };
    let result: DesktopInputResult = { consume: false, data };
    const pending = mounted.pending.then(async () => {
      if (
        this.mounted.get(id) !== mounted ||
        mounted.detached ||
        (mounted.overlay && this.overlayState(mounted).hidden)
      )
        return;
      if (mounted.component!.acceptsInput?.() === false) {
        result = { consume: true };
        return;
      }
      const previous = mounted.component!.getText?.();
      const tui = await loadTuiApi();
      if (
        this.nativeEndpoints.has(mounted.component!) &&
        mounted.component!.original &&
        !context?.raw &&
        !tui.isKeyRelease(data) &&
        event?.type !== "release"
      )
        this.terminalRuntime.capture().focus(mounted.component!.original);
      if (!mounted.component!.handlesTerminalInput) {
        const filtered = this.terminalInput
          .capture()
          .run(
            data,
            () =>
              this.mounted.get(id) !== mounted ||
              mounted.component!.acceptsInput?.() === false,
          );
        if (filtered.consume) {
          result = filtered;
          this.changed();
          return;
        }
        data = filtered.data ?? data;
      }
      if (
        selection &&
        context?.controlVersion === undefined &&
        !tui.isKeyRelease(data) &&
        event?.type !== "release"
      )
        mounted.component!.setSelection?.(selection);
      if (mounted.component!.handleInput)
        result = await mounted.component!.handleInput(data, event, context);
      else if (mounted.component!.handleKey) {
        const key =
          event && encodeDesktopKey(event) === data
            ? event
            : (() => {
                const decoded = desktopKeyFromId(tui.parseKey(data));
                return (
                  decoded && {
                    ...decoded,
                    ...(tui.isKeyRelease(data)
                      ? { type: "release" as const }
                      : {}),
                    ...(tui.isKeyRepeat(data)
                      ? { type: "press" as const, repeat: true }
                      : {}),
                  }
                );
              })();
        if (key)
          result = {
            consume: (await mounted.component!.handleKey!(key)) === true,
            data,
          };
      }
      if (this.mounted.get(id) !== mounted) {
        result = { consume: true };
        return;
      }
      if (
        mounted.slot === "editor" &&
        mounted.component!.getText?.() !== previous
      )
        this.editorRevision++;
      this.changed();
    });
    mounted.pending = pending.catch(() => {});
    await pending;
    if (this.terminalRuntime.capture().forwarding)
      await this.terminalRuntime.capture().flush();
    return result;
  }
  async action(id: string, event: DesktopUIAction, instanceId?: string) {
    const mounted = this.mounted.get(id);
    if (instanceId && instanceId !== mounted?.instanceId) return undefined;
    if (!mounted?.component)
      throw new Error("Desktop component is no longer active");
    if (
      mounted.detached ||
      (mounted.overlay && this.overlayState(mounted).hidden)
    )
      throw new Error("Desktop component is hidden");
    const perform = async () => {
      if (this.terminalRuntime.capture().stopped)
        return mounted.component!.view();
      if (
        this.mounted.get(id) !== mounted ||
        mounted.detached ||
        (mounted.overlay && this.overlayState(mounted).hidden)
      )
        return;
      if (mounted.component!.acceptsInput?.() === false)
        return mounted.component!.view();
      const action =
        mounted.component!.resolveAction?.(event.action) ?? event.action;
      if (!findAction(mounted.component!.view(), action))
        throw new Error("Desktop action is unavailable");
      const previous = mounted.component!.getText?.();
      if (
        this.nativeEndpoints.has(mounted.component!) &&
        mounted.component!.original
      )
        this.terminalRuntime.capture().focus(mounted.component!.original);
      await mounted.component!.handleAction({ ...event, action });
      if (
        mounted.slot === "editor" &&
        mounted.component!.getText?.() !== previous
      )
        this.editorRevision++;
      this.changed();
      if (this.mounted.get(id) === mounted) return mounted.component!.view();
    };
    const pending = mounted.pending.then(perform);
    mounted.pending = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  async mouse(
    id: string,
    action: string,
    event: DesktopMouseEvent,
    instanceId?: string,
  ): Promise<DesktopMouseResult> {
    const mounted = this.mounted.get(id);
    const inactive: DesktopMouseResult = {
      handled: false,
      capture: false,
      render: false,
    };
    if (instanceId && instanceId !== mounted?.instanceId) return inactive;
    if (!mounted?.component?.handleMouse) return inactive;
    let result = inactive;
    const pending = mounted.pending.then(async () => {
      if (this.terminalRuntime.capture().stopped) {
        result = { handled: true, capture: false, render: false };
        return;
      }
      if (this.mounted.get(id) !== mounted) return;
      if (mounted.component!.acceptsInput?.() === false) {
        result = { handled: true, capture: false, render: false };
        return;
      }
      if (
        mounted.detached ||
        (mounted.overlay && this.overlayState(mounted).hidden) ||
        !findAction(mounted.component!.view(), action)
      ) {
        mounted.component!.cancelMouse?.(event.pointerId);
        return;
      }
      result = await mounted.component!.handleMouse!(action, event);
      if (this.mounted.get(id) !== mounted) {
        result = inactive;
        return;
      }
      if (result.render) this.changed();
    });
    mounted.pending = pending.catch(() => {});
    await pending;
    return result;
  }
  cancelInput(id: string) {
    this.mounted.get(id)?.component?.cancelInput?.();
  }
  private detachOverlay(id: string) {
    const mounted = this.mounted.get(id);
    if (!mounted?.overlay || mounted.detached) return;
    // Pi removes the presentation without completing or disposing ui.custom().
    mounted.detached = true;
    if (mounted.overlay.focused) {
      mounted.overlay.focused = false;
      this.focusNext(mounted);
    }
    this.changed();
  }
  close(id: string, value?: unknown) {
    const mounted = this.mounted.get(id);
    if (!mounted || mounted.closing) return;
    mounted.closing = true;
    try {
      mounted.beforeClose?.();
    } catch (error) {
      this.context().host.notice(errorMessage(error), "error");
    }
    this.mounted.delete(id);
    if (mounted.slot === "editor") this.editorRevision++;
    if (mounted.overlay?.focused) this.focusNext(mounted);
    // Resolve before disposal to preserve Pi's Promise job ordering.
    try {
      mounted.close(value);
    } finally {
      mounted.controller.abort();
      try {
        mounted.component?.dispose?.();
      } catch (error) {
        this.context().host.notice(errorMessage(error), "error");
      } finally {
        this.changed();
      }
    }
  }
  getEditorText(): string | undefined {
    const editor = this.mounted.get("editor")?.component;
    return editor?.getExpandedText?.() ?? editor?.getText?.();
  }
  getEditorRawText(): string | undefined {
    return this.mounted.get("editor")?.component?.getText?.();
  }
  expandEditorText(text: string): string {
    return this.mounted.get("editor")?.component?.expandText?.(text) ?? text;
  }
  setEditorText(text: string) {
    if (this.getEditorText() !== text) this.editorRevision++;
    this.mounted.get("editor")?.component?.setText?.(text);
    this.changed();
  }
  setEditorSelection(selection: DesktopSelection) {
    this.mounted.get("editor")?.component?.setSelection?.(selection);
  }
  addEditorHistory(text: string) {
    this.mounted.get("editor")?.component?.addToHistory?.(text);
  }
  setEditorAutocompleteProvider(provider: DesktopAutocompleteProvider) {
    this.mounted.get("editor")?.component?.setAutocompleteProvider?.(provider);
    this.changed();
  }
  getEditorSelection(): DesktopSelection | undefined {
    return this.mounted.get("editor")?.component?.getSelection?.();
  }
  pasteEditorText(text: string): boolean {
    const editor = this.mounted.get("editor")?.component;
    if (!editor?.pasteText) return false;
    const previous = editor.getText?.();
    editor.pasteText(text);
    if (editor.getText?.() !== previous) this.editorRevision++;
    this.changed();
    return true;
  }
  /** Pi's extension reset keeps direct TUI registrations and the shared runtime. */
  resetExtensionSurfaces() {
    const scope = this.terminalRuntime.capture();
    scope.tui?.hideOverlay();
    for (const [id, mounted] of [...this.mounted]) {
      if (id === "tui:registrations" || mounted.runtimeOverlay) continue;
      this.close(id);
    }
    scope.resetSession();
    this.rendererStates.clear();
    this.failedRenderers.clear();
  }
  clearSurfaces() {
    this.terminalRuntime.capture().retire();
    this.terminalInput.reset();
    this.terminalPresentation.reset();
    for (const id of [...this.mounted.keys()]) this.close(id);
    this.terminalRuntime.reset();
    this.registrationScope = undefined;
    this.rendererStates.clear();
    this.failedRenderers.clear();
  }
  dispose() {
    this.clearSurfaces();
    this.adapters.clear();
  }
}
