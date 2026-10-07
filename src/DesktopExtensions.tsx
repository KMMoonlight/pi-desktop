import { t, useLocale, localizeText, getLocale } from "./i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent,
  PointerEvent,
  WheelEvent,
} from "react";
import { Button, Modal, Switch } from "reshaped";
import {
  Check,
  X,
  Save,
  Plus,
  Trash2,
  Play,
  Copy,
  Download,
  RefreshCw,
  ArrowUp,
  Clipboard,
  ChevronDown,
} from "lucide-react";
import type {
  DesktopNode,
  DesktopSlot,
  DesktopSurface,
  DesktopMouseEvent,
  DesktopMouseResult,
  DesktopPasteSpan,
  DesktopTextStyle,
} from "../shared/desktop-ui";
import type { Run } from "./Workspace";
import { SelectField, IconButton } from "./ui";
import { Markdown } from "./Messages";
import { StyledText } from "./StyledText";
import { ComponentTerminal } from "./TerminalPanel";
import { ComponentSelect, needsRichText } from "./ComponentSelect";
import {
  componentControlOwner,
  componentControlVersion,
  componentTerminalGeometry,
  syncComponentScrollLayout,
  syncComponentScrollLayouts,
} from "./component-dom";
import { ComponentMarkdown } from "./ComponentMarkdown";
import { ComponentImage } from "./ComponentImage";
import { useTextSelection } from "./useTextSelection";
import { Autocomplete } from "./Autocomplete";
import { applyText, isApplyingText } from "./textEditing";
import { applyEditorResult } from "./ExtensionInput";
import { enqueueExtensionEvent } from "./extensionEvents";
import { normalizePasteSelection } from "../shared/paste-selection";

const icons: Record<string, typeof Check> = {
  check: Check,
  close: X,
  save: Save,
  add: Plus,
  delete: Trash2,
  play: Play,
  copy: Copy,
  download: Download,
  refresh: RefreshCw,
  send: ArrowUp,
};

let mouseFocusVersion = 0;
let mouseInteractionVersion = 0;
let applyingRequestedFocus = false;
export function desktopFocusRevision() {
  return mouseFocusVersion;
}

interface Dispatch {
  (action: string, value?: unknown): Promise<unknown>;
  mouse(
    action: string,
    event: DesktopMouseEvent,
  ): Promise<DesktopMouseResult | undefined>;
}
function nodePadding(padding?: { x: number; y: number }): CSSProperties {
  return padding ? { padding: `${padding.y}lh ${padding.x}ch` } : {};
}
function nodePresentation(style?: DesktopTextStyle): CSSProperties {
  return {
    ...style,
    ...(style?.backgroundColor
      ? { "--desktop-text-background": style.backgroundColor }
      : {}),
    ...(style?.color ? { "--desktop-text-foreground": style.color } : {}),
  };
}

function placeholderPresentation(style?: DesktopTextStyle): CSSProperties {
  if (!style) return {};
  return {
    "--desktop-placeholder-color": style.color ?? "inherit",
    "--desktop-placeholder-background": style.backgroundColor ?? "transparent",
    "--desktop-placeholder-weight": style.fontWeight ?? "inherit",
    "--desktop-placeholder-style": style.fontStyle ?? "inherit",
    "--desktop-placeholder-opacity": style.opacity ?? 1,
    "--desktop-placeholder-decoration": style.textDecorationLine ?? "none",
    "--desktop-placeholder-visibility": style.visibility ?? "visible",
  } as CSSProperties;
}

function nodeLabel(node: DesktopNode & { label: string }) {
  if (!node.desktopLabel || getLocale() === "zh-CN") return node.label;
  return node.label === "关闭" ? t("关闭扩展") : localizeText(node.label);
}

function NodeLabel({ node }: { node: DesktopNode & { label: string } }) {
  useLocale();
  return (
    <>
      {node.labelPrefix && (
        <span aria-hidden="true">
          <StyledText {...node.labelPrefix} />
        </span>
      )}
      <StyledText text={nodeLabel(node)} runs={node.labelRuns} />
    </>
  );
}

function nativeOptionStyle(
  style?: DesktopTextStyle,
): CSSProperties | undefined {
  if (!style || style.visibility !== "hidden") return style;
  return { ...style, visibility: undefined, color: "transparent" };
}

