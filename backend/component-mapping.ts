import type {
  DesktopNode,
  DesktopSurface,
  DesktopSelection,
  DesktopInputContext,
  DesktopUIAction,
  DesktopKeyEvent,
  DesktopInputResult,
  DesktopMouseEvent,
  DesktopRenderAdditions,
} from "../shared/desktop-ui.ts";
import type {
  DesktopAdapterContext,
  DesktopComponent,
  DesktopRenderSource,
  DesktopUIRegistry,
} from "./desktop-ui.ts";
import { createDetachedTui } from "./detached-tui.ts";
import type { TerminalRuntimeEndpoint } from "./terminal-runtime.ts";
import { parseTerminalEffect } from "../shared/terminal-effect.ts";
import { ComponentMouseBridge } from "./component-mouse.ts";
import { ComponentDisposal } from "./component-disposal.ts";
import { errorMessage } from "../shared/errors.ts";
import {
  componentReferences,
  delegatedRender,
} from "./component-delegation.ts";
import {
  componentText,
  componentBackground,
  componentLabel,
  componentTextStyle,
} from "./component-text.ts";
import { componentMarkdown } from "./component-markdown.ts";
import {
  createToolFallback,
  createToolResultRegion,
} from "./tool-rendering.ts";
import {
  componentRenderAdditions,
  componentRenderComposition,
  componentRenderLines,
  type ComponentRenderRange,
} from "./component-render.ts";
import { loadTuiApi, type DesktopTui, type PiMouseTarget } from "./tui-api.ts";
import { encodeDesktopKey, desktopKeyFromId } from "../shared/keyboard.ts";
import { normalizePasteSelection } from "../shared/paste-selection.ts";
import {
  loadComponentRuntime,
  componentField as state,
  requiredComponentField as required,
  setComponentField,
  callComponentMethod,
  componentMouseFocus,
  componentFocus,
  editComponentText,
  editComponentInput,
  componentPasteSpans,
  componentRenderBaselineFrame,
  componentHasCustomRender,
  withComponentEditorLayout,
  withComponentRangeDeletion,
  withComponentInputNavigation,
  type PiComponent,
  type PiMouseEvent,
} from "./component-runtime.ts";

export const mappedComponentTypes = [
  "BorderedLoader",
  "CancellableLoader",
  "Loader",
  "CustomEditor",
  "Editor",
  "Input",
  "SelectList",
  "SettingsList",
  "Markdown",
  "TruncatedText",
  "Text",
  "Image",
  "Spacer",
  "ScrollView",
  "MouseRegion",
  "HStack",
  "VStack",
  "Box",
  "Container",
  "DynamicBorder",
  "VisualLinePreview",
  "FooterComponent",
] as const;
interface Component extends PiComponent {
  dispose?(): void;
  getText?(): string;
  getExpandedText?(): string;
  setText?(text: string): void;
  getValue?(): string;
  setValue?(text: string): void;
  getCursor?(): { line: number; col: number };
  getSelectedItem?(): { value: string; label: string } | null;
  setSelectedIndex?(index: number): void;
  selectItem?(id: string): void;
  updateValue?(id: string, value: string): void;
  scrollTo?(row: number): void;
  updateLayout?(
    contentHeight: number,
    viewportHeight: number,
    changed: () => void,
  ): void;
  addToHistory?(text: string): void;
  onSubmit?(text: string): void;
}
interface MappedOverlay {
  component: Component;
  native: ReturnType<DesktopTui["showOverlay"]>;
  desktop?: ReturnType<DesktopAdapterContext["showOverlay"]>;
  detached?: boolean;
}
function component(value: unknown): value is Component {
  return (
    !!value &&
    typeof value === "object" &&
    typeof state(value, "render") === "function"
  );
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object",
      )
    : [];
}

/** Map Pi component types, retaining the extension's factory, instances and callbacks. */
export function registerComponentMappings(desktop: DesktopUIRegistry) {
  desktop.registerAdapter({
    id: "pi:component-library",
    fallback: true,
    matches: (source) =>
      typeof source === "function" ||
      component(source) ||
      (!!source &&
        typeof source === "object" &&
        typeof state(source, "renderer") === "function"),
    create: createMappedComponent,
  });
}

