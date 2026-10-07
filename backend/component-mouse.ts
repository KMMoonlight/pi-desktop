import type {
  DesktopMouseEvent,
  DesktopMouseResult,
} from "../shared/desktop-ui.ts";
import type { PiComponent, PiMouseEvent } from "./component-runtime.ts";
import type {
  PiMouseApi,
  PiMouseTarget,
  PiMouseDispatchResult,
} from "./tui-api.ts";

interface Gesture {
  target: PiMouseTarget;
  capture?: PiMouseTarget;
  press?: { x: number; y: number };
  moved: boolean;
  native?: boolean;
  selection?: boolean;
}

/** Keep Pi's concrete dispatch targets across DOM gestures and asynchronous replies. */
export class ComponentMouseBridge {
  private gestures = new Map<number, Gesture>();
  private lastClick?: {
    component: PiComponent;
    x: number;
    y: number;
    timestamp: number;
    count: number;
  };
  constructor(
    private api: PiMouseApi,
    private focus: (component: PiComponent) => {
      action: string;
      changed: boolean;
    },
  ) {}

  cancel(pointerId: number) {
    this.gestures.delete(pointerId);
  }
  retain(components: Set<PiComponent>) {
    for (const [pointerId, gesture] of this.gestures)
      if (
        !components.has(gesture.target.component) ||
        (gesture.capture && !components.has(gesture.capture.component))
      )
        this.cancel(pointerId);
    if (this.lastClick && !components.has(this.lastClick.component))
      this.lastClick = undefined;
  }
  clear() {
    this.gestures.clear();
    this.lastClick = undefined;
  }
  dispatch(
    component: PiComponent,
    input: DesktopMouseEvent,
    nativeTargets?: Map<PiComponent, PiMouseTarget>,
  ): DesktopMouseResult {
    const { pointerId, cancelled, nativeControl, nativeLink, ...event } = input;
    if (!Number.isSafeInteger(pointerId) || pointerId < 0)
      throw new Error("Invalid desktop pointer ID");
    if (event.type === "press") this.cancel(pointerId);
    let gesture = this.gestures.get(pointerId);
    if (
      gesture?.press &&
      (event.screenX !== gesture.press.x || event.screenY !== gesture.press.y)
    ) {
      gesture.moved = true;
      this.lastClick = undefined;
    }
    const target =
      gesture &&
      !gesture.selection &&
      (event.type === "drag" ||
        event.type === "move" ||
        event.type === "release")
        ? (gesture.capture ?? gesture.target)
        : undefined;
    const result = target
      ? this.dispatchTo(target, event, nativeTargets)
      : this.api.dispatchMouseEvent(component, event);
    const reply: DesktopMouseResult = {
      handled: !!result || !!target,
      capture: false,
      render: false,
    };
    const apply = (
      next: PiMouseDispatchResult | undefined,
      mouse: PiMouseEvent,
    ) => {
      if (!next) return;
      reply.handled = true;
      let focusChanged = false;
      if (next.focus) {
        const focused = this.focus(next.focusTarget ?? next.target.component);
        reply.focusAction = focused.action;
        focusChanged = focused.changed;
      }
      if (next.capture) {
        gesture ??= { target: next.target, moved: false };
        gesture.capture = next.target;
        this.gestures.set(pointerId, gesture);
      }
      reply.render ||=
        next.render ??
        (focusChanged ||
          ["press", "click", "drag", "wheel"].includes(mouse.type));
    };
    apply(result, event);
    if (event.type === "press" && (result || nativeControl)) {
      gesture = {
        target: result?.target ?? {
          component,
          originX: event.screenX - event.x,
          originY: event.screenY - event.y,
          width: event.width,
          height: event.height,
        },
        capture: result?.capture ? result.target : undefined,
        press: { x: event.screenX, y: event.screenY },
        moved: false,
        native: !!nativeControl,
      };
      this.gestures.set(pointerId, gesture);
    } else if (
      event.type === "press" &&
      event.button === "left" &&
      !nativeLink
    ) {
      // Pi's text-selection path dispatches an unhandled stationary press as a click.
      gesture = {
        target: {
          component,
          originX: event.screenX - event.x,
          originY: event.screenY - event.y,
          width: event.width,
          height: event.height,
        },
        press: { x: event.screenX, y: event.screenY },
        moved: false,
        selection: true,
      };
      this.gestures.set(pointerId, gesture);
    }
    if (event.type === "release") {
      // Handled presses use the press target; selection clicks use the current layout.
      if (!cancelled && gesture?.press && !gesture.moved) {
        const now = Date.now(),
          previous = this.lastClick;
        const count =
          previous &&
          now - previous.timestamp <= 500 &&
          previous.component === gesture.target.component &&
          previous.x === event.screenX &&
          previous.y === event.screenY
            ? (previous.count % 3) + 1
            : 1;
        this.lastClick = {
          component: gesture.target.component,
          x: event.screenX,
          y: event.screenY,
          timestamp: now,
          count,
        };
        const click = { ...event, type: "click" as const, clickCount: count };
        apply(
          gesture.selection
            ? this.api.dispatchMouseEvent(component, click)
            : this.dispatchTo(gesture.target, click, nativeTargets),
          click,
        );
      }
      this.cancel(pointerId);
      if (cancelled) this.lastClick = undefined;
      gesture = undefined;
    }
    reply.capture = !!gesture?.capture;
    reply.retainPointer =
      !!gesture && !gesture.selection && (!gesture.native || reply.capture);
    return reply;
  }
  private dispatchTo(
    target: PiMouseTarget,
    event: PiMouseEvent,
    nativeTargets?: Map<PiComponent, PiMouseTarget>,
  ) {
    return this.api.dispatchMouseEvent(
      target.component,
      this.api.retargetMouseEvent(
        event,
        nativeTargets?.get(target.component) ?? target,
      ),
    );
  }
}