function ScrollControl({
  node,
  dispatch,
}: {
  node: Extract<DesktopNode, { kind: "scroll" }>;
  dispatch: Dispatch;
}) {
  useLocale();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const dispatchRef = useRef(dispatch);
  const programmatic = useRef<number | undefined>(undefined);
  const scrollbarHover = useRef(false);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const outer = viewport.current,
      inner = content.current;
    if (!outer || !inner) return;
    const measure = () => {
      void syncComponentScrollLayout(outer, (action, value) =>
        dispatchRef.current(action, value),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, [node.action]);
  useEffect(() => {
    const outer = viewport.current;
    if (!outer) return;
    const line = Number.parseFloat(getComputedStyle(outer).lineHeight) || 20;
    const offset = node.followEnd
      ? Math.max(0, outer.scrollHeight - outer.clientHeight)
      : Math.min(
          node.scrollTop * line,
          Math.max(0, outer.scrollHeight - outer.clientHeight),
        );
    if (Math.abs(outer.scrollTop - offset) > 1) {
      programmatic.current = offset;
      outer.scrollTop = offset;
    }
  }, [node.scrollTop, node.followEnd]);
  return (
    <div
      ref={viewport}
      className="desktop-scroll"
      data-desktop-scroll-action={node.action}
      style={{
        overscrollBehavior: node.overscroll,
        scrollbarWidth: node.scrollbar === "hidden" ? "none" : "auto",
        overflowY: node.scrollbar === "always" ? "scroll" : "auto",
        scrollbarColor:
          node.scrollbarVisible === false
            ? "transparent transparent"
            : node.scrollbarColors
              ? `${node.scrollbarColors.thumb ?? "var(--text)"} ${node.scrollbarColors.track ?? "var(--page)"}`
              : undefined,
      }}
      onPointerMove={(event) => {
        const target = event.currentTarget;
        const x = event.clientX - target.getBoundingClientRect().left;
        const active =
          node.scrollbar !== "hidden" &&
          target.offsetWidth > target.clientWidth &&
          x >= target.clientWidth;
        if (scrollbarHover.current === active) return;
        scrollbarHover.current = active;
        void dispatch(`${node.action}:scrollbar`, active);
      }}
      onPointerLeave={() => {
        if (!scrollbarHover.current) return;
        scrollbarHover.current = false;
        void dispatch(`${node.action}:scrollbar`, false);
      }}
      onScroll={(event) => {
        const outer = event.currentTarget;
        if (
          programmatic.current !== undefined &&
          Math.abs(programmatic.current - outer.scrollTop) < 1
        ) {
          programmatic.current = undefined;
          return;
        }
        programmatic.current = undefined;
        const line =
          Number.parseFloat(getComputedStyle(outer).lineHeight) || 20;
        void dispatch(node.action, Math.round(outer.scrollTop / line));
      }}
    >
      <div ref={content}>
        {(
          node.rendered?.composition ??
          node.children.map((_child, child) => ({ child }))
        ).map((part, position) =>
          "lines" in part ? (
            <RenderedAdditions
              key={`lines:${position}`}
              lines={part.lines}
              position="inside"
            />
          ) : (
            <NodeView
              key={`child:${part.child}`}
              node={node.children[part.child]}
              dispatch={dispatch}
            />
          ),
        )}
      </div>
    </div>
  );
}

function hasNativeTouch(node: DesktopNode): boolean {
  if (node.kind === "region") return hasNativeTouch(node.child);
  if (node.kind === "row" || node.kind === "column")
    return node.children.some(hasNativeTouch);
  return "action" in node;
}

function MouseControl({
  node,
  dispatch,
}: {
  node: Extract<DesktopNode, { kind: "region" }>;
  dispatch: Dispatch;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  type NativeControl =
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | HTMLButtonElement;
  type Gesture = {
    native?: NativeControl;
    terminal?: HTMLElement;
    hitElements: HTMLElement[];
    lastSample?: Sample;
    retained?: boolean;
  };
  const gestures = useRef(new Map<number, Gesture>());
  type Sample = {
    type: DesktopMouseEvent["type"];
    pointerId: number;
    button: DesktopMouseEvent["button"];
    clientX: number;
    clientY: number;
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
    wheel?: { delta: number; mode: number };
    clickCount?: number;
    cancelled?: boolean;
    gesture?: Gesture;
    previousFocus: Element | null;
    focusVersion: number;
    interactionVersion: number;
    native?: NativeControl;
    terminal?: HTMLElement;
    nativeControl?: DesktopMouseEvent["nativeControl"];
    nativeLink?: boolean;
    nativeReady?: Promise<void>;
    hitElements: HTMLElement[];
  };
  const refreshNativePointer = (native: NativeControl) => {
    const active = [...gestures.current.values()].filter(
      (gesture) => gesture.native === native,
    ).length;
    if (active) native.dataset.pointerActive = String(active);
    else delete native.dataset.pointerActive;
  };
  const enqueue = (sample: Sample, element: HTMLDivElement) => {
    const native = sample.native;
    if (native)
      native.dataset.pointerPending = String(
        Number(native.dataset.pointerPending ?? 0) + 1,
      );
    void enqueueExtensionEvent(async () => {
      await sample.nativeReady;
      if (!element.isConnected && !sample.cancelled) return;
      if (
        sample.type !== "press" &&
        !sample.native &&
        sample.gesture?.retained === false
      ) {
        const bounds = element.getBoundingClientRect();
        if (
          sample.cancelled ||
          sample.clientX < bounds.left ||
          sample.clientX >= bounds.right ||
          sample.clientY < bounds.top ||
          sample.clientY >= bounds.bottom
        )
          return;
      }
      let receiver: HTMLElement = element;
      // Pi's container dispatch visits children and falls back to their parents once.
      while (receiver.parentElement?.closest("[data-pointer-action]"))
        receiver = receiver.parentElement.closest<HTMLElement>(
          "[data-pointer-action]",
        )!;
      let result: DesktopMouseResult | undefined;
      {
        const style = getComputedStyle(receiver);
        const terminal = componentTerminalGeometry(sample.terminal);
        const cell =
          terminal?.cell ?? (Number.parseFloat(style.fontSize) || 14) * 0.6;
        const line =
          (terminal?.line ?? Number.parseFloat(style.lineHeight)) || 20;
        const receiverComponent = receiver.closest<HTMLElement>(
          "[data-component-key]",
        );
        const frameFor = (element: HTMLElement, component = element) => {
          const isTerminal = terminal && component === terminal.owner;
          const bounds = isTerminal
            ? terminal.screen
            : element.getBoundingClientRect();
          return {
            bounds,
            width: isTerminal
              ? terminal.columns
              : Math.max(
                  1,
                  (terminal && Number(component.dataset.componentColumns)) ||
                    Math.ceil(bounds.width / cell),
                ),
            height: isTerminal
              ? terminal.rows
              : Math.max(1, Math.ceil(bounds.height / line)),
          };
        };
        const { bounds, width, height } = frameFor(
          receiver,
          receiverComponent ?? receiver,
        );
        const first = sample.hitElements.findIndex(
          (element) =>
            element.dataset.componentKey ===
            receiverComponent?.dataset.componentKey,
        );
        const hitPath =
          first < 0
            ? undefined
            : sample.hitElements.slice(first).map((previous) => {
                const element = previous.isConnected
                  ? previous
                  : (receiverComponent?.querySelector<HTMLElement>(
                      `[data-component-key="${CSS.escape(previous.dataset.componentKey ?? "")}"]`,
                    ) ?? previous);
                const frame = frameFor(element);
                return {
                  action: element.dataset.componentAction ?? "",
                  occurrence: element.dataset.componentKey ?? "",
                  x: Math.floor((sample.clientX - frame.bounds.left) / cell),
                  y: Math.floor((sample.clientY - frame.bounds.top) / line),
                  width: frame.width,
                  height: frame.height,
                };
              });
        result = await dispatchRef.current.mouse(
          receiver.dataset.pointerAction ?? node.action,
          {
            pointerId: sample.pointerId,
            type: sample.type,
            button: sample.button,
            x: Math.floor((sample.clientX - bounds.left) / cell),
            y: Math.floor((sample.clientY - bounds.top) / line),
            screenX: terminal
              ? Math.floor((sample.clientX - terminal.screen.left) / cell) +
                Math.floor(terminal.screen.left / cell)
              : Math.floor(sample.clientX / cell),
            screenY: terminal
              ? Math.floor((sample.clientY - terminal.screen.top) / line) +
                Math.floor(terminal.screen.top / line)
              : Math.floor(sample.clientY / line),
            width,
            height,
            shift: sample.shift,
            alt: sample.alt,
            ctrl: sample.ctrl,
            wheelDelta: sample.wheel
              ? sample.wheel.delta *
                (sample.wheel.mode === 1
                  ? 1
                  : sample.wheel.mode === 2
                    ? bounds.height / line
                    : 1 / line)
              : undefined,
            clickCount: sample.clickCount,
            cancelled: sample.cancelled,
            nativeControl: sample.nativeControl,
            nativeLink: sample.nativeLink,
            hitPath,
          },
        );
        if (!element.isConnected || sample.cancelled) return;
        if (
          result?.editor &&
          sample.native &&
          (sample.focusVersion === mouseFocusVersion ||
            sample.native.value === sample.nativeControl?.text)
        )
          applyEditorResult(sample.native, {
            consume: true,
            editor: result.editor,
          });
        const shellFocus =
          document.activeElement !== document.body &&
          document.activeElement !== document.documentElement &&
          document.activeElement?.contains(receiver);
        if (
          result?.focusAction &&
          sample.interactionVersion === mouseInteractionVersion &&
          (sample.focusVersion === mouseFocusVersion || shellFocus) &&
          (document.activeElement === sample.previousFocus ||
            document.activeElement?.contains(receiver) ||
            receiver.contains(document.activeElement))
        ) {
          let control =
            sample.native ??
            receiver
              .closest("[data-surface-id]")
              ?.querySelector<HTMLElement>(
                `[data-desktop-action="${CSS.escape(result.focusAction)}"]`,
              ) ??
            receiver
              .closest("[data-surface-id]")
              ?.querySelector<HTMLElement>(
                `[data-pointer-action="${CSS.escape(result.focusAction)}"]`,
              );
          if (control?.matches(".component-terminal"))
            control =
              control.querySelector<HTMLElement>(".xterm-helper-textarea") ??
              control;
          if (!control || control.matches("[data-pointer-action]"))
            (control ?? receiver).tabIndex = -1;
          (control ?? receiver).focus({ preventScroll: true });
        }
      }
      if (sample.type === "press")
        sample.gesture!.retained = !!(result?.capture || result?.retainPointer);
      if (
        sample.type === "press" &&
        element.isConnected &&
        gestures.current.get(sample.pointerId) === sample.gesture
      ) {
        if (sample.native && result?.capture) {
          sample.native.setPointerCapture(sample.pointerId);
        } else if (!sample.native && sample.nativeLink && result?.capture) {
          element.setPointerCapture(sample.pointerId);
        } else if (
          !sample.native &&
          !result?.capture &&
          !result?.retainPointer
        ) {
          gestures.current.delete(sample.pointerId);
          if (element.hasPointerCapture(sample.pointerId))
            element.releasePointerCapture(sample.pointerId);
        }
      }
    })
      .catch((error) => console.error(error))
      .finally(() => {
        if (!native) return;
        refreshNativePointer(native);
        const remaining = Number(native.dataset.pointerPending ?? 1) - 1;
        if (remaining) native.dataset.pointerPending = String(remaining);
        else {
          delete native.dataset.pointerPending;
          native.dispatchEvent(new Event("pi:pointer-settled"));
        }
      });
  };
  useEffect(() => {
    const element = root.current;
    return () => {
      const pending = [...gestures.current.values()];
      gestures.current.clear();
      if (element)
        for (const gesture of pending)
          if (gesture.lastSample)
            enqueue(
              { ...gesture.lastSample, type: "release", cancelled: true },
              element,
            );
    };
  }, [node.action]);
  const send = (
    type: DesktopMouseEvent["type"],
    event:
      | MouseEvent<HTMLDivElement>
      | PointerEvent<HTMLDivElement>
      | WheelEvent<HTMLDivElement>
      | WindowEventMap["wheel"]
      | WindowEventMap["pointerdown"],
    cancelled = false,
  ) => {
    const pointerId = "pointerId" in event ? event.pointerId : 1;
    const active = gestures.current.get(pointerId);
    const terminal =
      active?.terminal ??
      (event.target instanceof Element
        ? (event.target.closest<HTMLElement>(
            ".component-terminal[data-terminal-cols]",
          ) ?? undefined)
        : undefined);
    if (
      !active &&
      !terminal &&
      event.target instanceof Element &&
      event.target.closest("[data-desktop-native-input]")
    )
      return;
    if (type === "click") {
      mouseFocusVersion++;
      mouseInteractionVersion++;
    }
    const owner = root.current;
    if (!owner) return;
    const nativeLink =
      !terminal &&
      event.target instanceof Element &&
      !!event.target.closest("a[href]");
    if (type === "click" && nativeLink) return;
    const form =
      !terminal &&
      event.target instanceof Element &&
      !event.target.closest('[data-desktop-raw-input="true"]')
        ? event.target.closest("input,textarea,select,button")
        : null;
    const native =
      type !== "press" && active
        ? active.native
        : node.nativeControls &&
            (form instanceof HTMLInputElement ||
              form instanceof HTMLTextAreaElement ||
              form instanceof HTMLSelectElement ||
              (form instanceof HTMLButtonElement &&
                ["setting", "select"].includes(
                  form.dataset.desktopMouseKind ?? "",
                )))
          ? form
          : undefined;
    // Explicit confirm/cancel buttons retain their semantic desktop command.
    if (form && !native) return;
    event.stopPropagation();
    const hitElements: HTMLElement[] = [];
    let hit =
      event.target instanceof Element
        ? componentControlOwner(event.target).closest<HTMLElement>(
            "[data-component-key]",
          )
        : null;
    while (hit) {
      hitElements.unshift(hit);
      hit =
        hit.parentElement?.closest<HTMLElement>("[data-component-key]") ?? null;
    }
    const gesture: Gesture | undefined =
      type === "press" ? { native, terminal, hitElements } : active;
    const sample: Sample = {
      type,
      pointerId,
      button:
        type === "wheel" || type === "move"
          ? "none"
          : type === "drag"
            ? event.buttons & 1
              ? "left"
              : event.buttons & 2
                ? "right"
                : event.buttons & 4
                  ? "middle"
                  : "none"
            : event.button === 0
              ? "left"
              : event.button === 2
                ? "right"
                : event.button === 1
                  ? "middle"
                  : "none",
      clientX: event.clientX,
      clientY: event.clientY,
      shift: event.shiftKey,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      wheel:
        "deltaY" in event
          ? { delta: event.deltaY, mode: event.deltaMode }
          : undefined,
      clickCount: Math.max(1, event.detail),
      cancelled,
      gesture,
      previousFocus: document.activeElement,
      focusVersion: mouseFocusVersion,
      interactionVersion: mouseInteractionVersion,
      native,
      terminal,
      nativeLink: nativeLink || undefined,
      hitElements:
        type !== "press" && active ? active.hitElements : hitElements,
    };
    if (native) {
      const bounds = native.getBoundingClientRect();
      const offset = {
        x: (sample.clientX - bounds.left) / Math.max(1, bounds.width),
        y: (sample.clientY - bounds.top) / Math.max(1, bounds.height),
      };
      const option =
        native instanceof HTMLSelectElement
          ? [...native.options].find((option) => {
              const bounds = option.getBoundingClientRect();
              return (
                sample.clientX >= bounds.left &&
                sample.clientX < bounds.right &&
                sample.clientY >= bounds.top &&
                sample.clientY < bounds.bottom
              );
            })
          : undefined;
      sample.nativeReady = new Promise((resolve) =>
        setTimeout(() => {
          sample.nativeControl = {
            action: native.dataset.desktopAction ?? "",
            offset,
            kind:
              native instanceof HTMLButtonElement &&
              native.dataset.desktopMouseKind !== "select"
                ? "setting"
                : native instanceof HTMLSelectElement ||
                    native instanceof HTMLButtonElement
                  ? "select"
                  : native instanceof HTMLTextAreaElement
                    ? "textarea"
                    : "input",
            ...(native instanceof HTMLButtonElement &&
            native.dataset.desktopMouseKind !== "select"
              ? {}
              : native instanceof HTMLSelectElement ||
                  native instanceof HTMLButtonElement
                ? { value: option?.value ?? native.value }
                : {
                    text: native.value,
                    selection: {
                      start: native.selectionStart ?? 0,
                      end: native.selectionEnd ?? 0,
                    },
                  }),
          };
          resolve();
        }, 0),
      );
    }
    if (gesture) gesture.lastSample = sample;
    if (type === "press") {
      gestures.current.set(pointerId, gesture!);
      if (native) refreshNativePointer(native);
      // Native controls keep their browser selection until Pi explicitly requests capture.
      if (!native && !nativeLink) owner.setPointerCapture(pointerId);
    }
    if (type === "release") {
      gestures.current.delete(pointerId);
    }
    enqueue(sample, owner);
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const element = root.current;
    const wheel = (event: WindowEventMap["wheel"]) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".component-terminal[data-terminal-cols]")
      )
        return;
      // xterm consumes wheel events before React's bubble listener. Capture
      // them once at the outer Pi region and retain its original dispatch path.
      event.preventDefault();
      sendRef.current("wheel", event);
    };
    element?.addEventListener("wheel", wheel, {
      capture: true,
      passive: false,
    });
    return () => element?.removeEventListener("wheel", wheel, true);
  }, [node.action]);
  useEffect(() => {
    const receive = (event: WindowEventMap["pointerdown"]) => {
      if (
        !gestures.current.get(event.pointerId)?.native ||
        (event.target instanceof Node && root.current?.contains(event.target))
      )
        return;
      sendRef.current(
        event.type === "pointermove" ? "drag" : "release",
        event,
        event.type === "pointercancel",
      );
    };
    document.addEventListener("pointermove", receive, true);
    document.addEventListener("pointerup", receive, true);
    document.addEventListener("pointercancel", receive, true);
    return () => {
      document.removeEventListener("pointermove", receive, true);
      document.removeEventListener("pointerup", receive, true);
      document.removeEventListener("pointercancel", receive, true);
    };
  }, [node.action]);
  return (
    <div
      ref={root}
      className="desktop-region"
      style={{ touchAction: hasNativeTouch(node.child) ? undefined : "none" }}
      data-pointer-action={node.action}
      onPointerDown={(event) => send("press", event)}
      onPointerUp={(event) => send("release", event)}
      onPointerCancel={(event) => send("release", event, true)}
      onLostPointerCapture={(event) => {
        const gesture = gestures.current.get(event.pointerId);
        if (gesture?.lastSample) {
          gestures.current.delete(event.pointerId);
          enqueue(
            { ...gesture.lastSample, type: "release", cancelled: true },
            event.currentTarget,
          );
        }
      }}
      onPointerMove={(event) => send(event.buttons ? "drag" : "move", event)}
      onClick={(event) => {
        if (event.detail === 0) send("click", event);
      }}
      onWheel={(event) => send("wheel", event)}
    >
      <NodeView node={node.child} dispatch={dispatch} framed />
    </div>
  );
}