export async function createMappedComponent(
  context: DesktopAdapterContext,
  options: { initializeHistory?: boolean } = {},
): Promise<DesktopComponent> {
  const api = await loadTuiApi();
  const runtime = await loadComponentRuntime();
  const { sdk, slot, signal, invalidate, done } = context;
  const sharedRuntime = context.terminalRuntime;
  const publicTui = sharedRuntime.tui;
  const geometry = {
    get columns() {
      return sdk.desktop.viewportSize.width;
    },
    get rows() {
      return sdk.desktop.viewportSize.height;
    },
  };
  let stopped = false;
  let paused = false;
  let windowProgress = false;
  const windowOwner = {};
  const presentation = context.terminalPresentation;
  const tui = await createDetachedTui(
    () => {
      if (!paused && !stopped) invalidate();
    },
    geometry,
    {
      activate: () => {
        if (!stopped && !signal.aborted)
          sdk.host.emitEvent({ type: "activity", name: "terminal_active" });
      },
      setTitle: presentation.setTitle,
      setProgress: presentation.setProgress,
    },
    {
      signal,
      queryColors: presentation.queryColors,
    },
    false,
  );
  // A mapped surface already owns desktop input/rendering when it mounts.
  // Pause that ownership without disposing the original component tree.
  tui.stop = () => {
    if (stopped || paused) return;
    if (process.env.PI_DESKTOP_PTY === "1")
      sdk.host.emitEvent({ type: "activity", name: "terminal_active" });
    tui.terminal.stop();
    paused = true;
    mouse.clear();
    invalidate();
  };
  tui.start = () => {
    if (stopped || !paused) return;
    paused = false;
    tui.invalidate();
    invalidate();
  };
  const keys = runtime.keys.KeybindingsManager.create(sdk.host.agentDir);
  const inputKeys: Parameters<typeof api.setKeybindings>[0] = keys;
  const withKeys = <T>(
    operation: () => T,
    bindings: Parameters<typeof api.setKeybindings>[0] = keys,
  ): T => {
    const previous = api.getKeybindings();
    api.setKeybindings(bindings);
    try {
      return operation();
    } finally {
      api.setKeybindings(previous);
    }
  };
  const theme = sdk.session.extensionRunner.getUIContext().theme;
  const editorTheme = {
    borderColor: (text: string) => theme.fg("border", text),
    selectList: sdk.sdk.getSelectListTheme(),
  };
  const footer =
    slot === "footer" ? sharedRuntime.application?.footerData : undefined;
  const syncFooter = () => {
    if (!footer) return;
    sharedRuntime.application?.syncFooter();
  };
  syncFooter();
  const disposal = new ComponentDisposal<Component>();
  const retired = new WeakSet<Component>();
  const ids = new WeakMap<object, string>();
  const controls = new Map<string, Component>();
  const occurrences = new Map<string, { target: Component; parent?: string }>();
  const mouseHandlers = new WeakMap<Component, Component["handleMouse"]>();
  const revisions = new WeakMap<object, { text: string; revision: number }>();
  const ranges = new WeakMap<object, DesktopSelection>();
  const rangeOrigins = new WeakMap<object, { text: string; cursor: number }>();
  const controlStates = new WeakMap<
    Component,
    { text: string; cursor: number; version: number }
  >();
  let activeControl: Component | undefined;
  const selectionRevisions = new WeakMap<
    object,
    DesktopSelection & { text: string; revision: number }
  >();
  const owners = new WeakMap<Component, Component>();
  const inputOwners = new WeakMap<Component, Component>();
  const delegatedChildren = new WeakMap<Component, Component[]>();
  const terminalFrames = new Map<Component, Component>();
  const terminalEffects = new WeakMap<
    Component,
    { data: string; sequence: number; index: number }
  >();
  const terminalFocusTargets = new WeakMap<Component, Component>();
  let mappingRoot: Component | undefined;
  let surfaceWidth: number | undefined;
  let mappingWidth: number | undefined;
  const overlays = new Set<MappedOverlay>();
  const hideMappedOverlay = (overlay?: MappedOverlay) => {
    if (!overlay || overlay.detached) return;
    overlay.detached = true;
    overlay.native.hide();
    overlay.desktop?.hide();
    invalidate();
  };
  const inputScope = context.terminalInput;
  inputScope.bind(tui);
  const releasePresentation = presentation.bind(tui);
  let counter = 0;
  let root: Component | undefined;
  let rendererComponent: Component | undefined;
  let transcriptRenderer: Component | undefined;
  let toolRegion: ReturnType<typeof createToolResultRegion> | undefined;
  let focused: Component | undefined;
  const claimedFocus = new Set<Component>();
  const borrowedTargets = new Set<Component>();
  let requestedFocus: Component | null | undefined;
  let focusRevision = 0;
  let renderSourceValue: DesktopRenderSource | undefined;
  let rendererDirty = false;
  let rootOverlay = context.runtimeOverlay;
  let releaseRuntime: (() => void) | undefined;
  const invalidateTui = tui.invalidate.bind(tui);
  tui.invalidate = () => {
    if (stopped) return;
    withKeys(() => {
      // Factory roots are hosted by the desktop registry, outside the native
      // TUI children list. Preserve native child/overlay invalidation as well.
      if (
        root &&
        !tui.children.includes(root) &&
        ![...overlays].some(
          (overlay) => !overlay.detached && overlay.component === root,
        )
      )
        root.invalidate();
      invalidateTui();
    });
  };
  const setFocus = tui.setFocus.bind(tui);
  const setMappedFocus = (target: Parameters<DesktopTui["setFocus"]>[0]) => {
    sharedRuntime.focus(target);
  };
  tui.setFocus = (target) => {
    if (stopped) return;
    sharedRuntime.focus(target, true);
  };
  const focusRequest = (
    owner: Component | readonly Component[] | undefined,
  ): DesktopSurface["focusRequest"] => {
    if (stopped || requestedFocus === undefined) return undefined;
    if (requestedFocus === null)
      return { action: null, revision: focusRevision };
    const projected = terminalFocusTargets.get(requestedFocus);
    const target =
      projected && terminalFrames.has(projected) ? projected : requestedFocus;
    const action = ids.get(target);
    const owns = (source: Component | undefined) =>
      Array.isArray(owner) ? owner.includes(source) : source === owner;
    let source = inputOwners.get(target);
    if (!source && !action) {
      const candidates = [...terminalFrames].filter(([, surface]) =>
        owns(surface),
      );
      if (candidates.length === 1)
        return { action: ids.get(candidates[0][0])!, revision: focusRevision };
    }
    const seen = new Set<Component>();
    while (source && !owns(source) && !seen.has(source)) {
      seen.add(source);
      source = inputOwners.get(source);
    }
    if (!action || controls.get(action) !== target || !owns(source))
      return undefined;
    return { action, revision: focusRevision };
  };
  const classify = (value: Component) =>
    mappedComponentTypes.find((name) => {
      const Constructor =
        Reflect.get(api, name) ??
        Reflect.get(sdk.sdk, name) ??
        Reflect.get(runtime.preview, name);
      return typeof Constructor === "function" && value instanceof Constructor;
    });
  const customMouse = (target: Component) => {
    const kind = classify(target);
    if (!kind) return !!target.handleMouse;
    const Constructor =
      kind && (Reflect.get(api, kind) ?? Reflect.get(sdk.sdk, kind));
    const prototype =
      typeof Constructor === "function"
        ? state(Constructor, "prototype")
        : undefined;
    return !!(
      target.handleMouse &&
      prototype &&
      typeof prototype === "object" &&
      (mouseHandlers.get(target) ?? target.handleMouse) !==
        state(prototype, "handleMouse")
    );
  };
  const id = (value: Component) => {
    let result = ids.get(value);
    if (!result) {
      result = `component:${++counter}`;
      ids.set(value, result);
    }
    controls.set(result, value);
    return result;
  };
  const mouse = new ComponentMouseBridge(
    {
      dispatchMouseEvent: (target, event) =>
        withKeys(() => runtime.mouse.dispatchMouseEvent(target, event)),
      retargetMouseEvent: runtime.mouse.retargetMouseEvent,
    },
    (target) => {
      const focusTarget: Component = componentMouseFocus(publicTui, target);
      const previous = focused;
      setMappedFocus(focusTarget);
      const actual = focused ?? focusTarget;
      if (actual.getText || actual.getValue)
        rememberRange(actual, cursor(actual));
      return { action: id(actual), changed: previous !== focused };
    },
  );
  const track = (target: Component) => {
    if (stopped && retired.has(target)) return;
    disposal.track(target);
  };
  const cleanupStep = (operation: () => void) => {
    try {
      operation();
    } catch (error) {
      sdk.host.notice(errorMessage(error), "error");
    }
  };
  const release = (preserve = new Set<Component>()) => {
    if (context.terminalRegion && !sharedRuntime.signal.aborted) {
      for (const target of sharedRuntime.retained(runtimeEndpoint)) {
        if (disposal.has(target)) borrowedTargets.add(target);
        preserve.add(target);
      }
    }
    const interactive = new Set(
      [...controls.values()].filter((target) => preserve.has(target)),
    );
    mouse.retain(interactive);
    const activeRoots = new Set(
      [
        root,
        ...tui.children,
        ...[...overlays].map((overlay) => overlay.component),
      ]
        .filter((item): item is Component => !!item)
        .map((item) => ids.get(item)),
    );
    for (const [key, occurrence] of occurrences)
      if (
        !interactive.has(occurrence.target) ||
        !activeRoots.has(key.split("/")[0])
      )
        occurrences.delete(key);
    for (const [frame, owner] of terminalFrames)
      if (!interactive.has(frame) || !preserve.has(owner))
        terminalFrames.delete(frame);
    focused = componentFocus(tui);
    if (focused && disposal.has(focused) && !interactive.has(focused))
      setMappedFocus(null);
    if (
      requestedFocus &&
      disposal.has(requestedFocus) &&
      !interactive.has(requestedFocus)
    )
      requestedFocus = undefined;
    disposal.release(preserve, (target, dispose) => {
      retired.add(target);
      if (classify(target) === "CancellableLoader") {
        const controller = state(target, "abortController");
        if (controller instanceof AbortController)
          cleanupStep(() => controller.abort());
      }
      if (classify(target) === "BorderedLoader") {
        const controller = state(target, "signalController");
        if (controller instanceof AbortController)
          cleanupStep(() => controller.abort());
      }
      if (dispose && !borrowedTargets.has(target)) cleanupStep(dispose);
      else if (classify(target) === "Loader")
        cleanupStep(() => {
          callComponentMethod(target, "stop");
        });
      if (["Editor", "CustomEditor"].includes(classify(target) ?? ""))
        cleanupStep(() => {
          callComponentMethod(target, "cancelAutocomplete");
        });
      if (classify(target) === "ScrollView") {
        const timer = state(target, "scrollbarHideTimer");
        if (timer) clearTimeout(timer as NodeJS.Timeout);
      }
    });
  };
  const rememberTree = (target: Component, seen = new Set<Component>()) => {
    if (seen.has(target)) return seen;
    seen.add(target);
    track(target);
    const kind = classify(target);
    const children =
      kind === "HStack" || kind === "VStack"
        ? objects(state(target, "entries")).map((entry) => entry.component)
        : Array.isArray(state(target, "children"))
          ? (state(target, "children") as unknown[])
          : [];
    const members = [
      ...children,
      state(target, "child"),
      state(target, "searchInput"),
      state(target, "submenuComponent"),
      state(target, "autocompleteList"),
      ...(delegatedChildren.get(target) ?? []),
      ...(!kind ? componentReferences(target, publicTui) : []),
    ].filter(component);
    if (!stopped || !retired.has(target))
      disposal.connect(
        target,
        members.filter((child) => !stopped || !retired.has(child)),
      );
    for (const child of members) rememberTree(child, seen);
    return seen;
  };
  const rememberRegistered = (seen = new Set<Component>()) => {
    for (const child of tui.children) rememberTree(child, seen);
    return seen;
  };
  const rememberOwned = () => {
    const retained = rememberRegistered();
    if (root) rememberTree(root, retained);
    for (const overlay of overlays) rememberTree(overlay.component, retained);
    return retained;
  };
  for (const method of ["addChild", "removeChild", "clear"] as const) {
    const original = tui[method];
    // Keep native return/throw/receiver semantics; ownership also starts before
    // a factory returns, removes a child, or fails to produce its root.
    Object.defineProperty(tui, method, {
      configurable: true,
      writable: true,
      value: function (this: DesktopTui, ...args: unknown[]) {
        if (this === tui) cleanupStep(() => rememberRegistered());
        try {
          return Reflect.apply(original, this, args);
        } finally {
          if (this === tui) {
            cleanupStep(() => rememberRegistered());
            if (stopped) cleanupStep(() => release());
          }
        }
      },
    });
  }
  const cleanup = () => {
    cleanupStep(() => rememberRegistered());
    if (stopped) {
      cleanupStep(() => release());
      return;
    }
    stopped = true;
    rootOverlay?.hide();
    releaseRuntime?.();
    releasePresentation();
    if (windowProgress)
      cleanupStep(() => sdk.host.setWindowProgress(windowOwner, false));
    signal.removeEventListener("abort", cleanup);
    for (const overlay of [...overlays])
      cleanupStep(() => hideMappedOverlay(overlay));
    cleanupStep(() => mouse.clear());
    cleanupStep(() => release());
    controls.clear();
    terminalFrames.clear();
  };
  const getText = (target: Component) =>
    target.getText?.() ?? target.getValue?.() ?? "";
  const textRevision = (target: Component) => {
    const text = getText(target);
    let entry = revisions.get(target);
    if (!entry) {
      entry = { text, revision: 0 };
      revisions.set(target, entry);
    }
    if (entry.text !== text) {
      entry.text = text;
      entry.revision++;
    }
    return entry.revision;
  };
  const selectionState = (target: Component) => {
    const text = getText(target);
    const range = storedRange(target) ?? cursor(target);
    let entry = selectionRevisions.get(target);
    if (!entry) {
      entry = { ...range, text, revision: 0 };
      selectionRevisions.set(target, entry);
    }
    if (
      entry.start !== range.start ||
      entry.end !== range.end ||
      entry.text !== text
    ) {
      entry.start = range.start;
      entry.end = range.end;
      entry.text = text;
      entry.revision++;
    }
    return entry;
  };
  const setText = (target: Component, text: string) => {
    if (target.setText) target.setText(text);
    else if (target.setValue) target.setValue(text);
  };
  const editText = <T>(
    target: Component,
    text: string,
    operation: () => T,
  ): T => {
    if (["Editor", "CustomEditor"].includes(classify(target) ?? ""))
      return withKeys(() => editComponentText(target, text, operation));
    if (classify(target) === "Input")
      return withKeys(() => editComponentInput(target, text, operation));
    setText(target, text);
    return operation();
  };
  const cursor = (target: Component): DesktopSelection => {
    const position = target.getCursor?.();
    const offset = position
      ? getText(target)
          .split("\n")
          .slice(0, position.line)
          .reduce((sum, line) => sum + line.length + 1, position.col)
      : number(state(target, "cursor"));
    return { start: offset, end: offset };
  };
  function controlState(target: Component) {
    const text = getText(target),
      offset = cursor(target).start;
    let entry = controlStates.get(target);
    if (!entry) {
      entry = { text, cursor: offset, version: 0 };
      controlStates.set(target, entry);
    } else if (entry.text !== text || entry.cursor !== offset) {
      if (target !== activeControl) entry.version++;
      entry.text = text;
      entry.cursor = offset;
    }
    return entry;
  }
  function actionControl(action?: string) {
    const id = action?.match(/^component:\d+/)?.[0];
    return id ? controls.get(id) : undefined;
  }
  function controlOperation<T>(
    owner: Component | undefined,
    operation: () => T,
  ): T {
    const remember = () => {
      for (const target of new Set(controls.values()))
        if (controlStates.has(target)) controlState(target);
    };
    remember();
    const before = owner && {
      text: getText(owner),
      cursor: cursor(owner).start,
    };
    const previous = activeControl;
    // Only the request's acknowledged control may keep accepting queued edits.
    activeControl = owner;
    try {
      return operation();
    } catch (error) {
      if (
        owner &&
        before &&
        (getText(owner) !== before.text ||
          cursor(owner).start !== before.cursor)
      )
        controlState(owner).version++;
      throw error;
    } finally {
      try {
        remember();
      } finally {
        activeControl = previous;
      }
    }
  }
  function rememberRange(target: Component, range: DesktopSelection) {
    ranges.set(target, range);
    rangeOrigins.set(target, {
      text: getText(target),
      cursor: cursor(target).start,
    });
  }
  function storedRange(target: Component) {
    const origin = rangeOrigins.get(target);
    // Original SDK mutations supersede a range captured before that mutation.
    if (
      origin &&
      (origin.text !== getText(target) ||
        origin.cursor !== cursor(target).start)
    ) {
      ranges.delete(target);
      rangeOrigins.delete(target);
    }
    return ranges.get(target);
  }
  const position = (
    target: Component,
    range: DesktopSelection,
    focus = true,
  ) => {
    const text = getText(target);
    if (["Editor", "CustomEditor"].includes(classify(target) ?? ""))
      range = normalizePasteSelection(text, range, componentPasteSpans(target));
    const start = Math.max(0, Math.min(text.length, number(range.start)));
    const end = Math.max(
      start,
      Math.min(text.length, number(range.end, start)),
    );
    if (classify(target) === "Input")
      setComponentField(target, "cursor", start);
    else if (["Editor", "CustomEditor"].includes(classify(target) ?? "")) {
      const before = text.slice(0, start).split("\n");
      const model = required(target, "state");
      if (!model || typeof model !== "object")
        throw new Error("Pi editor state is unavailable");
      setComponentField(model, "cursorLine", before.length - 1);
      setComponentField(model, "cursorCol", before.at(-1)!.length);
    }
    rememberRange(target, { start, end });
    if (focus) setMappedFocus(target);
  };
  const execute = (
    target: Component,
    data: string,
    bindings = keys as Parameters<typeof api.setKeybindings>[0],
  ) => {
    withKeys(() => target.handleInput?.(data), bindings);
    invalidate();
  };
  const keyFor = (
    action: Parameters<typeof keys.getKeys>[0],
    fallback: string,
  ) => {
    const key = keys.getKeys(action)[0];
    // The control remains clickable even when its keyboard binding is disabled.
    return key ? (encodeDesktopKey(keyEvent(key)) ?? fallback) : fallback;
  };
  const confirm = () => keyFor("tui.select.confirm", "\r");
  const cancel = () => keyFor("tui.select.cancel", "\x1b");
  const padding = (target: Component) => ({
    x: number(state(target, "paddingX")),
    y: number(state(target, "paddingY")),
  });
  const hasMouse = (target: Component, ancestors: Set<Component>) =>
    [target, ...ancestors].some(
      (item) => classify(item) === "MouseRegion" || customMouse(item),
    );
  const isInteractive = (target: Component) =>
    ["Input", "Editor", "CustomEditor", "SelectList", "SettingsList"].includes(
      classify(target) ?? "",
    );
  const renderControl = (
    target: Component,
    content: DesktopNode,
    rendered: DesktopRenderAdditions,
    original: string[],
  ) => {
    if (!rendered.replacement?.length || content.kind !== "column") return;
    const field = content.children.find(
      (child) =>
        "action" in child && child.action === id(target) && "label" in child,
    );
    const row = original.findIndex((line) => line.includes(api.CURSOR_MARKER));
    rendered.control = {
      action: id(target),
      desktopLabel: field ? field.desktopLabel : true,
      label:
        field && "label" in field
          ? field.label
          : classify(target) === "SettingsList"
            ? "设置"
            : "选择",
      ...(row >= 0
        ? {
            cursor: {
              row,
              col: api.visibleWidth(original[row].split(api.CURSOR_MARKER)[0]),
            },
          }
        : {}),
    };
  };
  const renderedChildren = new WeakMap<DesktopNode, ComponentRenderRange[]>();
  const applyChildFrame = (
    child: DesktopNode,
    baseline: string[],
    original: string[],
    contentRow = 0,
  ): DesktopNode => {
    const target = controls.get(child.component!.action)!;
    const body = child.kind === "region" ? child.child : child;
    const childRanges = renderedChildren.get(child);
    const nested = childRanges
      ? composeFrame(
          body,
          baseline,
          original,
          childRanges.map((range) => ({
            ...range,
            start: range.start + contentRow,
          })),
        )
      : {
          content: body,
          rendered: {
            before: [],
            after: [],
            replacement: componentRenderLines(
              original,
              runtime,
              api.CURSOR_MARKER,
            ),
          } as DesktopRenderAdditions,
        };
    if (nested.rendered && isInteractive(target))
      renderControl(target, nested.content, nested.rendered, original);
    const view = { ...nested.content, rendered: nested.rendered };
    const mapped: DesktopNode =
      child.kind === "region"
        ? { ...child, child: view }
        : nested.rendered?.control && target.handleMouse
          ? {
              kind: "region",
              component: child.component,
              action: id(target),
              child: { ...view, component: undefined },
              nativeControls: true,
            }
          : view;
    if (nested.children) renderedChildren.set(mapped, nested.children);
    return mapped;
  };
  const composeHorizontalFrame = (
    content: DesktopNode & { children: DesktopNode[] },
    baseline: string[],
    original: string[],
    ranges: ComponentRenderRange[],
  ): {
    content: DesktopNode;
    children: ComponentRenderRange[];
    rendered?: DesktopRenderAdditions;
  } => {
    const base = componentRenderLines(baseline, runtime, api.CURSOR_MARKER);
    const actual = componentRenderLines(original, runtime, api.CURSOR_MARKER);
    if (!actual.length)
      return {
        content,
        children: [],
        rendered: { before: [], after: [], replacement: [] },
      };
    const sourceStart = Math.max(
      0,
      Math.min(...ranges.map((range) => range.start)),
    );
    const sourceEnd = Math.min(
      baseline.length,
      Math.max(...ranges.map((range) => range.start + range.length)),
    );
    const sourceBody = baseline.slice(sourceStart, sourceEnd);
    const sourceLength = sourceBody.length;
    const frameStart = base.length
      ? actual.findIndex((_line, start) =>
          base.every(
            (line, index) =>
              JSON.stringify(line) === JSON.stringify(actual[start + index]),
          ),
        )
      : 0;
    let bodyStart = frameStart >= 0 ? frameStart + sourceStart : -1;
    let bodyLength = sourceLength;
    if (bodyStart < 0 && sourceLength) {
      const columns = ranges
        .filter((range) => (range.columns ?? 0) > 0)
        .map((range) => ({
          range,
          lines: componentRenderLines(
            sourceBody.map((line) =>
              api.sliceByColumn(line, range.column ?? 0, range.columns!, true),
            ),
            runtime,
            api.CURSOR_MARKER,
          ),
        }));
      // Intact nonblank columns can anchor changed siblings and gaps together.
      const anchors = columns.filter(({ lines }) =>
        lines.some((line) => line.text.trim()),
      );
      if (anchors.length) {
        const matches = new Set<number>();
        const completeMatches = new Set<number>();
        for (let start = 0; start + sourceLength <= original.length; start++) {
          const candidate = original.slice(start, start + sourceLength);
          const matched = columns.map(
            ({ range, lines }) =>
              JSON.stringify(lines) ===
              JSON.stringify(
                componentRenderLines(
                  candidate.map((line) =>
                    api.sliceByColumn(
                      line,
                      range.column ?? 0,
                      range.columns!,
                      true,
                    ),
                  ),
                  runtime,
                  api.CURSOR_MARKER,
                ),
              ),
          );
          if (matched.every(Boolean)) completeMatches.add(start);
          if (
            columns.some(
              ({ lines }, index) =>
                matched[index] && lines.some((line) => line.text.trim()),
            )
          )
            matches.add(start);
        }
        const resized = new Map<string, { start: number; length: number }>();
        if (!completeMatches.size && sourceLength > 1)
          for (const { range, lines } of anchors) {
            if (!lines[0].text.trim() || !lines.at(-1)!.text.trim()) continue;
            const projected = componentRenderLines(
              original.map((line) =>
                api.sliceByColumn(
                  line,
                  range.column ?? 0,
                  range.columns!,
                  true,
                ),
              ),
              runtime,
              api.CURSOR_MARKER,
            );
            const same = (
              left: (typeof lines)[number],
              right: (typeof lines)[number],
            ) => JSON.stringify(left) === JSON.stringify(right);
            const starts = projected.flatMap((line, row) =>
              same(lines[0], line) ? [row] : [],
            );
            const ends = projected.flatMap((line, row) =>
              same(lines.at(-1)!, line) ? [row] : [],
            );
            if (
              starts.length !== 1 ||
              ends.length !== 1 ||
              ends[0] <= starts[0]
            )
              continue;
            const start = starts[0],
              length = ends[0] - start + 1;
            if (length === sourceLength) continue;
            const changes = runtime.diff.diffArrays(
              lines,
              projected.slice(start, start + length),
              { comparator: same },
            );
            // An intact column can change height through internal insertions/deletions.
            if (
              changes.some(
                (change, index) =>
                  change.added &&
                  (changes[index - 1]?.removed || changes[index + 1]?.removed),
              )
            )
              continue;
            resized.set(`${start}:${length}`, { start, length });
          }
        if (completeMatches.size === 1)
          bodyStart = completeMatches.values().next().value!;
        else if (!completeMatches.size && resized.size === 1) {
          const bounds = resized.values().next().value!;
          bodyStart = bounds.start;
          bodyLength = bounds.length;
        } else if (!completeMatches.size && !resized.size && matches.size === 1)
          bodyStart = matches.values().next().value!;
      }
    }
    const body =
      bodyStart >= 0
        ? original.slice(bodyStart, bodyStart + bodyLength)
        : original;
    const width = Math.max(
      0,
      ...sourceBody.concat(body).map((line) => api.visibleWidth(line)),
      ...ranges.map((range) => (range.column ?? 0) + (range.columns ?? 0)),
    );
    const slots: NonNullable<DesktopRenderAdditions["composition"]> = [];
    const gaps: {
      lines: ReturnType<typeof componentRenderLines>;
      columns: number;
    }[] = [];
    let column = 0;
    const gap = (end: number, trailing = false) => {
      if (end <= column) return;
      const columns = end - column;
      const lines = componentRenderLines(
        body.map((line) => api.sliceByColumn(line, column, columns, true)),
        runtime,
        api.CURSOR_MARKER,
      );
      const part = { lines, columns, ...(trailing ? { trailing: true } : {}) };
      slots.push(part);
      gaps.push(part);
    };
    for (const range of ranges) {
      gap(range.column ?? column);
      slots.push({ child: range.child });
      column = (range.column ?? column) + (range.columns ?? 0);
    }
    gap(width, true);
    // Styled blank cells and unchanged enclosing-frame drawing also own gaps.
    const painted = gaps.some((part) =>
      part.lines.some(
        (line) =>
          line.text.trim() ||
          line.runs?.some((run) => run.style || run.href || run.blink),
      ),
    );
    const composition = painted
      ? slots
      : slots.filter((part) => "child" in part);
    const comparable = (lines: string[]) => {
      const frame = componentRenderLines(lines, runtime, api.CURSOR_MARKER);
      let start = 0,
        end = frame.length;
      while (start < end && !frame[start].text.trim()) start++;
      while (end > start && !frame[end - 1].text.trim()) end--;
      return JSON.stringify(frame.slice(start, end));
    };
    const children = ranges.map((range) => ({
      ...range,
      length: body.length,
      start:
        bodyStart >= 0 ? range.start - sourceStart + bodyStart : range.start,
    }));
    for (const range of children) {
      const child = content.children[range.child];
      if (!child.component || !range.columns) continue;
      const project = (lines: string[]) =>
        lines.map((line) =>
          api.sliceByColumn(line, range.column ?? 0, range.columns!, true),
        );
      const before = project(bodyStart >= 0 ? sourceBody : baseline),
        after = project(body);
      if (comparable(before) === comparable(after)) continue;
      content.children[range.child] = applyChildFrame(
        child,
        before,
        after,
        range.contentRow,
      );
      range.contentRow = 0;
      range.length = body.length;
    }
    return {
      content,
      children,
      rendered: {
        before: bodyStart >= 0 ? actual.slice(0, bodyStart) : [],
        after: bodyStart >= 0 ? actual.slice(bodyStart + bodyLength) : [],
        composition,
      },
    };
  };
  const composeFrame = (
    content: DesktopNode,
    baseline: string[],
    original: string[],
    ranges: ComponentRenderRange[],
  ): {
    content: DesktopNode;
    rendered?: DesktopRenderAdditions;
    children?: ComponentRenderRange[];
  } => {
    if (!("children" in content)) return { content };
    if (
      content.kind === "row" &&
      ranges.some((range) => range.columns !== undefined)
    )
      return composeHorizontalFrame(content, baseline, original, ranges);
    const composed = componentRenderComposition(
      baseline,
      original,
      ranges.map((range) => {
        const child = content.children[range.child];
        const target = child?.component?.action
          ? controls.get(child.component.action)
          : undefined;
        return {
          ...range,
          interactive:
            (target ? isInteractive(target) : false) ||
            (child ? renderedChildren.has(child) : false),
        };
      }),
      runtime,
      api.CURSOR_MARKER,
    );
    if (!composed) return { content };
    for (const partial of composed.partialChildren ?? []) {
      const child = content.children[partial.child];
      const column = content.kind === "column" ? (content.padding?.x ?? 0) : 0;
      const project = (lines: string[]) =>
        column && child.component?.columns
          ? lines.map((line) =>
              api
                .stripTerminalSequences(
                  api.sliceByColumn(line, 0, column, true),
                )
                .trim()
                ? line
                : api.sliceByColumn(
                    line,
                    column,
                    child.component!.columns!,
                    true,
                  ),
            )
          : lines;
      const childOriginal = original.slice(
        partial.start,
        partial.start + partial.length,
      );
      content.children[partial.child] = applyChildFrame(
        child,
        project(
          baseline.slice(
            partial.sourceStart,
            partial.sourceStart + partial.sourceLength,
          ),
        ),
        project(childOriginal),
      );
    }
    const children = composed.childRanges;
    delete composed.childRanges;
    delete composed.partialChildren;
    return {
      content,
      children,
      rendered:
        composed.replacement !== undefined ||
        composed.composition ||
        composed.before.length ||
        composed.after.length
          ? composed
          : undefined,
    };
  };
  const map = (
    target: Component,
    ancestors = new Set<Component>(),
    occurrence = id(target),
    parent?: string,
    width = mappingWidth ?? geometry.columns,
    captureFrame = false,
  ): DesktopNode => {
    if (ancestors.has(target)) throw new Error("Cyclic Pi component tree");
    const previousWidth = mappingWidth;
    mappingWidth = width;
    try {
      occurrences.set(occurrence, { target, parent });
      const kind = classify(target);
      const Constructor =
        kind && (Reflect.get(api, kind) ?? Reflect.get(sdk.sdk, kind));
      const standardRender =
        typeof Constructor === "function"
          ? Reflect.get(Reflect.get(Constructor, "prototype"), "render")
          : undefined;
      const interactive = isInteractive(target);
      const replaceContent =
        interactive ||
        (kind !== undefined &&
          ["Text", "TruncatedText", "Spacer", "DynamicBorder"].includes(kind));
      // Preview text already consumes the complete original render output.
      const comparison =
        kind !== "VisualLinePreview" &&
        kind !== "FooterComponent" &&
        typeof standardRender === "function" &&
        (componentHasCustomRender(
          target,
          Reflect.get(Constructor, "prototype"),
        ) ||
          (captureFrame &&
            [
              "Container",
              "Box",
              "VStack",
              "HStack",
              "ScrollView",
              "BorderedLoader",
            ].includes(kind ?? "")))
          ? withKeys(() => {
              const frame = componentRenderBaselineFrame(
                target,
                Reflect.get(Constructor, "prototype"),
                width,
                kind,
              );
              const baseline = frame.lines.slice();
              const original = target.render(width);
              return {
                baseline,
                original,
                children: frame.children,
                borders: frame.borders,
              };
            })
          : undefined;
      const content = mapContent(
        target,
        ancestors,
        occurrence,
        comparison,
        captureFrame,
      );
      const composed = comparison?.children
        ? composeFrame(
            content,
            comparison.baseline,
            comparison.original,
            comparison.children,
          )
        : undefined;
      const rendered = comparison
        ? composed
          ? composed.rendered
          : componentRenderAdditions(
              comparison.baseline,
              comparison.original,
              runtime,
              api.CURSOR_MARKER,
              kind === "Editor" || kind === "CustomEditor",
              replaceContent,
              comparison.borders,
            )
        : undefined;
      if (rendered && interactive)
        renderControl(target, content, rendered, comparison!.original);
      const view = rendered ? { ...content, rendered } : content;
      const mapped: DesktopNode =
        kind !== "MouseRegion" &&
        (customMouse(target) || (rendered?.control && target.handleMouse))
          ? {
              component: { action: id(target), occurrence, columns: width },
              kind: "region",
              action: id(target),
              child: view,
              nativeControls: true,
            }
          : {
              ...view,
              component: { action: id(target), occurrence, columns: width },
            };
      const childRanges = composed?.children ?? renderedChildren.get(content);
      if (childRanges) renderedChildren.set(mapped, childRanges);
      return mapped;
    } finally {
      mappingWidth = previousWidth;
    }
  };
  const mapContent = (
    target: Component,
    ancestors = new Set<Component>(),
    occurrence = id(target),
    comparison?: {
      baseline: string[];
      original: string[];
      children?: ComponentRenderRange[];
    },
    captureFrame = false,
  ): DesktopNode => {
    track(target);
    terminalFocusTargets.delete(target);
    inputOwners.set(target, mappingRoot ?? target);
    const next = new Set(ancestors).add(target);
    const kind = classify(target);
    const action = id(target);
    if (!kind) {
      const width = mappingWidth ?? geometry.columns;
      const previousChildren = delegatedChildren.get(target) ?? [];
      // Reobserve known instances even after an extension moves their references
      // into private storage. Only actual calls establish current render ownership.
      const frame = withKeys(() =>
        delegatedRender(target, width, publicTui, previousChildren),
      );
      const members = new Set(componentReferences(target, publicTui));
      const children = [
        ...new Set([
          ...frame.children,
          ...previousChildren.filter((child) => members.has(child)),
        ]),
      ];
      if (children.length) delegatedChildren.set(target, children);
      else delegatedChildren.delete(target);
      if (frame.child) {
        const previousRoot = mappingRoot;
        if (!mappingRoot?.handleInput && target.handleInput)
          mappingRoot = target;
        try {
          const child = map(
            frame.child.component,
            next,
            `${occurrence}/delegate`,
            occurrence,
            width,
            true,
          );
          const composed = composeFrame(
            { kind: "column", children: [child] },
            frame.child.lines,
            frame.lines,
            [{ child: 0, start: 0, length: frame.child.lines.length }],
          );
          const view = {
            ...composed.content,
            ...(composed.rendered ? { rendered: composed.rendered } : {}),
          };
          if (composed.children) renderedChildren.set(view, composed.children);
          return view;
        } finally {
          mappingRoot = previousRoot;
        }
      }
      const cols = Math.max(2, Math.min(500, mappingWidth ?? geometry.columns));
      const lines =
        cols === width ? frame.lines : withKeys(() => target.render(cols));
      if (!lines.length) return { kind: "spacer", lines: 0 };
      const descendants = new Set<Component>();
      const pending = [...children, ...members];
      while (pending.length) {
        const child = pending.pop()!;
        if (next.has(child) || descendants.has(child)) continue;
        descendants.add(child);
        track(child);
        id(child);
        inputOwners.set(child, mappingRoot ?? target);
        terminalFocusTargets.set(child, target);
        for (const nested of componentReferences(child, publicTui))
          pending.push(nested);
      }
      if (descendants.size) delegatedChildren.set(target, [...descendants]);
      terminalFrames.set(target, mappingRoot ?? target);
      const rows = Math.max(1, Math.min(300, lines.length));
      const visible = lines.slice(-rows);
      let cursor: { row: number; col: number } | undefined;
      for (let row = visible.length - 1; row >= 0; row--) {
        const offset = visible[row].indexOf(api.CURSOR_MARKER);
        if (offset >= 0) {
          cursor = {
            row,
            col: api.visibleWidth(visible[row].slice(0, offset)),
          };
          break;
        }
      }
      const data = visible
        .map((line) => line.split(api.CURSOR_MARKER).join(""))
        .join("\r\n");
      const previousEffects = terminalEffects.get(target);
      const effects =
        previousEffects?.data === data
          ? previousEffects
          : {
              data,
              sequence: (previousEffects?.sequence ?? 0) + 1,
              index: 0,
            };
      terminalEffects.set(target, effects);
      return {
        kind: "terminal",
        action,
        data,
        effectSequence: effects.sequence,
        cols,
        rows,
        cursor,
        showCursor: tui.getShowHardwareCursor(),
      };
    }
    if (kind === "DynamicBorder")
      return {
        kind: "divider",
        style: componentTextStyle(
          string(
            callComponentMethod(
              target,
              "color",
              "\u2500".repeat(Math.max(1, mappingWidth ?? geometry.columns)),
            ),
          ),
          runtime.text,
        ),
      };
    if (kind === "BorderedLoader") {
      const loader = required(target, "loader");
      if (!component(loader))
        throw new Error("Pi BorderedLoader child is unavailable");
      return {
        kind: "column",
        children: objects(required(target, "children")).map((child, index) => {
          if (!component(child))
            throw new Error("Pi BorderedLoader child is unavailable");
          return map(
            child,
            next,
            `${occurrence}/${index}`,
            occurrence,
            mappingWidth,
            captureFrame || !!comparison,
          );
        }),
      };
    }
    if (["Container", "Box", "HStack", "VStack", "ScrollView"].includes(kind)) {
      const entries: Record<string, unknown>[] =
        kind === "HStack" || kind === "VStack"
          ? objects(required(target, "entries"))
          : (Array.isArray(required(target, "children"))
              ? (required(target, "children") as unknown[])
              : []
            ).map((component) => ({ component }));
      const visible = entries
        .map((entry, index) => ({ entry, index }))
        .filter(
          ({ entry }) =>
            typeof entry.visible !== "function" ||
            entry.visible({
              width: mappingWidth ?? geometry.columns,
              height: Number.MAX_SAFE_INTEGER,
            }),
        );
      const width = mappingWidth ?? geometry.columns;
      const contentWidth =
        kind === "Box"
          ? Math.max(1, width - padding(target).x * 2)
          : kind === "ScrollView"
            ? Number(callComponentMethod(target, "getContentWidth", width))
            : width;
      const widths =
        kind === "HStack"
          ? runtime.stack.allocateStackSizes(
              visible.map(({ entry }) => entry),
              visible.map(({ entry }) => {
                const child = entry.component;
                if (!component(child))
                  throw new Error("Pi container child is unavailable");
                return withKeys(() => child.render(contentWidth)).reduce(
                  (max, line) => Math.max(max, api.visibleWidth(line)),
                  0,
                );
              }),
              contentWidth,
              number(required(target, "gap")),
            )
          : visible.map(() => contentWidth);
      const intrinsicHeights =
        kind === "VStack"
          ? visible.map(({ entry }) => {
              const child = entry.component;
              if (!component(child))
                throw new Error("Pi container child is unavailable");
              return withKeys(() => child.render(contentWidth)).length;
            })
          : undefined;
      const heights =
        kind === "VStack"
          ? runtime.stack.allocateStackSizes(
              visible.map(({ entry }) => entry),
              intrinsicHeights!,
              undefined,
              number(required(target, "gap")),
            )
          : undefined;
      if (comparison && heights) {
        let row = 0;
        comparison.children = heights.map((length, child) => {
          if (child) row += number(required(target, "gap"));
          const result = { child, start: row, length };
          row += length;
          return result;
        });
      }
      if (comparison && kind === "ScrollView")
        comparison.children = [
          { child: 0, start: 0, length: comparison.baseline.length },
        ];
      if (comparison && kind === "HStack") {
        const childHeights = visible.map(({ entry }, child) =>
          widths[child] > 0
            ? withKeys(() =>
                (entry.component as Component).render(widths[child]),
              ).length
            : 0,
        );
        const height = Math.max(0, ...childHeights);
        let column = 0;
        comparison.children = widths.map((columns, child) => {
          const align = state(target, "align");
          const contentRow =
            align === "center"
              ? Math.floor((height - childHeights[child]) / 2)
              : align === "end"
                ? height - childHeights[child]
                : 0;
          const range = {
            child,
            start: 0,
            length: height,
            column,
            columns,
            contentRow,
          };
          column += columns + number(required(target, "gap"));
          return range;
        });
      }
      const presented = visible.map((item, index) => ({
        ...item,
        width: widths[index],
        collapsed: widths[index] === 0 || heights?.[index] === 0,
      }));
      const mapped = presented.map(
        ({ entry, index, width, collapsed }): DesktopNode => {
          if (!component(entry.component))
            throw new Error("Pi container child is unavailable");
          if (collapsed) return { kind: "spacer", lines: 0 };
          return map(
            entry.component,
            next,
            `${occurrence}/${index}`,
            occurrence,
            width,
            captureFrame || !!comparison,
          );
        },
      );
      if (kind === "ScrollView") {
        const scrollbar = state(target, "scrollbar");
        const scrollbarActive = state(target, "isScrollbarActive") === true;
        return {
          kind: "scroll",
          action,
          children: mapped,
          scrollTop: number(state(target, "scrollTop")),
          followEnd: state(target, "isFollowingEnd") === true,
          overscroll:
            state(target, "overscroll") === "contain" ? "contain" : "auto",
          scrollbar:
            scrollbar === "always" || scrollbar === "hidden"
              ? scrollbar
              : "auto",
          scrollbarVisible: state(target, "isScrollbarVisible") === true,
          scrollbarActive,
          scrollbarColors: {
            thumb: componentTextStyle(
              String(
                callComponentMethod(
                  target,
                  "scrollbarThumbStyle",
                  scrollbarActive ? "█" : "┃",
                ),
              ),
              runtime.text,
            )?.color,
            track: componentTextStyle(
              String(callComponentMethod(target, "scrollbarTrackStyle", "│")),
              runtime.text,
            )?.color,
          },
        };
      }
      return {
        kind: kind === "HStack" ? "row" : "column",
        children: mapped,
        ...(kind === "Box"
          ? {
              padding: padding(target),
              ...(state(target, "bgFn")
                ? {
                    style: componentBackground(
                      state(target, "bgFn"),
                      runtime.text,
                    ),
                  }
                : {}),
            }
          : {}),
        ...(kind === "HStack" || kind === "VStack"
          ? {
              gap: number(required(target, "gap")),
              align: string(required(target, "align")) as
                "stretch" | "start" | "center" | "end",
              sizes: presented.map(({ entry, collapsed }) =>
                collapsed
                  ? { basis: 0, grow: 0, shrink: 0, min: 0, max: 0 }
                  : {
                      basis:
                        typeof entry.basis === "number"
                          ? entry.basis
                          : ("auto" as const),
                      grow: number(entry.grow),
                      shrink: number(entry.shrink, 1),
                      min:
                        typeof entry.minSize === "number"
                          ? entry.minSize
                          : undefined,
                      max:
                        typeof entry.maxSize === "number"
                          ? entry.maxSize
                          : undefined,
                    },
              ),
            }
          : {}),
      };
    }
    if (kind === "MouseRegion") {
      const child = required(target, "child");
      if (!component(child))
        throw new Error("Pi MouseRegion child is unavailable");
      return {
        kind: "region",
        action,
        child: map(
          child,
          next,
          `${occurrence}/0`,
          occurrence,
          mappingWidth,
          captureFrame || !!comparison,
        ),
        nativeControls: true,
      };
    }
    if (kind === "Spacer")
      return { kind: "spacer", lines: number(required(target, "lines")) };
    if (kind === "Input" || kind === "Editor" || kind === "CustomEditor") {
      const value = getText(target);
      const revision = textRevision(target);
      const range = storedRange(target) ?? cursor(target);
      const rangeState = selectionState(target);
      const promptPresentation = componentLabel(
        string(state(target, "prompt")),
        runtime.text,
      );
      const prompt = promptPresentation.label.trim();
      const owner = owners.get(target);
      const label =
        owner && classify(owner) === "SettingsList"
          ? "搜索"
          : prompt && prompt !== ">"
            ? prompt
            : slot === "editor"
              ? "消息"
              : kind === "Input"
                ? "输入"
                : "编辑内容";
      const suggestions =
        kind !== "Input" ? state(target, "autocompleteList") : undefined;
      if (component(suggestions)) owners.set(suggestions, target);
      const placeholder = string(state(target, "placeholder"));
      const placeholderStyler = state(target, "placeholderStyle");
      const placeholderPresentation = componentText(
        typeof placeholderStyler === "function"
          ? Reflect.apply(placeholderStyler, target, [placeholder])
          : placeholder,
        runtime.text,
      );
      const border = state(target, "borderColor");
      return {
        kind: "column",
        children: [
          {
            kind: kind === "Input" ? "input" : "textarea",
            action,
            label,
            desktopLabel: label !== prompt,
            ...(label === prompt && promptPresentation.labelRuns
              ? { labelRuns: promptPresentation.labelRuns }
              : {}),
            value,
            revision,
            controlVersion: controlState(target).version,
            paddingX:
              kind !== "Input"
                ? number(callComponentMethod(target, "getPaddingX"))
                : undefined,
            placeholder: placeholderPresentation.text,
            placeholderRuns: placeholderPresentation.runs,
            placeholderStyle: placeholderPresentation.runs?.find((run) =>
              run.text.trim(),
            )?.style,
            borderColor:
              typeof border === "function"
                ? componentTextStyle(
                    Reflect.apply(border, target, [
                      "\u2500".repeat(
                        Math.max(1, mappingWidth ?? geometry.columns),
                      ),
                    ]),
                    runtime.text,
                  )?.color
                : undefined,
            selectionAction: `${action}:selection`,
            completionAction:
              kind !== "Input" ? `${action}:completion` : undefined,
            pasteAction: kind !== "Input" ? `${action}:paste` : undefined,
            pastes: kind !== "Input" ? componentPasteSpans(target) : undefined,
            selection: { ...range, revision: rangeState.revision, text: value },
          },
          ...(component(suggestions)
            ? [map(suggestions, next, `${occurrence}/completion`, occurrence)]
            : []),
          ...(target.onSubmit && slot !== "editor"
            ? [
                {
                  kind: "button" as const,
                  action: `${action}:submit`,
                  label: "确认",
                  desktopLabel: true,
                  icon: "check",
                  disabled: state(target, "disableSubmit") === true,
                },
              ]
            : []),
        ],
      };
    }
    if (kind === "SelectList") {
      const items = objects(required(target, "filteredItems"));
      const selected = target.getSelectedItem?.();
      const listTheme = required(target, "theme") as object;
      const selectedText = (value: string) =>
        callComponentMethod(listTheme, "selectedText", value) as string;
      const visibleRange = callComponentMethod(target, "getVisibleRange") as {
        startIndex: number;
        endIndex: number;
      };
      const owner = owners.get(target);
      const completionOwner =
        owner && ["Editor", "CustomEditor"].includes(classify(owner) ?? "")
          ? owner
          : undefined;
      return {
        kind: "column",
        children: [
          {
            kind: "select",
            action,
            appearance: completionOwner ? "completion" : undefined,
            submitAction: completionOwner
              ? `${id(completionOwner)}:completion`
              : undefined,
            label: "选择",
            desktopLabel: true,
            value: selected?.value ?? "",
            visibleOptions:
              completionOwner || hasMouse(target, ancestors)
                ? Math.max(
                    2,
                    Math.min(12, number(state(target, "maxVisible"), 5)),
                  )
                : undefined,
            options: items.map((item) => {
              const layout = required(target, "layout") as object;
              let value = string(
                callComponentMethod(target, "getDisplayValue", item),
              );
              if (typeof state(layout, "truncatePrimary") === "function") {
                const width = mappingWidth ?? geometry.columns;
                const column = Math.max(
                  1,
                  Math.min(
                    number(
                      callComponentMethod(target, "getPrimaryColumnWidth"),
                    ),
                    width - 6,
                  ),
                );
                const separateDescription =
                  !!item.description && width > 40 && width - column - 4 > 10;
                const columnWidth = separateDescription
                  ? column
                  : Math.max(1, width - 4);
                value = string(
                  callComponentMethod(
                    target,
                    "truncatePrimary",
                    item,
                    item.value === selected?.value,
                    Math.max(1, columnWidth - (separateDescription ? 2 : 0)),
                    columnWidth,
                  ),
                );
              }
              const styled = componentText(
                item.value === selected?.value ? selectedText(value) : value,
                runtime.text,
              );
              return {
                value: string(item.value),
                label: styled.text,
                runs: styled.runs,
                style: styled.runs?.find((run) => run.text.trim())?.style,
              };
            }),
          },
          ...(!items.length
            ? [
                {
                  kind: "text" as const,
                  ...componentText(
                    string(
                      callComponentMethod(
                        listTheme,
                        "noMatch",
                        "  No matching commands",
                      ),
                    ),
                    runtime.text,
                  ),
                },
              ]
            : []),
          ...items
            .filter(
              (item) => item.value === selected?.value && item.description,
            )
            .map((item) => ({
              kind: "text" as const,
              ...componentText(
                selectedText(string(item.description)),
                runtime.text,
              ),
            })),
          ...(!completionOwner &&
          items.length &&
          (visibleRange.startIndex > 0 || visibleRange.endIndex < items.length)
            ? [
                {
                  kind: "text" as const,
                  ...componentText(
                    string(
                      callComponentMethod(
                        listTheme,
                        "scrollInfo",
                        `  (${number(required(target, "selectedIndex")) + 1}/${items.length})`,
                      ),
                    ),
                    runtime.text,
                  ),
                },
              ]
            : []),
          ...(!completionOwner
            ? [
                {
                  kind: "button" as const,
                  action: `${action}:submit`,
                  label: "确认",
                  desktopLabel: true,
                  icon: "check",
                  disabled: !items.length,
                },
              ]
            : []),
          ...(typeof state(target, "onCancel") === "function"
            ? [
                {
                  kind: "button" as const,
                  action: `${action}:cancel`,
                  label: "取消",
                  desktopLabel: true,
                  icon: "close",
                },
              ]
            : []),
        ],
      };
    }
    if (kind === "SettingsList") {
      const submenu = state(target, "submenuComponent");
      if (component(submenu)) {
        owners.set(submenu, target);
        return {
          kind: "column",
          children: [map(submenu, next, `${occurrence}/submenu`, occurrence)],
        };
      }
      const search = state(target, "searchInput");
      if (component(search)) {
        id(search);
        track(search);
        owners.set(search, target);
      }
      const settingTheme = required(target, "theme") as object;
      const settingItems = objects(
        callComponentMethod(target, "getDisplayItems"),
      );
      const selectedIndex = number(required(target, "selectedIndex"));
      const settingDescription = settingItems[selectedIndex]?.description;
      return {
        kind: "column",
        children: [
          ...(component(search)
            ? [map(search, next, `${occurrence}/search`, occurrence)]
            : []),
          ...settingItems.map((item, index) => {
            const itemAction = `${action}:setting:${encodeURIComponent(string(item.id))}`;
            const values = Array.isArray(item.values)
              ? item.values.filter(
                  (value): value is string => typeof value === "string",
                )
              : [];
            const isSelected = index === selectedIndex;
            const label = string(
              callComponentMethod(
                settingTheme,
                "label",
                string(item.label),
                isSelected,
              ),
            );
            const value = (text: string) =>
              string(
                callComponentMethod(settingTheme, "value", text, isSelected),
              );
            const combined = componentLabel(
              `${label}: ${value(string(item.currentValue))}`,
              runtime.text,
            );
            const labelPrefix = isSelected
              ? componentText(
                  string(required(settingTheme, "cursor")),
                  runtime.text,
                )
              : undefined;
            return hasMouse(target, ancestors) &&
              (typeof item.submenu === "function" || values.length)
              ? {
                  kind: "button" as const,
                  action: itemAction,
                  ...combined,
                  labelPrefix,
                  mouseControl: "setting" as const,
                }
              : typeof item.submenu === "function"
                ? {
                    kind: "button" as const,
                    action: itemAction,
                    ...componentLabel(label, runtime.text),
                    labelPrefix,
                  }
                : values.length
                  ? {
                      kind: "select" as const,
                      action: itemAction,
                      ...componentLabel(label, runtime.text),
                      labelPrefix,
                      value: string(item.currentValue),
                      options: values.map((raw) => {
                        const styled = componentText(value(raw), runtime.text);
                        return {
                          value: raw,
                          label: styled.text,
                          runs: styled.runs,
                          style: styled.runs?.find((run) => run.text.trim())
                            ?.style,
                        };
                      }),
                    }
                  : {
                      kind: "text" as const,
                      ...componentText(
                        `${label}: ${value(string(item.currentValue))}`,
                        runtime.text,
                      ),
                    };
          }),
          ...(typeof settingDescription === "string"
            ? [
                {
                  kind: "text" as const,
                  ...componentText(
                    string(
                      callComponentMethod(
                        settingTheme,
                        "description",
                        settingDescription,
                      ),
                    ),
                    runtime.text,
                  ),
                },
              ]
            : []),
          ...(!settingItems.length
            ? [
                {
                  kind: "text" as const,
                  ...componentText(
                    string(
                      callComponentMethod(
                        settingTheme,
                        "hint",
                        settingItems.length === 0 &&
                          !objects(required(target, "items")).length
                          ? "  No settings available"
                          : "  No matching settings",
                      ),
                    ),
                    runtime.text,
                  ),
                },
              ]
            : []),
          {
            kind: "button",
            action: `${action}:cancel`,
            label: "关闭",
            desktopLabel: true,
            icon: "close",
          },
        ],
      };
    }
    if (kind === "CancellableLoader" || kind === "Loader") {
      const message = string(
        callComponentMethod(
          target,
          "messageColorFn",
          string(required(target, "message")),
        ),
      );
      const indicator = componentText(
        string(callComponentMethod(target, "getRenderedIndicator")),
        runtime.text,
      );
      return {
        kind: "column",
        children: [
          {
            kind: "progress",
            ...componentLabel(message, runtime.text),
            indicatorColor: indicator.runs?.find((run) => run.text.trim())
              ?.style?.color,
            indicator: state(target, "renderIndicatorVerbatim")
              ? indicator
              : undefined,
          },
          ...(kind === "CancellableLoader"
            ? [
                {
                  kind: "button" as const,
                  action: `${action}:cancel`,
                  label: "取消",
                  desktopLabel: true,
                  icon: "close",
                },
              ]
            : []),
        ],
      };
    }
    if (kind === "Image") {
      const options = state(target, "options");
      const option = (key: string) =>
        options && typeof options === "object"
          ? state(options, key)
          : undefined;
      const dimensions = required(target, "dimensions") as {
        widthPx: number;
        heightPx: number;
      };
      const ratio =
        Math.max(1, number(dimensions.widthPx, 800)) /
        Math.max(1, number(dimensions.heightPx, 600));
      // Use the desktop viewport's logical cell units for Pi's size constraints.
      const maxWidth =
        Math.max(
          1,
          Math.min(
            (mappingWidth ?? geometry.columns) - 2,
            number(option("maxWidthCells"), 60),
          ),
        ) * 8;
      const maxHeight =
        Math.max(
          1,
          number(option("maxHeightCells"), Math.ceil(maxWidth / 20)),
        ) * 20;
      const filename = string(option("filename"));
      const mimeType = string(required(target, "mimeType"));
      const theme = required(target, "theme") as object;
      const fallbackColor = required(theme, "fallbackColor") as (
        text: string,
      ) => string;
      const fallback = Reflect.apply(fallbackColor, theme, [
        runtime.image.imageFallback(mimeType, dimensions, filename),
      ]);
      return {
        kind: "image",
        src: `data:${mimeType};base64,${string(required(target, "base64Data"))}`,
        alt: filename || "图片",
        desktopLabel: !filename,
        width: Math.min(maxWidth, maxHeight * ratio),
        aspectRatio: ratio,
        fallback: componentText(fallback, runtime.text),
      };
    }
    if (kind === "VisualLinePreview" || kind === "FooterComponent")
      return {
        kind: "text",
        ...componentText(
          withKeys(() => target.render(mappingWidth ?? geometry.columns)).join(
            "\n",
          ),
          runtime.text,
        ),
      };
    let text = string(required(target, "text"));
    if (kind === "TruncatedText") text = text.split("\n")[0];
    let presentation;
    let markdown;
    if (kind === "Markdown") {
      markdown = withKeys(() =>
        componentMarkdown(
          target,
          mappingWidth ?? geometry.columns,
          runtime.text,
        ),
      );
      const defaults = state(target, "defaultTextStyle");
      presentation = {
        ...componentText(
          `${callComponentMethod(target, "getDefaultStylePrefix")}x`,
          runtime.text,
        ).runs?.[0]?.style,
        ...componentBackground(
          defaults && typeof defaults === "object"
            ? state(defaults, "bgColor")
            : undefined,
          runtime.text,
        ),
      };
    } else {
      text = text.replace(/\t/g, "   ");
      presentation = componentBackground(
        state(target, "customBgFn"),
        runtime.text,
      );
    }
    return {
      kind: kind === "Markdown" ? "markdown" : "text",
      ...(markdown ?? componentText(text, runtime.text)),
      ...(presentation && Object.keys(presentation).length
        ? { style: presentation }
        : {}),
      padding: padding(target),
      truncate: kind === "TruncatedText",
    };
  };
  const mapTree = (
    target: Component,
    width = surfaceWidth ?? geometry.columns,
    rootKey = id(target),
  ) => {
    const previous = mappingRoot;
    const previousWidth = mappingWidth;
    mappingRoot = target;
    mappingWidth = width;
    for (const [frame, owner] of terminalFrames)
      if (owner === target) terminalFrames.delete(frame);
    for (const key of occurrences.keys())
      if (key === rootKey || key.startsWith(`${rootKey}/`))
        occurrences.delete(key);
    try {
      return map(target, new Set(), rootKey);
    } finally {
      mappingRoot = previous;
      mappingWidth = previousWidth;
    }
  };
  const renderSource = (source: DesktopRenderSource) => {
    if (source.nativeToolRow)
      return withKeys(() =>
        sharedRuntime.factory(runtimeEndpoint, () =>
          source.nativeToolRow!.phase(source),
        ),
      );
    const renderContext = {
      ...source.context,
      tui: publicTui,
      lastComponent: rendererComponent,
      invalidate: () => {
        if (stopped) return;
        if (source.context.toolCallId) {
          sdk.desktop.invalidateToolRenderers(source.context.toolCallId);
          return;
        }
        rendererDirty = true;
        invalidate();
      },
    };
    return withKeys(() => {
      if (source.kind === "toolCall" || source.kind === "toolResult") {
        const renderer = source.renderer;
        try {
          const next =
            source.kind === "toolCall"
              ? renderer(source.value, theme, renderContext)
              : renderer(
                  source.value,
                  {
                    expanded: source.context.expanded,
                    isPartial: source.context.isPartial,
                  },
                  theme,
                  renderContext,
                );
          if (!component(next))
            throw new Error("Renderer did not return a Pi component");
          rendererComponent = next;
          return next;
        } catch {
          rendererComponent = undefined;
          return (
            createToolFallback(source) ?? new (Reflect.get(api, "Spacer"))(0)
          );
        }
      }
      const markdownTheme = {
        ...runtime.markdown.getMarkdownTheme(),
        codeBlockIndent:
          source.context.codeBlockIndent ??
          sdk.settingsManager.getCodeBlockIndent(),
      };
      if (!transcriptRenderer) {
        transcriptRenderer =
          source.kind === "message"
            ? new runtime.transcript.CustomMessageComponent(
                source.value as ConstructorParameters<
                  typeof runtime.transcript.CustomMessageComponent
                >[0],
                source.renderer as ConstructorParameters<
                  typeof runtime.transcript.CustomMessageComponent
                >[1],
                markdownTheme,
                source.context.outputPad ?? sdk.settingsManager.getOutputPad(),
              )
            : new runtime.transcript.CustomEntryComponent(
                source.value,
                source.renderer,
              );
        callComponentMethod(
          transcriptRenderer,
          "setExpanded",
          source.context.expanded,
        );
      } else {
        setComponentField(
          transcriptRenderer,
          source.kind === "message" ? "message" : "entry",
          source.value,
        );
        setComponentField(
          transcriptRenderer,
          source.kind === "message" ? "customRenderer" : "renderer",
          source.renderer,
        );
        setComponentField(
          transcriptRenderer,
          "_expanded",
          source.context.expanded,
        );
        if (source.kind === "message") {
          setComponentField(
            transcriptRenderer,
            "outputPad",
            source.context.outputPad ?? sdk.settingsManager.getOutputPad(),
          );
          setComponentField(transcriptRenderer, "markdownTheme", markdownTheme);
        }
        callComponentMethod(transcriptRenderer, "rebuild");
      }
      return transcriptRenderer;
    });
  };
  const updateSource = (source: DesktopRenderSource) => {
    renderSourceValue = source;
    rendererDirty = false;
    let next = renderSource(source);
    if (!component(next))
      throw new Error("Renderer did not return a Pi component");
    if (
      (source.kind === "toolCall" || source.kind === "toolResult") &&
      source.context.toolCallId &&
      !source.nativeToolRow
    ) {
      if (!toolRegion) {
        const session = sdk.session;
        toolRegion = createToolResultRegion(next, source, (expanded) => {
          if (stopped || sdk.host.runtime?.session !== session) return;
          sdk.host.setToolExpanded(source.context.toolCallId!, expanded);
        });
      } else toolRegion.update(next, source);
      next = toolRegion.component;
    }
    if (next !== root) focused = undefined;
    root = next;
    if (!context.terminalRegion && !context.runtimeOverlay)
      sharedRuntime.root(
        runtimeEndpoint,
        next,
        slot,
        source.nativeToolRow?.original,
      );
  };
  let lastView: DesktopNode | undefined;
  let lastHeight = 0;
  const baseRoots = () => [...tui.children, ...(root ? [root] : [])];
  const renderBase = (width: number) => {
    rememberRegistered();
    try {
      return withKeys(
        () => tui.render(width).length + root!.render(width).length,
      );
    } finally {
      cleanupStep(() => rememberRegistered());
    }
  };
  const refresh = (): DesktopNode => {
    if (!sharedRuntime.visible(runtimeEndpoint))
      return { kind: "spacer", lines: 0 };
    if (paused)
      return { ...(lastView ?? { kind: "spacer", lines: 0 }), inert: true };
    if (rendererDirty && renderSourceValue) updateSource(renderSourceValue);
    if (!root) throw new Error("Pi component is unavailable");
    syncFooter();
    // Run original layout/state hooks, but never display its terminal output.
    lastHeight = renderBase(surfaceWidth ?? geometry.columns);
    controls.clear();
    occurrences.clear();
    terminalFrames.clear();
    const registered = tui.children.map((child, index) =>
      mapTree(child, undefined, `${id(child)}/tui:${index}`),
    );
    const hosted = mapTree(root, undefined, `${id(root)}/hosted`);
    const view: DesktopNode = registered.length
      ? { kind: "column", children: [...registered, hosted] }
      : hosted;
    for (const overlay of overlays) {
      if (overlay.detached) continue;
      const width = overlay.desktop?.getBounds()?.width ?? geometry.columns;
      withKeys(() => overlay.component.render(width));
      mapTree(overlay.component, width);
    }
    release(rememberOwned());
    lastView = view;
    return paused ? { ...view, inert: true } : view;
  };
  const showOverlay = tui.showOverlay.bind(tui);
  tui.showOverlay = (target, options) => {
    if (stopped) throw new Error("Pi component is no longer active");
    const overlay: MappedOverlay = {
      component: target,
      native: showOverlay(target, options),
    };
    overlays.add(overlay);
    let overlayView: DesktopNode | undefined;
    let overlayHeight = 0;
    try {
      overlay.desktop = context.showOverlay(
        {
          handlesTerminalInput: true,
          acceptsInput: () => !paused && !stopped,
          view: () => {
            if (paused)
              return {
                ...(overlayView ?? { kind: "spacer", lines: 0 }),
                inert: true,
              };
            const width =
              overlay.desktop?.getBounds()?.width ?? geometry.columns;
            overlayHeight = withKeys(() =>
              overlay.component.render(width),
            ).length;
            overlayView = mapTree(overlay.component, width);
            return paused ? { ...overlayView, inert: true } : overlayView;
          },
          getOverlayHeight: (width) =>
            paused
              ? overlayHeight
              : (overlayHeight = withKeys(
                  () => overlay.component.render(width).length,
                )),
          focusTarget: target,
          getFocusRequest: () => focusRequest(overlay.component),
          focus: () => overlay.native.focus(),
          focusControl: focusMappedControl,
          overlayState: () => ({
            hidden: overlay.native.isHidden(),
            focused: overlay.native.isFocused(),
          }),
          handleAction,
          handleMouse,
          cancelMouse: (pointerId) => mouse.cancel(pointerId),
          handleInput: (data, event, input) => {
            const target =
              focused && inputOwners.get(focused) === overlay.component
                ? focused
                : overlay.component.handleInput
                  ? overlay.component
                  : [...controls.values()].find(
                      (item) =>
                        inputOwners.get(item) === overlay.component &&
                        item.handleInput,
                    );
            return handleInput(data, event, {
              ...input,
              controlAction:
                input?.controlAction ?? (target ? id(target) : undefined),
            });
          },
          dispose: () => {
            overlay.native.hide();
            overlays.delete(overlay);
            invalidate();
          },
        },
        options,
      );
    } catch (error) {
      overlay.native.hide();
      overlays.delete(overlay);
      throw error;
    }
    const desktop = overlay.desktop;
    return {
      hide: () => hideMappedOverlay(overlay),
      setHidden: (hidden) => {
        overlay.native.setHidden(hidden);
        desktop.setHidden(hidden);
      },
      isHidden: () => overlay.native.isHidden(),
      focus: () => desktop.focus(),
      unfocus: (value) => {
        overlay.native.unfocus(value);
        invalidate();
      },
      isFocused: () => overlay.native.isFocused(),
      getBounds: () => desktop.getBounds(),
    };
  };
  tui.hideOverlay = () =>
    hideMappedOverlay(
      [...overlays].reverse().find((overlay) => !overlay.detached),
    );
  const runtimeEndpoint: TerminalRuntimeEndpoint = {
    owns: (target) =>
      disposal.has(target) || claimedFocus.has(target) || target === root,
    claim: (target) => {
      claimedFocus.add(target);
    },
    retained: () => rememberOwned(),
    focus: (target, revision, explicit) => {
      if (stopped) return;
      setFocus(target);
      focused = componentFocus(tui);
      focusRevision = revision;
      requestedFocus = explicit ? target : undefined;
    },
    pause: (value) => {
      paused = value;
      mouse.clear();
    },
    invalidate: () => tui.invalidate(),
    refresh: () => {
      if (!stopped && root) refresh();
    },
    remember: () => {
      if (!stopped && root) rememberOwned();
    },
    input: (data, event) =>
      handleInput(data, event, { raw: true, terminalFiltered: true }),
  };
  releaseRuntime = sharedRuntime.attach(runtimeEndpoint);
  signal.addEventListener("abort", cleanup, { once: true });
  if (signal.aborted) cleanup();
  try {
    if (stopped) throw new Error("Pi component is no longer active");
    const source = context.source;
    let result: unknown;
    if (component(source)) result = source;
    else if (typeof source === "function")
      result = await sharedRuntime.factory(runtimeEndpoint, () =>
        withKeys(() =>
          slot === "footer"
            ? source(publicTui, theme, footer)
            : slot === "editor"
              ? source(publicTui, editorTheme, keys)
              : slot === "dialog"
                ? source(publicTui, theme, keys, done)
                : source(publicTui, theme),
        ),
      );
    else {
      updateSource(source as DesktopRenderSource);
      result = root;
    }
    if (!component(result))
      throw new Error(
        "Pi TUI factory did not return a Pi component (桌面组件映射)",
      );
    root = result;
    if (context.customOptions?.overlay && !rootOverlay) {
      const options = context.customOptions.overlayOptions;
      rootOverlay = sharedRuntime.installOverlay(
        root,
        typeof options === "function" ? options() : options,
      );
    }
    if (!context.terminalRegion && !rootOverlay)
      sharedRuntime.root(
        runtimeEndpoint,
        root,
        slot,
        typeof source === "object" && !component(source)
          ? (source as DesktopRenderSource).nativeToolRow?.original
          : undefined,
      );
    // Ownership starts before any original render/setup hook can fail. A
    // factory may resolve after its surface has already been retired.
    rememberOwned();
    if (
      !stopped &&
      (slot === "dialog" || slot === "editor") &&
      !rootOverlay &&
      (!sharedRuntime.target || !runtimeEndpoint.owns(sharedRuntime.target))
    )
      sharedRuntime.focus(root);
    if (stopped) {
      release();
      return {
        view: () => ({ kind: "text", text: "" }),
        handleAction: () => {},
      };
    }
    if (!component(source) && typeof source !== "function")
      renderSourceValue = source as DesktopRenderSource;
    if (slot === "editor") {
      if (!root.getText || !root.setText)
        throw new Error("Pi editor must expose getText() and setText()");
      root.onSubmit ??= (text) =>
        sdk.host.emitEvent({
          type: "activity",
          name: "desktop_editor_submit",
          data: text,
        });
      if (root instanceof sdk.sdk.CustomEditor)
        configureCustomEditor(root, sdk, () => storedRange(root!));
      if (["Editor", "CustomEditor"].includes(classify(root) ?? "")) {
        for (const message of options.initializeHistory === false
          ? []
          : sdk.session.messages)
          if (message.role === "user")
            root.addToHistory?.(
              typeof message.content === "string"
                ? message.content
                : message.content
                    .filter((block) => block.type === "text")
                    .map((block) => block.text)
                    .join("\n"),
            );
        if (!state(root, "autocompleteProvider"))
          callComponentMethod(
            root,
            "setAutocompleteProvider",
            sdk.host.autocompleteProvider,
          );
      }
    }
    refresh();
  } catch (error) {
    cleanup();
    throw error;
  }
  const controller: DesktopComponent = {
    get original() {
      return root;
    },
    terminalOverlay: rootOverlay,
    handlesTerminalInput: true,
    acceptsInput: () => !paused && !stopped,
    view: refresh,
    invalidate: () => {
      if (renderSourceValue && !transcriptRenderer) rendererDirty = true;
      tui.invalidate();
    },
    invalidateRenderer: () => {
      if (stopped) return;
      rendererDirty = !transcriptRenderer;
      tui.invalidate();
    },
    getOverlayHeight: (width) => {
      surfaceWidth = width;
      return paused ? lastHeight : (lastHeight = renderBase(width));
    },
    focusTarget: root,
    focus: () =>
      rootOverlay ? rootOverlay.focus() : setMappedFocus(root ?? null),
    focusControl: focusMappedControl,
    overlayState: rootOverlay
      ? () => ({
          hidden: rootOverlay!.isHidden(),
          focused: rootOverlay!.isFocused(),
        })
      : undefined,
    getFocusRequest: () => focusRequest(baseRoots()),
    getText: root.getText ? () => root!.getText!() : undefined,
    getExpandedText: root.getExpandedText
      ? () => root!.getExpandedText!()
      : undefined,
    expandText: root.getExpandedText
      ? (text) =>
          text === getText(root!)
            ? root!.getExpandedText!()
            : string(callComponentMethod(root!, "expandPasteMarkers", text))
      : undefined,
    setText: root.setText
      ? (text) => {
          root!.setText!(text);
          rememberRange(root!, cursor(root!));
        }
      : undefined,
    getSelection: root.getText
      ? () => storedRange(root!) ?? cursor(root!)
      : undefined,
    setSelection: root.getText ? (range) => position(root!, range) : undefined,
    addToHistory: root.addToHistory
      ? (text) => root!.addToHistory!(text)
      : undefined,
    setAutocompleteProvider:
      typeof state(root, "setAutocompleteProvider") === "function"
        ? (provider) =>
            callComponentMethod(root!, "setAutocompleteProvider", provider)
        : undefined,
    pasteText: root.getText
      ? (text) => {
          const range = storedRange(root!) ?? cursor(root!);
          position(root!, range);
          const paste = () => {
            position(root!, { start: range.start, end: range.start });
            execute(root!, `\x1b[200~${text}\x1b[201~`);
          };
          if (range.start !== range.end)
            editText(
              root!,
              getText(root!).slice(0, range.start) +
                getText(root!).slice(range.end),
              paste,
            );
          else paste();
          rememberRange(root!, cursor(root!));
        }
      : undefined,
    handleAction,
    handleMouse,
    cancelMouse: (pointerId) => mouse.cancel(pointerId),
    cancelInput: () => {
      if (stopped || paused) return;
      const target = focused ?? root;
      if (!target) return;
      const owner = inputOwners.get(target);
      execute(
        owner?.handleInput ? owner : (owners.get(target) ?? target),
        cancel(),
      );
    },
    handleInput,
    update: (source) => {
      if (paused) {
        renderSourceValue = source;
        rendererDirty = true;
        return;
      }
      updateSource(source);
      refresh();
    },
    dispose: () => {
      signal.removeEventListener("abort", cleanup);
      cleanup();
    },
  };
  function focusMappedControl(action: string) {
    const target = controls.get(action);
    if (!target || stopped || paused) return false;
    // A browser notification names its actual leaf. Focusing the overlay root
    // first would arm Pi's blocked-focus restoration and alter the next SDK
    // setFocus call. Keep native overlay-handle activation separate.
    sharedRuntime.focus(target, false, true);
    return true;
  }
  function handleAction(event: DesktopUIAction) {
    return controlOperation(actionControl(event.action), () =>
      applyAction(event),
    );
  }
  function applyAction({ action, value }: DesktopUIAction) {
    if (paused || stopped) return;
    const match =
      /^(component:\d+)(?::(selection|submit|cancel|completion|paste|setting|layout|scrollbar)(?::(.*))?)?$/.exec(
        action,
      );
    const target = match && controls.get(match[1]);
    if (!target) throw new Error("Pi component is no longer active");
    const operation = match![2],
      setting = match![3];
    const kind = classify(target);
    if (
      value &&
      typeof value === "object" &&
      state(value, "effect") !== undefined
    ) {
      if (!terminalFrames.has(target))
        throw new Error("Terminal component is no longer active");
      const effect = parseTerminalEffect(state(value, "effect"));
      const effects = terminalEffects.get(target);
      const sequence = state(value, "sequence"),
        index = state(value, "index");
      if (
        !Number.isSafeInteger(sequence) ||
        !Number.isSafeInteger(index) ||
        Number(index) < 1
      )
        throw new Error("Invalid terminal effect delivery");
      if (
        !effects ||
        sequence !== effects.sequence ||
        Number(index) <= effects.index
      )
        return;
      effects.index = Number(index);
      if (effect.type === "progress") windowProgress = effect.active;
      return sdk.host.applyTerminalEffect(effect, windowOwner);
    }
    if (
      (target.getText || target.getValue) &&
      value &&
      typeof value === "object" &&
      typeof state(value, "controlVersion") === "number" &&
      state(value, "controlVersion") !== controlState(target).version
    )
      return;
    if (
      !operation &&
      value &&
      typeof value === "object" &&
      typeof state(value, "text") === "string"
    )
      value = state(value, "text");
    if (
      !kind &&
      value &&
      typeof value === "object" &&
      typeof state(value, "data") === "string"
    ) {
      handleInput(String(state(value, "data")), undefined, {
        controlAction: match![1],
        raw: true,
      });
      return;
    }
    if (kind === "ScrollView") {
      if (operation === "scrollbar" && typeof value === "boolean") {
        callComponentMethod(target, "setScrollbarActive", value);
      } else if (operation === "layout" && value && typeof value === "object") {
        target.updateLayout?.(
          number(state(value, "contentHeight")),
          number(state(value, "viewportHeight")),
          invalidate,
        );
      } else if (typeof value === "number") target.scrollTo?.(value);
    } else if (kind === "MouseRegion" && value && typeof value === "object") {
      handleMouse(match![1], { ...mouseEvent(value), pointerId: 1 });
      return;
    } else if (
      operation === "selection" &&
      value &&
      typeof value === "object"
    ) {
      if (
        typeof state(value, "text") === "string" &&
        state(value, "text") !== getText(target)
      )
        return;
      position(
        target,
        {
          start: number(state(value, "start")),
          end: number(state(value, "end")),
        },
        false,
      );
    } else if (operation === "paste" && value && typeof value === "object") {
      if (!["Editor", "CustomEditor"].includes(kind ?? "")) return;
      const paste = componentPasteSpans(target).find(
        (paste) =>
          paste.start === state(value, "start") &&
          paste.marker === state(value, "marker") &&
          paste.text === state(value, "text"),
      );
      if (!paste) return;
      if (state(value, "command") === "copy")
        return sdk.host
          .action({ action: "clipboard.copy", args: { text: paste.text } })
          .then(() => {});
      if (state(value, "command") === "remove")
        editText(
          target,
          getText(target).slice(0, paste.start) +
            getText(target).slice(paste.end),
          () => {
            position(target, { start: paste.start, end: paste.start });
          },
        );
    } else if (operation === "completion") {
      if (
        ["Editor", "CustomEditor"].includes(kind ?? "") &&
        component(state(target, "autocompleteList"))
      ) {
        // Pending editor input may replace the list before a desktop click runs.
        // Resolve the requested item through the stable editor action.
        const suggestions = state(target, "autocompleteList") as Component;
        if (typeof value === "string") {
          const items = objects(required(suggestions, "filteredItems"));
          const index = items.findIndex((item) => item.value === value);
          if (index < 0) return;
          if (suggestions.getSelectedItem?.()?.value !== value) {
            suggestions.setSelectedIndex?.(index);
            const changed = state(suggestions, "onSelectionChange");
            if (typeof changed === "function")
              Reflect.apply(changed, suggestions, [items[index]]);
          }
        }
        execute(target, keyFor("tui.input.tab", "\t"));
        rememberRange(target, cursor(target));
      }
    } else if (operation === "submit") {
      const owner = owners.get(target);
      if (owner && ["Editor", "CustomEditor"].includes(classify(owner) ?? "")) {
        execute(owner, keyFor("tui.input.tab", "\t"));
        rememberRange(owner, cursor(owner));
      } else
        execute(
          target,
          kind === "Input" || kind === "Editor" || kind === "CustomEditor"
            ? keyFor("tui.input.submit", "\r")
            : confirm(),
        );
    } else if (operation === "cancel")
      execute(owners.get(target) ?? target, cancel());
    else if (operation === "setting" && setting !== undefined) {
      const settingId = decodeURIComponent(setting);
      const item = objects(required(target, "filteredItems")).find(
        (item) => item.id === settingId,
      );
      if (!item) throw new Error("Setting is unavailable");
      target.selectItem?.(settingId);
      if (typeof item.submenu === "function" || value === undefined)
        execute(target, confirm());
      else if (
        typeof value === "string" &&
        Array.isArray(item.values) &&
        item.values.includes(value)
      ) {
        target.updateValue?.(settingId, value);
        callComponentMethod(target, "onChange", settingId, value);
      }
    } else if (kind === "SelectList") {
      const items = objects(required(target, "filteredItems"));
      const index = items.findIndex((item) => item.value === value);
      if (index >= 0 && target.getSelectedItem?.()?.value !== value) {
        target.setSelectedIndex?.(index);
        const changed = state(target, "onSelectionChange");
        if (typeof changed === "function")
          Reflect.apply(changed, target, [items[index]]);
      }
    } else if (typeof value === "string") {
      if (getText(target) !== value) editText(target, value, () => {});
      position(target, { start: value.length, end: value.length });
      const owner = owners.get(target);
      if (owner && classify(owner) === "SettingsList")
        callComponentMethod(owner, "applyFilter", value);
    }
    invalidate();
  }
  function nativeMousePath(
    target: Component,
    destination: Component,
    frame: { x: number; y: number; width: number; height: number },
    visited = new Set<Component>(),
  ): { component: Component; frame: typeof frame }[] | undefined {
    const current = { component: target, frame };
    if (target === destination) return [current];
    if (visited.has(target)) return;
    const next = new Set(visited).add(target);
    const kind = classify(target);
    const children: { component: Component; frame: typeof frame }[] = [];
    if (kind === "MouseRegion") {
      const child = required(target, "child");
      if (component(child)) children.push({ component: child, frame });
    } else if (kind === "SettingsList") {
      const submenu = state(target, "submenuComponent");
      const search = state(target, "searchInput");
      if (component(submenu)) children.push({ component: submenu, frame });
      else if (component(search))
        children.push({ component: search, frame: { ...frame, height: 1 } });
    } else if (kind === "HStack" || kind === "VStack") {
      const entries = objects(required(target, "entries")).filter(
        (entry) =>
          typeof entry.visible !== "function" ||
          entry.visible({
            width: Math.max(1, frame.width),
            height: Number.MAX_SAFE_INTEGER,
          }),
      );
      const gap = number(required(target, "gap"));
      const rendered = entries.map((entry) => {
        const child = entry.component;
        if (!component(child)) throw new Error("Pi stack child is unavailable");
        return withKeys(() => child.render(frame.width));
      });
      const sizes = runtime.stack.allocateStackSizes(
        entries,
        rendered.map((lines) =>
          kind === "HStack"
            ? lines.reduce(
                (width, line) => Math.max(width, api.visibleWidth(line)),
                0,
              )
            : lines.length,
        ),
        kind === "HStack" ? frame.width : undefined,
        gap,
      );
      let offset = 0;
      for (let index = 0; index < entries.length; index++) {
        const child = entries[index].component as Component;
        const width = kind === "HStack" ? sizes[index] : frame.width;
        const naturalHeight =
          width > 0 ? withKeys(() => child.render(width)).length : 0;
        const height =
          kind === "VStack"
            ? sizes[index]
            : state(target, "align") === "stretch"
              ? frame.height
              : Math.min(frame.height, naturalHeight);
        const alignOffset =
          kind === "HStack" && state(target, "align") === "center"
            ? Math.floor((frame.height - height) / 2)
            : kind === "HStack" && state(target, "align") === "end"
              ? frame.height - height
              : 0;
        children.push({
          component: child,
          frame: {
            x: frame.x + (kind === "HStack" ? offset : 0),
            y: frame.y + (kind === "VStack" ? offset : alignOffset),
            width,
            height,
          },
        });
        offset += sizes[index] + gap;
      }
    } else if (kind === "ScrollView") {
      const child = required(target, "child");
      if (component(child)) {
        const width = number(
          callComponentMethod(target, "getContentWidth", frame.width),
          frame.width,
        );
        children.push({
          component: child,
          frame: {
            ...frame,
            y: frame.y - number(state(target, "scrollTop")),
            width,
            height: withKeys(() => child.render(width)).length,
          },
        });
      }
    } else if (kind === "Container" || kind === "Box") {
      const inset = kind === "Box" ? padding(target) : { x: 0, y: 0 };
      const width = Math.max(1, frame.width - inset.x * 2);
      const layout = state(target, "mouseLayout");
      const entries =
        layout && typeof layout === "object" && state(layout, "width") === width
          ? objects(required(layout, "children"))
          : (required(target, "children") as Component[]).map((child) => ({
              component: child,
              height: withKeys(() => child.render(width)).length,
            }));
      let y = frame.y + inset.y;
      for (const entry of entries) {
        const child = entry.component;
        const height = number(entry.height);
        if (component(child))
          children.push({
            component: child,
            frame: { x: frame.x + inset.x, y, width, height },
          });
        y += height;
      }
    }
    for (const child of children) {
      const path = nativeMousePath(
        child.component,
        destination,
        child.frame,
        next,
      );
      if (path) return [current, ...path];
    }
  }
  type MousePath = {
    component: Component;
    frame: { x: number; y: number; width: number; height: number };
  }[];
  function desktopMousePath(
    target: Component,
    input: DesktopMouseEvent,
  ): MousePath | undefined {
    if (!input.hitPath) return;
    if (!input.hitPath.length || input.hitPath.length > 128)
      throw new Error("Invalid desktop component hit path");
    let previous: string | undefined;
    return input.hitPath.map((hit, index) => {
      const occurrence = occurrences.get(hit.occurrence);
      if (
        !occurrence ||
        id(occurrence.target) !== hit.action ||
        (index === 0
          ? occurrence.target !== target
          : occurrence.parent !== previous) ||
        ![hit.x, hit.y, hit.width, hit.height].every(Number.isFinite) ||
        hit.width < 1 ||
        hit.width > 100000 ||
        hit.height < 0 ||
        hit.height > 100000
      )
        throw new Error("Desktop component hit path is no longer available");
      previous = hit.occurrence;
      return {
        component: occurrence.target,
        frame: {
          x: input.x - hit.x,
          y: input.y - hit.y,
          width: Math.ceil(hit.width),
          height: Math.ceil(hit.height),
        },
      };
    });
  }
  function withMousePath<T>(
    path: MousePath | undefined,
    targets: Map<Component, PiMouseTarget> | undefined,
    operation: () => T,
  ): T {
    if (!path || !targets) return operation();
    const restore: (() => void)[] = [];
    try {
      for (let index = 0; index < path.length; index++) {
        const target = path[index].component;
        const original = target.handleMouse;
        if (!original) continue;
        const descriptor = Object.getOwnPropertyDescriptor(
          target,
          "handleMouse",
        );
        const child = path[index + 1]?.component;
        const kind = classify(target);
        const restoreHandler = () => {
          if (descriptor)
            Object.defineProperty(target, "handleMouse", descriptor);
          else Reflect.deleteProperty(target, "handleMouse");
        };
        const wrapper: NonNullable<Component["handleMouse"]> = (event) => {
          const local = runtime.mouse.retargetMouseEvent(
            event,
            targets.get(target)!,
          );
          const layoutDescriptor = Object.getOwnPropertyDescriptor(
            target,
            "mouseLayout",
          );
          const inset = kind === "Box" ? padding(target) : { x: 0, y: 0 };
          const scopedLayout = [
            "Container",
            "Box",
            "HStack",
            "VStack",
            "ScrollView",
          ].includes(kind ?? "")
            ? {
                width: Math.max(1, local.width - inset.x * 2),
                children: child
                  ? [
                      {
                        component: child,
                        height: Math.max(
                          1,
                          local.height,
                          local.y - inset.y + 1,
                        ),
                      },
                    ]
                  : [],
              }
            : undefined;
          let layoutWritten = false;
          let writtenLayout: unknown;
          const scopedLayoutGetter = () => scopedLayout;
          if (scopedLayout)
            Object.defineProperty(target, "mouseLayout", {
              configurable: true,
              get: scopedLayoutGetter,
              set: (value: unknown) => {
                layoutWritten = true;
                writtenLayout = value;
              },
            });
          restoreHandler();
          try {
            // Pi normalizes the original result using this component's actual desktop transform.
            return runtime.mouse.dispatchMouseEvent(target, local);
          } finally {
            if (target.handleMouse === original)
              Object.defineProperty(target, "handleMouse", {
                configurable: true,
                writable: true,
                value: wrapper,
              });
            if (
              scopedLayout &&
              Object.getOwnPropertyDescriptor(target, "mouseLayout")?.get ===
                scopedLayoutGetter
            ) {
              if (layoutDescriptor)
                Object.defineProperty(target, "mouseLayout", layoutDescriptor);
              else Reflect.deleteProperty(target, "mouseLayout");
              if (layoutWritten)
                Reflect.set(target, "mouseLayout", writtenLayout);
            }
          }
        };
        mouseHandlers.set(target, original);
        restore.push(() => {
          if (target.handleMouse === wrapper) restoreHandler();
          mouseHandlers.delete(target);
        });
        Object.defineProperty(target, "handleMouse", {
          configurable: true,
          writable: true,
          value: wrapper,
        });
      }
      return operation();
    } finally {
      for (const reset of restore.reverse()) reset();
    }
  }
  function handleMouse(action: string, event: DesktopMouseEvent) {
    return controlOperation(actionControl(event.nativeControl?.action), () =>
      applyMouse(action, event),
    );
  }
  function applyMouse(action: string, event: DesktopMouseEvent) {
    if (paused || stopped)
      return { handled: true, capture: false, render: false };
    const target = controls.get(action);
    if (!target) throw new Error("Pi mouse component is no longer active");
    const input = { ...event, ...mouseEvent(event) };
    const renderedHeight = withKeys(() => target.render(input.width)).length;
    const native = input.nativeControl;
    let nativeTarget = target;
    let nativeRange: DesktopSelection | undefined;
    let path = desktopMousePath(target, input);
    let nativeTargets: Map<Component, PiMouseTarget> | undefined;
    if (native) {
      const match = /^(component:\d+)(?::setting:(.*))?$/.exec(native.action);
      const control = match && controls.get(match[1]);
      path =
        path && control
          ? path.slice(
              0,
              path.findIndex((entry) => entry.component === control) + 1,
            )
          : control
            ? nativeMousePath(target, control, {
                x: 0,
                y: 0,
                width: input.width,
                height: Math.max(1, renderedHeight),
              })
            : undefined;
      if (
        !control ||
        !path?.length ||
        (native.kind !== "setting" && match![2] !== undefined)
      )
        throw new Error(
          "Native pointer control does not match its Pi component",
        );
      nativeTarget = control;
      const frame = path.at(-1)!.frame;
      const kind = classify(control);
      withKeys(() => control.render(Math.max(1, frame.width)));
      const expectedKind =
        kind === "SelectList"
          ? "select"
          : kind === "SettingsList"
            ? "setting"
            : kind === "Input"
              ? "input"
              : kind === "Editor" || kind === "CustomEditor"
                ? "textarea"
                : undefined;
      if (
        native.kind !== expectedKind ||
        (native.kind === "setting" && match![2] === undefined)
      )
        throw new Error(
          "Native pointer control type does not match its Pi component",
        );
      if (kind === "SelectList" && native.kind === "select") {
        const items = objects(required(control, "filteredItems"));
        const index = items.findIndex((item) => item.value === native.value);
        if (index < 0)
          throw new Error("Native pointer option is no longer available");
        const visible = callComponentMethod(control, "getVisibleRange") as {
          startIndex: number;
        };
        input.y = Math.max(0, index - visible.startIndex);
      } else if (
        kind === "SettingsList" &&
        native.kind === "setting" &&
        match![2] !== undefined
      ) {
        const settingId = decodeURIComponent(match![2]);
        const items = objects(required(control, "filteredItems"));
        const index = items.findIndex((item) => item.id === settingId);
        if (index < 0 || state(control, "submenuComponent"))
          throw new Error("Native pointer setting is no longer available");
        let visible = callComponentMethod(
          control,
          "getVisibleRange",
          items,
        ) as {
          startIndex: number;
          endIndex: number;
        };
        if (
          input.type === "press" &&
          (index < visible.startIndex || index >= visible.endIndex)
        ) {
          control.selectItem?.(settingId);
          visible = callComponentMethod(
            control,
            "getVisibleRange",
            items,
          ) as typeof visible;
        }
        input.y =
          index -
          visible.startIndex +
          (state(control, "searchEnabled") ? 2 : 0);
      } else if (
        ["Input", "Editor", "CustomEditor"].includes(kind ?? "") &&
        native.text === getText(control) &&
        native.selection
      ) {
        // Feed the browser caret into Pi's own rendered line and grapheme coordinates.
        position(control, native.selection, false);
        nativeRange = storedRange(control);
        if (kind === "Input") {
          input.x =
            2 +
            api.visibleWidth(getText(control).slice(0, nativeRange!.start)) -
            number(state(control, "renderedStartColumn"));
          input.y = 0;
        } else {
          const position = control.getCursor!();
          const lines = objects(
            callComponentMethod(
              control,
              "buildVisualLineMap",
              number(state(control, "lastWidth"), frame.width),
            ),
          );
          const index = lines.reduce(
            (last, line, index) =>
              line.logicalLine === position.line &&
              number(line.startCol) <= position.col
                ? index
                : last,
            -1,
          );
          if (index >= 0) {
            const logical = getText(control).split("\n")[position.line] ?? "";
            const paddingX = Math.min(
              number(state(control, "paddingX")),
              Math.max(0, Math.floor((frame.width - 1) / 2)),
            );
            input.x =
              paddingX +
              api.visibleWidth(
                logical.slice(number(lines[index].startCol), position.col),
              );
            input.y = index - number(state(control, "scrollOffset")) + 1;
          }
        }
      }
      if (
        native.offset &&
        (native.offset.x < 0 ||
          native.offset.y < 0 ||
          native.offset.x >= 1 ||
          native.offset.y >= 1)
      ) {
        input.x = Math.floor(number(native.offset.x) * frame.width);
        input.y = Math.floor(number(native.offset.y) * frame.height);
      }
      input.x += frame.x;
      input.y += frame.y;
      input.height = path[0].frame.height;
    }
    if (path) {
      nativeTargets = new Map(
        path.map(({ component, frame }) => [
          component,
          {
            component,
            originX: input.screenX - (input.x - frame.x),
            originY: input.screenY - (input.y - frame.y),
            width: frame.width,
            height: frame.height,
          },
        ]),
      );
    }
    const before = cursor(nativeTarget),
      textBefore = getText(nativeTarget);
    const result = withMousePath(path, nativeTargets, () =>
      mouse.dispatch(target, input, nativeTargets),
    );
    if (paused || stopped)
      return { handled: true, capture: false, render: false };
    if (native && (nativeTarget.getText || nativeTarget.getValue)) {
      const after = cursor(nativeTarget);
      const range =
        nativeRange &&
        textBefore === getText(nativeTarget) &&
        before.start === after.start
          ? nativeRange
          : after;
      rememberRange(nativeTarget, range);
      if (textBefore !== getText(nativeTarget) || before.start !== after.start)
        result.editor = {
          text: getText(nativeTarget),
          selection: range,
          revision: textRevision(nativeTarget),
          selectionRevision: selectionState(nativeTarget).revision,
          controlVersion: controlState(nativeTarget).version,
        };
    }
    if (result.render) invalidate();
    return result;
  }
  function handleInput(
    data: string,
    _event?: DesktopKeyEvent,
    input?: DesktopInputContext & { terminalFiltered?: boolean },
  ): DesktopInputResult {
    if (
      slot === "editor" &&
      root?.getText &&
      !input?.controlAction &&
      !input?.raw
    )
      input = {
        ...input,
        controlAction: id(root),
        controlText: input?.editorText,
      };
    return controlOperation(actionControl(input?.controlAction), () =>
      applyInput(data, _event, input),
    );
  }
  function applyInput(
    data: string,
    _event?: DesktopKeyEvent,
    input?: DesktopInputContext & { terminalFiltered?: boolean },
  ): DesktopInputResult {
    if (paused || stopped) return { consume: true };
    const rawInput = input?.raw === true;
    const releaseInput = api.isKeyRelease(data) || _event?.type === "release";
    if (rawInput || releaseInput)
      input = {
        ...input,
        controlText: undefined,
        selection: undefined,
        editorText: undefined,
        editorLayout: undefined,
      };
    const browserTarget = input?.controlAction
      ? controls.get(input.controlAction.replace(/:setting:.*$/, ""))
      : undefined;
    const staleContext =
      !!browserTarget &&
      input?.controlVersion !== undefined &&
      input.controlVersion !== controlState(browserTarget).version;
    if (staleContext)
      input = {
        ...input,
        controlText: undefined,
        selection: undefined,
        editorLayout: undefined,
        editorText: undefined,
      };
    if (
      browserTarget &&
      !releaseInput &&
      !rawInput &&
      !terminalFrames.has(browserTarget)
    )
      sharedRuntime.focus(browserTarget, false, true);
    const initialFocusRevision = focusRevision;
    const browserSelection = input?.selection;
    const hasHooks = inputScope.hasHooks;
    if (
      hasHooks &&
      !rawInput &&
      browserTarget &&
      (browserTarget.getText || browserTarget.getValue)
    ) {
      if (
        typeof input?.controlText === "string" &&
        getText(browserTarget) !== input.controlText
      )
        editText(browserTarget, input.controlText, () => {});
      position(
        browserTarget,
        browserSelection ?? storedRange(browserTarget) ?? cursor(browserTarget),
        false,
      );
    }
    const browserBefore = browserTarget
      ? { text: getText(browserTarget), cursor: cursor(browserTarget).start }
      : undefined;
    const browserChanged = () =>
      !!browserTarget &&
      !!browserBefore &&
      (getText(browserTarget) !== browserBefore.text ||
        cursor(browserTarget).start !== browserBefore.cursor);
    const browserReply = (result: DesktopInputResult): DesktopInputResult => {
      if (paused || stopped) return { consume: true };
      if (rawInput) return { ...result, editor: undefined };
      // Unchanged releases must not restore a browser selection that changed
      // after the preceding key's native default (for example Ctrl+A).
      if ((releaseInput || api.isKeyRelease(data)) && !browserChanged())
        return result;
      if (
        stopped ||
        !browserTarget ||
        !(browserTarget.getText || browserTarget.getValue)
      )
        return result;
      const selection = browserChanged()
        ? cursor(browserTarget)
        : (browserSelection ??
          storedRange(browserTarget) ??
          cursor(browserTarget));
      rememberRange(browserTarget, selection);
      return {
        ...result,
        editor: {
          text: getText(browserTarget),
          selection,
          revision: textRevision(browserTarget),
          selectionRevision: selectionState(browserTarget).revision,
          controlVersion: controlState(browserTarget).version,
        },
      };
    };
    const filtered = input?.terminalFiltered
      ? { consume: false, data }
      : inputScope.run(data, () => stopped || paused);
    if (filtered.consume) return browserReply({ consume: true });
    data = filtered.data ?? data;
    const routed = sharedRuntime.dispatch(runtimeEndpoint, data, _event);
    if (routed) return browserReply({ consume: true });
    const focusChanged = focusRevision !== initialFocusRevision;
    const terminalInput = !!browserTarget && terminalFrames.has(browserTarget);
    const target = focusChanged
      ? focused
      : terminalInput && !browserTarget!.handleInput
        ? focused
        : input?.controlAction
          ? browserTarget
          : (focused ??
            (requestedFocus === null
              ? undefined
              : root?.handleInput
                ? root
                : [...controls.values()].find((target) => target.handleInput)));
    const redirected =
      !!input?.controlAction && focusChanged && target !== browserTarget;
    // A listener may move (or clear) focus during this very key. The browser
    // context still belongs to its source control, never the new Pi target.
    const respond = (result: DesktopInputResult): DesktopInputResult => {
      if (paused || stopped) return { consume: true };
      if (!redirected) return result;
      return browserReply({ consume: true });
    };
    if (redirected) input = undefined;
    else if (browserTarget && browserChanged()) {
      // Callback mutations are authoritative over the event's earlier DOM
      // snapshot, including the original component's resulting caret.
      const selection = cursor(browserTarget);
      rememberRange(browserTarget, selection);
      input = {
        ...input,
        controlText: undefined,
        selection,
        editorLayout: undefined,
      };
    }
    if (!target) return respond({ consume: focusChanged, data });
    const receiver = () => {
      const owner = inputOwners.get(target);
      return owner?.handleInput ? owner : (owners.get(target) ?? target);
    };
    if (api.isKeyRelease(data)) {
      const destination = receiver();
      if (destination.wantsKeyRelease) execute(destination, data);
      return browserReply({ consume: true });
    }
    if (rawInput) {
      if (!terminalInput || (!focused && requestedFocus !== null))
        setMappedFocus(target);
      execute(receiver(), data);
      rememberRange(target, cursor(target));
      return respond({ consume: true });
    }
    if (
      typeof input?.controlText === "string" &&
      getText(target) !== input.controlText
    )
      editText(target, input.controlText, () => {});
    let range = input?.selection ?? storedRange(target) ?? cursor(target);
    if (["Editor", "CustomEditor"].includes(classify(target) ?? ""))
      range = normalizePasteSelection(
        getText(target),
        range,
        componentPasteSpans(target),
      );
    const nativeSelection =
      (target.getText || target.getValue) &&
      (api.matchesKey(data, "ctrl+a") ||
        (range.start !== range.end &&
          (api.matchesKey(data, "ctrl+c") || api.matchesKey(data, "ctrl+x"))) ||
        /^(shift\+)(left|right|up|down|home|end)$/.test(
          api.parseKey(data) ?? "",
        ));
    let replacement: string | undefined;
    const rangeNavigation =
      range.start !== range.end &&
      (keys.matches(data, "tui.editor.cursorLeft") ||
        keys.matches(data, "tui.editor.cursorRight"));
    let rangeCollapsed = false;
    let rangeDeletion = false,
      rangeDeleted = false;
    const textBefore = getText(target);
    if (target.getText || target.getValue) {
      if (
        range.start !== range.end &&
        (!/[\x00-\x1f\x7f]/.test(data) ||
          data.startsWith("\x1b[200~") ||
          api.decodeKittyPrintable(data) !== undefined)
      )
        replacement =
          getText(target).slice(0, range.start) +
          getText(target).slice(range.end);
      rangeDeletion =
        range.start !== range.end &&
        (keys.matches(data, "tui.editor.deleteCharBackward") ||
          keys.matches(data, "tui.editor.deleteCharForward") ||
          (["Editor", "CustomEditor"].includes(classify(target) ?? "") &&
            (api.matchesKey(data, "shift+backspace") ||
              api.matchesKey(data, "shift+delete"))));
      position(target, range);
      range = storedRange(target)!;
    }
    const operation = (bindings?: Parameters<typeof api.setKeybindings>[0]) =>
      execute(receiver(), data, bindings);
    if (nativeSelection) {
      operation({
        getKeys: (action) => inputKeys.getKeys(action),
        matches: (value, action) =>
          // Desktop select-all already replaces Pi's default Ctrl+A line-start binding.
          !(
            api.matchesKey(value, "ctrl+a") &&
            action === "tui.editor.cursorLineStart"
          ) && inputKeys.matches(value, action),
      });
      const after = cursor(target);
      if (getText(target) === textBefore && after.start === range.start) {
        rememberRange(target, range);
        return respond({
          consume: false,
          data,
          ...(staleContext
            ? {
                editor: {
                  text: getText(target),
                  selection: range,
                  revision: textRevision(target),
                  selectionRevision: selectionState(target).revision,
                  controlVersion: controlState(target).version,
                },
              }
            : {}),
        });
      }
    } else if (rangeDeletion)
      withComponentRangeDeletion(
        target,
        range,
        (text, offset, deletion) => {
          rangeDeleted = true;
          return editText(target, text, () => {
            position(target, { start: offset, end: offset });
            return deletion();
          });
        },
        operation,
      );
    else if (replacement !== undefined)
      editText(target, replacement, () => {
        position(target, { start: range.start, end: range.start });
        operation();
      });
    else if (["Editor", "CustomEditor"].includes(classify(target) ?? ""))
      withComponentEditorLayout(
        target,
        input?.editorLayout,
        operation,
        rangeNavigation
          ? {
              selection: range,
              onCollapse: () => {
                rangeCollapsed = true;
              },
            }
          : undefined,
      );
    else if (
      classify(target) === "Input" &&
      input?.editorLayout &&
      (keys.matches(data, "tui.editor.cursorLeft") ||
        keys.matches(data, "tui.editor.cursorRight"))
    )
      withComponentInputNavigation(
        target,
        input.editorLayout,
        range,
        keys.matches(data, "tui.editor.cursorRight"),
        (matched) =>
          operation({
            getKeys: (action) => inputKeys.getKeys(action),
            matches: (value, action) => {
              const left = "tui.editor.cursorLeft",
                right = "tui.editor.cursorRight";
              const actual =
                input.editorLayout?.direction === "rtl"
                  ? action === left
                    ? right
                    : action === right
                      ? left
                      : action
                  : action;
              const result = inputKeys.matches(value, actual);
              if (result && (action === left || action === right)) matched();
              return result;
            },
          }),
        () => {
          rangeCollapsed = true;
        },
      );
    else operation();
    const current = cursor(target);
    const next =
      !rangeDeleted &&
      !rangeCollapsed &&
      getText(target) === textBefore &&
      current.start === range.start
        ? range
        : current;
    rememberRange(target, next);
    return respond({
      consume: true,
      ...(target.getText || target.getValue
        ? {
            editor: {
              text: getText(target),
              selection: next,
              revision: textRevision(target),
              selectionRevision: selectionState(target).revision,
              controlVersion: controlState(target).version,
            },
          }
        : {}),
    });
  }
  return controller;
}