function textNode(
  node: DesktopNode | undefined,
  action: string,
): Extract<DesktopNode, { kind: "input" | "textarea" }> | undefined {
  if (!node) return undefined;
  if (
    (node.kind === "input" || node.kind === "textarea") &&
    node.action === action
  )
    return node;
  const children =
    node.kind === "row" || node.kind === "column" || node.kind === "scroll"
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : node.kind === "tabs"
          ? node.tabs.find((tab) => tab.value === node.value)?.children
          : undefined;
  for (const child of children ?? []) {
    const value = textNode(child, action);
    if (value !== undefined) return value;
  }
  return undefined;
}

function TextControl({
  node,
  dispatch,
}: {
  node: Extract<DesktopNode, { kind: "input" | "textarea" }>;
  dispatch: Dispatch;
}) {
  useLocale();
  const [value, setValue] = useState(node.value);
  const [settled, setSettled] = useState(0);
  const latest = useRef(node);
  latest.current = node;
  const pending = useRef(0);
  const revision = useRef(0);
  const control = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  useLayoutEffect(() => {
    const editor = control.current;
    if (!(editor instanceof HTMLTextAreaElement) || node.appearance !== "composer") return;
    const resize = () => {
      editor.style.height = "0px";
      const empty = editor.closest(".chat-view")?.classList.contains("is-empty");
      editor.style.height = `${Math.min(360, Math.max(empty ? 76 : 48, editor.scrollHeight))}px`;
    };
    resize();
    let width = editor.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = editor.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(editor);
    return () => observer.disconnect();
  }, [value, node.kind, node.appearance]);
  const appliedSelection = useRef(-1);
  const selectionRequest = useRef(0);
  const acknowledgedRevision = useRef(-1);
  const settledRevision = node.revision === undefined ? 0 : settled;
  const acknowledgeVersion = (version?: number) => {
    const target = control.current;
    if (target && version !== undefined)
      target.dataset.controlVersion = String(
        Math.max(componentControlVersion(target) ?? 0, version),
      );
  };
  useEffect(() => {
    const target = control.current;
    if (!target) return;
    const receive = (event: Event) => {
      const transaction = (
        event as CustomEvent<{
          text: string;
          revision?: number;
          selectionRevision?: number;
          controlVersion?: number;
        }>
      ).detail;
      revision.current++;
      acknowledgeVersion(transaction.controlVersion);
      if (transaction.selectionRevision !== undefined)
        appliedSelection.current = Math.max(
          appliedSelection.current,
          transaction.selectionRevision,
        );
      if (transaction.revision !== undefined)
        acknowledgedRevision.current = Math.max(
          acknowledgedRevision.current,
          transaction.revision,
        );
      if (
        transaction.selectionRevision === undefined &&
        transaction.revision !== undefined &&
        latest.current.value === transaction.text &&
        latest.current.selection
      )
        appliedSelection.current = Math.max(
          appliedSelection.current,
          latest.current.selection.revision,
        );
      setValue(transaction.text);
    };
    const pointerSettled = () => setSettled((current) => current + 1);
    target.addEventListener("pi:editor-transaction", receive);
    target.addEventListener("pi:pointer-settled", pointerSettled);
    target.addEventListener("pi:composition-settled", pointerSettled);
    return () => {
      target.removeEventListener("pi:editor-transaction", receive);
      target.removeEventListener("pi:pointer-settled", pointerSettled);
      target.removeEventListener("pi:composition-settled", pointerSettled);
    };
  }, []);
  useEffect(() => {
    if (
      pending.current ||
      control.current?.dataset.piInputPending ||
      control.current?.dataset.piComposing ||
      (node.revision !== undefined &&
        node.revision < acknowledgedRevision.current)
    )
      return;
    if (node.revision !== undefined)
      acknowledgedRevision.current = node.revision;
    acknowledgeVersion(node.controlVersion);
    if (control.current && document.activeElement === control.current)
      applyText(control.current, node.value);
    setValue(node.value);
  }, [node.value, node.revision, node.controlVersion, settledRevision]);
  useEffect(() => {
    if (
      !node.selection ||
      !control.current ||
      pending.current ||
      control.current.dataset.piInputPending ||
      control.current.dataset.piComposing ||
      control.current.dataset.pointerPending ||
      control.current.dataset.pointerActive ||
      value !== node.value ||
      (node.selection.text !== undefined && node.selection.text !== value) ||
      appliedSelection.current >= node.selection.revision
    )
      return;
    appliedSelection.current = node.selection.revision;
    control.current.setSelectionRange(node.selection.start, node.selection.end);
  }, [value, node.value, node.selection, settled]);
  useTextSelection(control, (target) => {
    if (target.dataset.piComposing || target.dataset.piInputPending) return;
    const selection = normalizePasteSelection(
      target.value,
      { start: target.selectionStart ?? 0, end: target.selectionEnd ?? 0 },
      node.pastes ?? [],
    );
    if (
      selection.start !== target.selectionStart ||
      selection.end !== target.selectionEnd
    )
      target.setSelectionRange(
        selection.start,
        selection.end,
        target.selectionDirection ?? "none",
      );
    if (node.selectionAction) {
      const current = ++selectionRequest.current;
      const controlVersion = componentControlVersion(target);
      pending.current++;
      void dispatch(node.selectionAction, {
        start: target.selectionStart ?? 0,
        end: target.selectionEnd ?? 0,
        text: target.value,
        controlVersion,
      })
        .then((result) => {
          if (selectionRequest.current !== current) return;
          const updated = textNode(
            (result as { view?: DesktopNode } | undefined)?.view,
            node.action,
          );
          if (
            updated?.selection &&
            controlVersion !== undefined &&
            updated.controlVersion !== undefined &&
            updated.controlVersion > controlVersion
          ) {
            if (
              updated.revision !== undefined &&
              updated.revision < acknowledgedRevision.current
            )
              return;
            applyEditorResult(target, {
              consume: true,
              editor: {
                text: updated.value,
                selection: updated.selection,
                revision: updated.revision,
                selectionRevision: updated.selection.revision,
                controlVersion: updated.controlVersion,
              },
            });
            return;
          }
          if (updated?.value === target.value)
            acknowledgeVersion(updated.controlVersion);
          if (updated?.selection)
            appliedSelection.current = Math.max(
              appliedSelection.current,
              updated.selection.revision,
            );
        })
        .finally(() => {
          pending.current--;
          setSettled((current) => current + 1);
        });
    }
  });
  const changed = (next: string) => {
    if (isApplyingText()) {
      revision.current++;
      setValue(next);
      return;
    }
    const current = ++revision.current;
    setValue(next);
    if (
      control.current?.dataset.piComposing ||
      control.current?.dataset.piInputPending
    )
      return;
    pending.current++;
    void dispatch(
      node.action,
      node.controlVersion === undefined
        ? next
        : {
            text: next,
            controlVersion: control.current
              ? componentControlVersion(control.current)
              : undefined,
          },
    )
      .then((result) => {
        if (revision.current !== current) return;
        const updated = textNode(
          (result as { view?: DesktopNode } | undefined)?.view,
          node.action,
        );
        if (updated) {
          if (
            updated.revision !== undefined &&
            latest.current.revision !== undefined &&
            updated.revision < latest.current.revision
          )
            return;
          if (updated.revision !== undefined)
            acknowledgedRevision.current = Math.max(
              acknowledgedRevision.current,
              updated.revision,
            );
          acknowledgeVersion(updated.controlVersion);
          setValue(updated.value);
        }
      })
      .finally(() => {
        pending.current--;
        setSettled((current) => current + 1);
      });
  };
  const pasteCommand = (
    command: "copy" | "remove",
    paste: DesktopPasteSpan,
  ) => {
    if (!node.pasteAction) return;
    void enqueueExtensionEvent(async () => {
      await dispatch(node.pasteAction!, {
        command,
        start: paste.start,
        marker: paste.marker,
        text: paste.text,
      });
    });
  };
  const richPlaceholder = needsRichText(node.placeholderRuns);
  return (
    <div className="desktop-text-control">
      {node.autocomplete && (
        <Autocomplete
          text={value}
          editor={control}
          onComplete={changed}
          enabled={!node.disabled}
          keybindings={node.completionKeys}
        />
      )}
      <label className="field">
        <span
          className={
            node.appearance === "composer" ? "visually-hidden" : undefined
          }
        >
          <NodeLabel node={node} />
        </span>
        <div className="desktop-control-input">
          {node.kind === "textarea" ? (
            <textarea
              ref={(element) => {
                control.current = element;
                if (element && element.dataset.controlVersion === undefined)
                  acknowledgeVersion(node.controlVersion);
              }}
              className="desktop-textarea"
              data-composer-input={
                node.appearance === "composer" ? "" : undefined
              }
              style={{
                ...placeholderPresentation(node.placeholderStyle),
                borderColor: node.borderColor,
                paddingInline:
                  node.paddingX !== undefined
                    ? `min(${node.paddingX}ch, max(0px, calc(50% - 0.5ch)))`
                    : undefined,
              }}
              data-desktop-action={node.action}
              data-paste-spans={
                node.pastes?.length
                  ? JSON.stringify(
                      node.pastes.map(({ start, end, marker }) => ({
                        start,
                        end,
                        marker,
                      })),
                    )
                  : undefined
              }
              value={value}
              aria-label={nodeLabel(node)}
              placeholder={
                richPlaceholder
                  ? undefined
                  : node.placeholder ||
                    (node.appearance === "composer"
                      ? t("描述你的任务…")
                      : undefined)
              }
              aria-placeholder={richPlaceholder ? node.placeholder : undefined}
              disabled={node.disabled}
              onChange={(event) => changed(event.target.value)}
            />
          ) : (
            <input
              ref={(element) => {
                control.current = element;
                if (element && element.dataset.controlVersion === undefined)
                  acknowledgeVersion(node.controlVersion);
              }}
              className="desktop-input"
              style={{
                ...placeholderPresentation(node.placeholderStyle),
                borderColor: node.borderColor,
              }}
              data-desktop-action={node.action}
              type={node.secret ? "password" : "text"}
              value={value}
              aria-label={nodeLabel(node)}
              placeholder={richPlaceholder ? undefined : node.placeholder}
              aria-placeholder={richPlaceholder ? node.placeholder : undefined}
              disabled={node.disabled}
              onChange={(event) => changed(event.target.value)}
            />
          )}
          {richPlaceholder && !value && (
            <span className="desktop-rich-placeholder">
              <StyledText
                text={node.placeholder ?? ""}
                runs={node.placeholderRuns}
              />
            </span>
          )}
        </div>
      </label>
      {!!node.pastes?.length && (
        <div className="desktop-pastes" data-desktop-native-input="">
          {node.pastes
            .filter(
              (paste) => value.slice(paste.start, paste.end) === paste.marker,
            )
            .map((paste, index) => (
              <div
                className="desktop-paste-row"
                key={`${paste.start}:${paste.marker}`}
              >
                <details>
                  <summary>
                    <Clipboard size={14} />
                    <span>{paste.marker}</span>
                    <ChevronDown size={14} />
                  </summary>
                  <textarea
                    className="desktop-paste-preview"
                    aria-label={t("粘贴内容 {value1}", { value1: index + 1 })}
                    value={paste.text}
                    rows={Math.min(
                      10,
                      Math.max(3, paste.text.split("\n").length),
                    )}
                    readOnly
                  />
                </details>
                <div className="desktop-paste-tools">
                  <IconButton
                    icon={Copy}
                    label={t("复制粘贴内容 {value1}", { value1: index + 1 })}
                    disabled={node.disabled || !node.pasteAction}
                    onClick={() => pasteCommand("copy", paste)}
                  />
                  <IconButton
                    icon={Trash2}
                    label={t("移除粘贴块 {value1}", { value1: index + 1 })}
                    disabled={node.disabled || !node.pasteAction}
                    onClick={() => pasteCommand("remove", paste)}
                  />
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function NodeView({
  node,
  dispatch,
  framed,
}: {
  node: DesktopNode;
  dispatch: Dispatch;
  framed?: boolean;
}) {
  useLocale();
  const element = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useLayoutEffect(() => {
    // Replacing the presentation must not retire the original input's focus.
    if (focused.current && document.activeElement === document.body)
      element.current
        ?.querySelector<HTMLElement>("input,textarea,select,button,[tabindex]")
        ?.focus({ preventScroll: true });
  }, [
    node.kind,
    node.rendered?.replacement !== undefined,
    node.rendered?.control?.action,
  ]);
  const content = <NodeContent node={node} dispatch={dispatch} />;
  return framed || node.component || node.inert || node.rendered ? (
    <div
      ref={element}
      onFocusCapture={() => {
        focused.current = true;
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          focused.current = false;
      }}
      inert={node.inert}
      className="desktop-component"
      style={{ minWidth: 0 }}
      data-component-key={node.component?.occurrence}
      data-component-action={node.component?.action}
      data-component-columns={node.component?.columns}
    >
      <RenderedAdditions lines={node.rendered?.before} position="before" />
      {node.rendered?.replacement !== undefined ? (
        node.rendered.control ? (
          <RenderedControl rendered={node.rendered} />
        ) : (
          <RenderedAdditions
            lines={node.rendered.replacement}
            position="replacement"
          />
        )
      ) : (
        content
      )}
      <RenderedAdditions lines={node.rendered?.after} position="after" />
    </div>
  ) : (
    content
  );
}

function RenderedControl({
  rendered,
}: {
  rendered: NonNullable<DesktopNode["rendered"]>;
}) {
  useLocale();
  const input = useRef<HTMLTextAreaElement>(null);
  const { action, label: sourceLabel, cursor, desktopLabel } = rendered.control!;
  const label = desktopLabel ? localizeText(sourceLabel) : sourceLabel;
  return (
    <div
      className="desktop-render-control"
      onPointerDown={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest("a,button")
        ) {
          event.preventDefault();
          input.current?.focus({ preventScroll: true });
        }
      }}
    >
      <RenderedAdditions lines={rendered.replacement} position="replacement" />
      <textarea
        ref={input}
        aria-label={label}
        data-desktop-action={action}
        data-desktop-raw-input="true"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{ top: `${cursor?.row ?? 0}lh`, left: `${cursor?.col ?? 0}ch` }}
      />
    </div>
  );
}

function RenderedAdditions({
  lines,
  position,
  columns,
  trailing,
}: {
  lines?: NonNullable<DesktopNode["rendered"]>["before"];
  position: "before" | "after" | "replacement" | "inside";
  columns?: number;
  trailing?: boolean;
}) {
  useLocale();
  if (!lines?.length) return null;
  return (
    <div
      className={`desktop-render-additions${columns === undefined ? "" : " desktop-render-gap"}`}
      data-render-additions={position}
      data-render-columns={columns}
      style={
        columns === undefined
          ? undefined
          : trailing
            ? { flex: "1 1 0" }
            : { width: `${columns}ch`, flex: `0 0 ${columns}ch` }
      }
    >
      {lines.map((line, index) => (
        <div key={index}>
          <StyledText {...line} />
        </div>
      ))}
    </div>
  );
}

function NodeContent({
  node,
  dispatch,
}: {
  node: DesktopNode;
  dispatch: Dispatch;
}) {
  useLocale();
  switch (node.kind) {
    case "terminal":
      return (
        <ComponentTerminal
          {...node}
          onEffect={(effect, delivery) =>
            dispatch(node.action, { effect, ...delivery })
          }
          onInput={(data) => {
            void dispatch(node.action, { data });
          }}
        />
      );
    case "spacer":
      return (
        <div
          aria-hidden="true"
          style={{ height: `${Math.max(0, Math.min(100, node.lines))}lh` }}
        />
      );
    case "scroll":
      return <ScrollControl node={node} dispatch={dispatch} />;
    case "region":
      return <MouseControl node={node} dispatch={dispatch} />;
    case "text":
      return (
        <p
          className={`desktop-text${node.truncate ? " desktop-truncated" : ""}`}
          style={{
            ...nodePadding(node.padding),
            ...nodePresentation(node.style),
          }}
        >
          <StyledText text={node.text} runs={node.runs} />
        </p>
      );
    case "markdown":
      return (
        <div
          className={`markdown${node.blocks ? " desktop-markdown" : ""}`}
          style={{
            ...nodePadding(node.padding),
            ...nodePresentation(
              node.blocks
                ? { backgroundColor: node.style?.backgroundColor }
                : node.style,
            ),
          }}
        >
          {node.blocks ? (
            <ComponentMarkdown blocks={node.blocks} />
          ) : (
            <Markdown text={node.text} />
          )}
        </div>
      );
    case "image":
      return <ComponentImage key={node.src} node={node} />;
    case "divider":
      return (
        <hr
          className="desktop-divider"
          style={{ borderColor: node.style?.color }}
        />
      );
    case "row":
    case "column":
      return (
        <div
          className={`desktop-${node.kind}${node.kind === "row" && node.rendered?.composition ? " desktop-composed-row" : ""}`}
          style={{
            ...nodePadding(node.padding),
            ...nodePresentation(node.style),
            gap:
              node.kind === "row" &&
              node.rendered?.composition?.some(
                (part) => "lines" in part && part.columns !== undefined,
              )
                ? 0
                : node.gap === undefined
                  ? undefined
                  : `${node.gap}${node.kind === "row" ? "ch" : "lh"}`,
            alignItems: node.align,
            flexWrap: node.sizes ? "nowrap" : undefined,
          }}
        >
          {(
            node.rendered?.composition ??
            node.children.map((_child, child) => ({ child }))
          ).map((part, position) => {
            if ("lines" in part)
              return (
                <RenderedAdditions
                  key={`lines:${position}`}
                  lines={part.lines}
                  position="inside"
                  columns={part.columns}
                  trailing={part.trailing}
                />
              );
            const index = part.child;
            const child = node.children[index];
            return node.sizes ? (
              <div
                key={`child:${index}`}
                className="desktop-stack-child"
                style={{
                  flexBasis:
                    node.sizes[index]?.basis === "auto"
                      ? "auto"
                      : `${node.sizes[index]?.basis ?? 0}${node.kind === "row" ? "ch" : "lh"}`,
                  flexGrow: node.sizes[index]?.grow,
                  flexShrink: node.sizes[index]?.shrink,
                  [node.kind === "row" ? "minWidth" : "minHeight"]:
                    node.sizes[index]?.min === undefined
                      ? undefined
                      : `${node.sizes[index].min}${node.kind === "row" ? "ch" : "lh"}`,
                  [node.kind === "row" ? "maxWidth" : "maxHeight"]:
                    node.sizes[index]?.max === undefined
                      ? undefined
                      : `${node.sizes[index].max}${node.kind === "row" ? "ch" : "lh"}`,
                }}
              >
                <NodeView node={child} dispatch={dispatch} />
              </div>
            ) : (
              <NodeView
                key={`child:${index}`}
                node={child}
                dispatch={dispatch}
              />
            );
          })}
        </div>
      );
    case "button":
      return (
        <Button
          icon={node.icon ? icons[node.icon] : undefined}
          disabled={node.disabled}
          attributes={{
            "data-desktop-action": node.action,
            "data-desktop-mouse-kind": node.mouseControl,
            "aria-label": nodeLabel(node),
          }}
          onClick={(event) => {
            if (node.mouseControl && event.detail > 0) return;
            if (node.mouseControl) event.stopPropagation();
            void enqueueExtensionEvent(async () => {
              await dispatch(node.action);
            });
          }}
        >
          <NodeLabel node={node} />
        </Button>
      );
    case "input":
    case "textarea":
      return <TextControl node={node} dispatch={dispatch} />;
    case "select":
      if (
        node.appearance === "completion" ||
        node.options.some((option) => needsRichText(option.runs))
      )
        return (
          <ComponentSelect
            node={node}
            label={<NodeLabel node={node} />}
            onChange={(value) => {
              void enqueueExtensionEvent(async () => {
                await dispatch(node.submitAction ?? node.action, value);
              });
            }}
          />
        );
      if (node.visibleOptions)
        return (
          <label className="field">
            <span>
              <NodeLabel node={node} />
            </span>
            <select
              className="desktop-listbox"
              aria-label={nodeLabel(node)}
              data-desktop-action={node.action}
              size={node.visibleOptions}
              value={node.value}
              disabled={node.disabled}
              style={nativeOptionStyle(
                node.options.find((option) => option.value === node.value)
                  ?.style,
              )}
              onChange={(event) => {
                void dispatch(node.action, event.target.value);
              }}
            >
              {node.options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  style={nativeOptionStyle(option.style)}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        );
      return (
        <SelectField
          name={node.action}
          label={nodeLabel(node)}
          labelContent={<NodeLabel node={node} />}
          value={node.value}
          disabled={node.disabled}
          inputAttributes={{
            "data-desktop-action": node.action,
            style: nativeOptionStyle(
              node.options.find((option) => option.value === node.value)?.style,
            ),
          }}
          onChange={(value) => {
            void dispatch(node.action, value);
          }}
        >
          {node.options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              style={nativeOptionStyle(option.style)}
            >
              {option.label}
            </option>
          ))}
        </SelectField>
      );
    case "toggle":
      return (
        <label className="desktop-toggle">
          <span>
            <StyledText text={nodeLabel(node)} runs={node.labelRuns} />
          </span>
          <Switch
            name={node.action}
            checked={node.value}
            disabled={node.disabled}
            onChange={({ checked }) => {
              void dispatch(node.action, checked);
            }}
          />
        </label>
      );
    case "number":
    case "slider":
      return (
        <label className="field">
          <span>
            <StyledText text={nodeLabel(node)} runs={node.labelRuns} />
          </span>
          <input
            aria-label={nodeLabel(node)}
            type={node.kind === "slider" ? "range" : "number"}
            value={node.value}
            min={node.min}
            max={node.max}
            step={node.step}
            disabled={node.disabled}
            onChange={(event) => {
              void dispatch(node.action, Number(event.target.value));
            }}
          />
        </label>
      );
    case "tabs":
      return (
        <div className="desktop-column">
          <div role="tablist" className="desktop-tabs">
            {node.tabs.map((tab) => (
              <button
                key={tab.value}
                role="tab"
                aria-selected={node.value === tab.value}
                onClick={() => {
                  void dispatch(node.action, tab.value);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {node.tabs
              .find((tab) => tab.value === node.value)
              ?.children.map((child, index) => (
                <NodeView key={index} node={child} dispatch={dispatch} />
              ))}
          </div>
        </div>
      );
    case "table":
      return (
        <div className="desktop-table">
          <table>
            <thead>
              <tr>
                {node.columns.map((column, index) => (
                  <th key={index}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "progress":
      return (
        <label className="field">
          <span>
            <StyledText text={nodeLabel(node)} runs={node.labelRuns} />
            {node.indicator && (
              <span aria-hidden="true" className="desktop-progress-indicator">
                <StyledText {...node.indicator} />
              </span>
            )}
          </span>
          <progress
            className="desktop-progress"
            aria-label={nodeLabel(node)}
            value={node.value}
            max={node.max ?? 100}
            style={
              node.indicatorColor
                ? ({
                    accentColor: node.indicatorColor,
                    "--desktop-progress-color": node.indicatorColor,
                  } as CSSProperties)
                : undefined
            }
          />
        </label>
      );
  }
}

export function DesktopSurfaceView({
  surface,
  run,
}: {
  surface: DesktopSurface;
  run: Run;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const layoutState = useRef({ inert: !!surface.view.inert, epoch: 0 });
  if (layoutState.current.inert !== !!surface.view.inert)
    layoutState.current = {
      inert: !!surface.view.inert,
      epoch: layoutState.current.epoch + 1,
    };
  const requestedAction = surface.focusRequest?.action;
  const requestedRevision = surface.focusRequest?.revision;
  useEffect(() => {
    if (
      requestedRevision === undefined ||
      requestedAction === undefined ||
      surface.overlay?.hidden ||
      (surface.overlay && !surface.overlay.focused)
    )
      return;
    const version = mouseFocusVersion;
    const frame = requestAnimationFrame(() => {
      const element = root.current;
      if (!element?.isConnected || version !== mouseFocusVersion) return;
      if (requestedAction === null) {
        if (
          document.activeElement instanceof HTMLElement &&
          element.contains(document.activeElement)
        )
          document.activeElement.blur();
        return;
      }
      let target = element.querySelector<HTMLElement>(
        `[data-desktop-action="${CSS.escape(requestedAction)}"],[data-pointer-action="${CSS.escape(requestedAction)}"]`,
      );
      if (!target) {
        // Composite components can own SDK input without a leaf control action.
        target = element.querySelector<HTMLElement>(
          `[data-component-action="${CSS.escape(requestedAction)}"]`,
        );
        if (target) target.tabIndex = -1;
      }
      const focusable = target?.matches(
        "input,textarea,select,button,[tabindex]",
      )
        ? target
        : target?.querySelector<HTMLElement>(
            "input,textarea,select,button,[tabindex]",
          );
      if (
        focusable &&
        !focusable.matches(":disabled") &&
        focusable.getClientRects().length
      ) {
        applyingRequestedFocus = true;
        try {
          focusable.focus({ preventScroll: true });
        } finally {
          applyingRequestedFocus = false;
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    surface.instanceId,
    requestedAction,
    requestedRevision,
    surface.overlay?.hidden,
    surface.overlay?.focused,
  ]);
  const sendAction = (action: string, value?: unknown) =>
    run("desktop.action", {
      id: surface.id,
      instanceId: surface.instanceId,
      action,
      value,
    });
  const dispatch: Dispatch = Object.assign(
    async (action: string, value?: unknown) => {
      if (!action.endsWith(":layout"))
        await syncComponentScrollLayouts(root.current, sendAction);
      return sendAction(action, value);
    },
    {
      mouse: async (action: string, event: DesktopMouseEvent) => {
        await syncComponentScrollLayouts(root.current, sendAction);
        return run<DesktopMouseResult>("desktop.mouse", {
          id: surface.id,
          instanceId: surface.instanceId,
          action,
          event,
        });
      },
    },
  );
  return (
    <div
      ref={root}
      className={`desktop-extension desktop-extension-${surface.slot}`}
      data-surface-id={surface.id}
      data-instance-id={surface.instanceId}
      data-layout-epoch={layoutState.current.epoch}
      onFocusCapture={(event) => {
        if (applyingRequestedFocus || isApplyingText()) return;
        const target = componentControlOwner(event.target);
        const controlAction = target.closest<HTMLElement>(
          "[data-desktop-action],[data-pointer-action],[data-component-action]",
        );
        const action =
          controlAction?.dataset.desktopAction ??
          controlAction?.dataset.pointerAction ??
          controlAction?.dataset.componentAction;
        if (action || (surface.overlay && !surface.overlay.focused))
          void run("desktop.focus", {
            id: surface.id,
            expectedRevision: surface.terminalFocusRevision,
            ...(action && {
              controlAction: action,
              instanceId: surface.instanceId,
            }),
          });
      }}
    >
      <NodeView
        key={surface.instanceId}
        node={surface.view}
        dispatch={dispatch}
      />
    </div>
  );
}

export function DesktopSlotView({
  surfaces,
  slot,
  run,
}: {
  surfaces: DesktopSurface[];
  slot: DesktopSlot;
  run: Run;
}) {
  useLocale();
  return (
    <>
      {surfaces
        .filter((surface) => surface.slot === slot)
        .map((surface) => (
          <DesktopSurfaceView key={surface.id} surface={surface} run={run} />
        ))}
    </>
  );
}

export function DesktopExtensionDialog({
  surfaces,
  run,
  ready = true,
}: {
  surfaces: DesktopSurface[];
  run: Run;
  ready?: boolean;
}) {
  useLocale();
  const overlays = surfaces.filter(
    (surface) => surface.slot === "dialog" && surface.overlay,
  );
  const modal = surfaces.find(
    (surface) => surface.slot === "dialog" && !surface.overlay,
  );
  useEffect(() => {
    const supersedePointerFocus = (event: Event) => {
      if (!isApplyingText()) {
        mouseFocusVersion++;
        if (event.type !== "focusin") mouseInteractionVersion++;
      }
    };
    document.addEventListener("pointerdown", supersedePointerFocus, true);
    document.addEventListener("keydown", supersedePointerFocus, true);
    document.addEventListener("focusin", supersedePointerFocus, true);
    return () => {
      document.removeEventListener("pointerdown", supersedePointerFocus, true);
      document.removeEventListener("keydown", supersedePointerFocus, true);
      document.removeEventListener("focusin", supersedePointerFocus, true);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const resize = () =>
      void run("desktop.viewport", {
        width: Math.floor(innerWidth / 8),
        height: Math.floor(innerHeight / 20),
      });
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [run, ready]);
  return (
    <>
      <Modal
        key={modal?.id ?? "closed"}
        active={!!modal}
        size="640px"
        onClose={() => {
          if (modal) void run("desktop.close", { id: modal.id });
        }}
      >
        <Modal.Title>{modal?.title ?? t("扩展")}</Modal.Title>
        {modal && (
          <div className="modal-body">
            <DesktopSurfaceView surface={modal} run={run} />
            <div data-terminal-dock />
          </div>
        )}
      </Modal>
      {overlays.map((surface) => (
        <DesktopOverlayView key={surface.id} surface={surface} run={run} />
      ))}
    </>
  );
}

function DesktopOverlayView({
  surface,
  run,
}: {
  surface: DesktopSurface;
  run: Run;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const bounds = surface.overlay?.bounds;
  useEffect(() => {
    const element = root.current;
    const layoutKey = surface.overlay?.layoutKey;
    if (!element || !layoutKey || surface.overlay?.hidden) return;
    let last = -1;
    const measure = () => {
      const rows =
        surface.overlay?.viewport?.height ??
        Math.max(1, Math.floor(innerHeight / 20));
      const line = innerHeight / rows;
      const height = Math.ceil(element.getBoundingClientRect().height / line);
      if (height === last) return;
      last = height;
      void run("desktop.overlay.measure", {
        id: surface.id,
        instanceId: surface.instanceId,
        layoutKey,
        height,
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const content = element.querySelector(".desktop-extension");
    if (content) observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [
    surface.id,
    surface.instanceId,
    surface.overlay?.layoutKey,
    surface.overlay?.hidden,
    run,
  ]);
  useEffect(() => {
    const element = root.current;
    if (
      !surface.overlay?.focused ||
      surface.overlay.hidden ||
      !element ||
      element.contains(document.activeElement)
    )
      return;
    applyingRequestedFocus = true;
    try {
      (
        element.querySelector<HTMLElement>("input,textarea,select") ??
        element.querySelector<HTMLElement>("button,[tabindex]") ??
        element
      ).focus({ preventScroll: true });
    } finally {
      applyingRequestedFocus = false;
    }
  }, [surface.overlay?.focused, surface.overlay?.hidden]);
  if (surface.overlay?.hidden || !bounds) return null;
  const columns =
    surface.overlay?.viewport?.width ?? Math.max(1, Math.floor(innerWidth / 8));
  const rows =
    surface.overlay?.viewport?.height ??
    Math.max(1, Math.floor(innerHeight / 20));
  return (
    <div
      ref={root}
      className="desktop-overlay"
      role="dialog"
      aria-label={surface.title ?? t("扩展")}
      tabIndex={-1}
      style={{
        left: `${(bounds.col / columns) * 100}%`,
        top: `${(bounds.row / rows) * 100}%`,
        width: `${(bounds.width / columns) * 100}%`,
        maxHeight: `${((surface.overlay?.maxHeight ?? rows) / rows) * 100}%`,
        zIndex: 1000 + (surface.overlay?.order ?? 0),
      }}
    >
      <div className="desktop-overlay-title">
        <strong>{surface.title ?? t("扩展")}</strong>
        <IconButton
          icon={X}
          label={t("关闭扩展")}
          onClick={() => void run("desktop.close", { id: surface.id })}
        />
      </div>
      <DesktopSurfaceView surface={surface} run={run} />
    </div>
  );
}