function keyEvent(key: string) {
  return desktopKeyFromId(key) ?? { key };
}
function mouseEvent(value: object): PiMouseEvent {
  const type = state(value, "type"),
    button = state(value, "button");
  if (
    !["press", "release", "move", "drag", "click", "wheel"].includes(
      string(type),
    ) ||
    !["left", "middle", "right", "none"].includes(string(button))
  )
    throw new Error("Invalid Pi mouse event");
  return {
    type: type as PiMouseEvent["type"],
    button: button as PiMouseEvent["button"],
    x: number(state(value, "x")),
    y: number(state(value, "y")),
    screenX: number(state(value, "screenX")),
    screenY: number(state(value, "screenY")),
    width: Math.max(1, number(state(value, "width"))),
    height: Math.max(1, number(state(value, "height"))),
    shift: state(value, "shift") === true,
    alt: state(value, "alt") === true,
    ctrl: state(value, "ctrl") === true,
    wheelDelta: number(state(value, "wheelDelta")),
    clickCount: number(state(value, "clickCount")),
  };
}
const editorSelections = new WeakMap<
  object,
  () => DesktopSelection | undefined
>();
function configureCustomEditor(
  editor: import("@earendil-works/pi-coding-agent").CustomEditor,
  sdk: DesktopAdapterContext["sdk"],
  selection: () => DesktopSelection | undefined,
) {
  editorSelections.set(editor, selection);
  const hasSelection = () => {
    const range = editorSelections.get(editor)?.();
    return !!range && range.start !== range.end;
  };
  const run = (action: string, args?: Record<string, unknown>) => {
    void sdk.host
      .action({ action, args })
      .catch((error) => sdk.host.notice(errorMessage(error), "error"));
  };
  editor.onEscape ??= () => run("queue.restore", { abort: true });
  editor.onCtrlD ??= () =>
    sdk.host.emitEvent({ type: "activity", name: "desktop_editor_exit" });
  editor.onPasteImage ??= () => run("clipboard.paste");
  const handlers: Record<string, () => void> = {
    "app.clear": () => {
      if (hasSelection()) return;
      editor.setText("");
      sdk.host.emitEvent({ type: "editor", text: "" });
    },
    "app.thinking.cycle": () => run("thinking.cycle"),
    "app.thinking.save": () =>
      run("thinking.set", { level: sdk.session.thinkingLevel, persist: true }),
    "app.thinking.toggle": () =>
      run("display.thinking", {
        visible: sdk.settingsManager.getHideThinkingBlock(),
      }),
    "app.model.cycleForward": () =>
      run("model.cycle", { direction: "forward" }),
    "app.model.cycleBackward": () =>
      run("model.cycle", { direction: "backward" }),
    "app.model.select": () => run("model.select"),
    "app.tools.expand": () =>
      run("display.tools", {
        expanded: !sdk.session.extensionRunner
          .getUIContext()
          .getToolsExpanded(),
      }),
    "app.editor.external": () => run("editor.external"),
    "app.message.copy": () => {
      if (!hasSelection()) run("clipboard.copy");
    },
    "app.message.dequeue": () => run("queue.restore"),
    "app.message.followUp": () => {
      const text = editor.getExpandedText();
      editor.setText("");
      sdk.host.emitEvent({
        type: "activity",
        name: "desktop_editor_followUp",
        data: text,
      });
    },
    "app.session.new": () => run("session.new"),
    "app.session.tree": () => run("session.selector", { kind: "tree" }),
    "app.session.fork": () => run("session.selector", { kind: "fork" }),
    "app.session.resume": () => run("session.selector", { kind: "resume" }),
  };
  for (const [action, handler] of Object.entries(handlers)) {
    const existing = state(editor, "actionHandlers");
    if (existing instanceof Map && existing.has(action)) continue;
    editor.onAction(action as Parameters<typeof editor.onAction>[0], handler);
  }
}
