import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { DesktopSnapshot } from "../shared/types";
import type { DesktopKeyEvent, DesktopInputResult } from "../shared/desktop-ui";
import { normalizePasteSelection } from "../shared/paste-selection";
import { committedInputContext as committedContext } from "../shared/committed-input";
import {
  desktopKeyId,
  desktopKeyFromId,
  encodeDesktopKey,
  encodeDesktopText,
  decodeDesktopText,
} from "../shared/keyboard";
import { action } from "./client";
import type { Run } from "./Workspace";
import { enqueueExtensionEvent } from "./extensionEvents";
import { measureEditorLayout, moveEditorVertically } from "./editor-layout";
import {
  componentControlOwner,
  componentControlVersion,
  syncComponentScrollLayouts,
} from "./component-dom";
import { collapseEditorSelection } from "../shared/editor-navigation";
import {
  applyText,
  replaceText as replace,
  isNativeInsertion,
} from "./textEditing";

type TextControl = HTMLTextAreaElement | HTMLInputElement;
const isText = (target: Element): target is TextControl =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement &&
    !["checkbox", "radio", "button", "submit", "range", "number"].includes(
      target.type,
    ));
const replayed = new WeakSet<Event>();
const isRaw = (target: HTMLElement) =>
  target.dataset.desktopRawInput === "true";
export function applyEditorResult(
  target: HTMLElement,
  result: DesktopInputResult,
  provisional = false,
) {
  if (isRaw(target)) {
    if (isText(target) && !target.dataset.piComposing) target.value = "";
    return;
  }
  if (result.dialogFocus !== undefined)
    target
      .closest("[data-dialog-id]")
      ?.querySelector<HTMLElement>(
        `[data-dialog-option="${result.dialogFocus}"]`,
      )
      ?.focus();
  if (result.dialogInsert !== undefined && isText(target))
    replace(target, result.dialogInsert);
  if (!result.editor || !isText(target)) return;
  // Commit the controlled value before the next queued key reads the DOM.
  flushSync(() => {
    // A submission/listener can move SDK focus before this acknowledgement
    // arrives. Updating its old field must not reclaim the recipient's focus.
    if (provisional || document.activeElement !== target) {
      const prototype =
        target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        target,
        result.editor!.text,
      );
    } else applyText(target, result.editor!.text);
    target.dispatchEvent(
      new CustomEvent("pi:editor-transaction", { detail: result.editor }),
    );
  });
  target.setSelectionRange(
    result.editor.selection.start,
    result.editor.selection.end,
  );
}
function inputContext(target: HTMLElement) {
  const raw = isRaw(target);
  if (isText(target) && target.dataset.pasteSpans) {
    const selection = normalizePasteSelection(
      target.value,
      { start: target.selectionStart ?? 0, end: target.selectionEnd ?? 0 },
      JSON.parse(target.dataset.pasteSpans),
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
  }
  const owner = componentControlOwner(target);
  const surfaceId =
    owner.closest<HTMLElement>("[data-surface-id]")?.dataset.surfaceId;
  return {
    surfaceId,
    dialogId: target.closest<HTMLElement>("[data-dialog-id]")?.dataset.dialogId,
    dialogTarget: isText(target)
      ? "text"
      : target.closest("[data-dialog-option]")
        ? "option"
        : "native",
    dialogIndex: target.closest<HTMLElement>("[data-dialog-option]")
      ? Number(
          target.closest<HTMLElement>("[data-dialog-option]")!.dataset
            .dialogOption,
        )
      : undefined,
    controlAction:
      target.dataset.desktopAction ??
      target.closest<HTMLElement>("[data-desktop-action]")?.dataset
        .desktopAction,
    raw,
    controlText: isText(target) && !raw ? target.value : undefined,
    controlVersion: componentControlVersion(target),
    controlReadOnly: isText(target) ? target.readOnly : undefined,
    instanceId:
      owner.closest<HTMLElement>("[data-surface-id]")?.dataset.instanceId,
    autocompleteActive: target.dataset.autocompleteActive === "true",
    selection:
      isText(target) && !raw
        ? { start: target.selectionStart ?? 0, end: target.selectionEnd ?? 0 }
        : undefined,
    editorLayout:
      isText(target) && !raw ? measureEditorLayout(target) : undefined,
    editorText:
      isText(target) &&
      !raw &&
      (surfaceId === "editor" || target.hasAttribute("data-message-composer"))
        ? target.value
        : undefined,
  };
}
type InputContext = ReturnType<typeof inputContext>;
type Composition = {
  context: InputContext;
  sessionId: string;
  previous?: Composition;
  committedData?: string;
  finalInputSeen?: boolean;
  optimisticText?: string;
  editor?: NonNullable<DesktopInputResult["editor"]>;
};
function capturesInput(state: DesktopSnapshot, target: HTMLElement) {
  if (target.closest("[data-desktop-native-input]")) return false;
  const { surfaceId } = inputContext(target);
  return (
    !!target.closest("[data-dialog-id]") ||
    state.extensionUI.inputListeners > 0 ||
    state.desktopSurfaces.some(
      (surface) => surface.id === surfaceId && surface.acceptsKeys,
    )
  );
}

function move(
  control: TextControl,
  key: string,
  shift: boolean,
  word: boolean,
  visual = true,
) {
  if (
    control instanceof HTMLTextAreaElement &&
    ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(key)
  ) {
    moveEditorVertically(control, key, shift);
    return;
  }
  const value = control.value;
  const start = control.selectionStart ?? 0,
    end = control.selectionEnd ?? start;
  const cursor = control.selectionDirection === "backward" ? start : end;
  const boundaries = [
    ...new Intl.Segmenter(undefined, {
      granularity: word ? "word" : "grapheme",
    }).segment(value),
  ]
    .map((part) => part.index)
    .concat(value.length);
  let position = cursor;
  if (
    !word &&
    !shift &&
    start !== end &&
    (key === "ArrowLeft" || key === "ArrowRight")
  ) {
    const collapsed = collapseEditorSelection(
      { start, end },
      key === "ArrowRight",
      measureEditorLayout(control),
    );
    control.setSelectionRange(collapsed, collapsed);
    return;
  }
  if (visual && getComputedStyle(control).direction === "rtl") {
    if (key === "ArrowLeft") key = "ArrowRight";
    else if (key === "ArrowRight") key = "ArrowLeft";
  }
  if (key === "ArrowLeft")
    position =
      !shift && start !== end
        ? start
        : (boundaries.filter((index) => index < cursor).at(-1) ?? 0);
  if (key === "ArrowRight")
    position =
      !shift && start !== end
        ? end
        : (boundaries.find((index) => index > cursor) ?? value.length);
  const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
  const lineEnd = value.indexOf("\n", cursor);
  if (key === "Home") position = word ? 0 : lineStart;
  if (key === "End")
    position = word ? value.length : lineEnd < 0 ? value.length : lineEnd;
  if (key === "ArrowUp" || key === "PageUp") {
    const previous = value.lastIndexOf("\n", lineStart - 2) + 1;
    position =
      lineStart === 0
        ? 0
        : previous + Math.min(cursor - lineStart, lineStart - previous - 1);
  }
  if (key === "ArrowDown" || key === "PageDown") {
    const next = lineEnd < 0 ? value.length : lineEnd + 1;
    const nextEnd = value.indexOf("\n", next);
    position =
      next +
      Math.min(
        cursor - lineStart,
        (nextEnd < 0 ? value.length : nextEnd) - next,
      );
  }
  const anchor = control.selectionDirection === "backward" ? end : start;
  control.setSelectionRange(
    shift ? Math.min(anchor, position) : position,
    shift ? Math.max(anchor, position) : position,
    position < anchor ? "backward" : "forward",
  );
}
async function nativeDefault(
  target: HTMLElement,
  event: DesktopKeyEvent,
  text?: string,
) {
  if (isText(target)) {
    if (target.disabled || target.readOnly) return;
    const start = target.selectionStart ?? 0,
      end = target.selectionEnd ?? start;
    if (text !== undefined) {
      replace(target, text);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "a") {
        target.select();
        return;
      }
      if (key === "c" || key === "x") {
        await navigator.clipboard.writeText(target.value.slice(start, end));
        if (key === "x") replace(target, "");
        return;
      }
      if (key === "z" || key === "y") {
        document.execCommand(key === "y" || event.shiftKey ? "redo" : "undo");
        return;
      }
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      if (start !== end) {
        replace(target, "");
        return;
      }
      move(
        target,
        event.key === "Backspace" ? "ArrowLeft" : "ArrowRight",
        true,
        !!event.ctrlKey,
        false,
      );
      replace(target, "");
      return;
    }
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      move(
        target,
        event.key,
        !!event.shiftKey,
        !!(event.ctrlKey || event.metaKey),
      );
      return;
    }
    if (event.key === "Enter" && target instanceof HTMLTextAreaElement) {
      replace(target, "\n");
      return;
    }
    if (
      Array.from(event.key).length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      replace(target, event.key);
      return;
    }
  }
  if (
    target instanceof HTMLSelectElement &&
    ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
  ) {
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? target.options.length - 1
          : target.selectedIndex + (event.key === "ArrowUp" ? -1 : 1);
    target.selectedIndex = Math.max(
      0,
      Math.min(target.options.length - 1, index),
    );
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (
    (event.key === "Enter" || event.key === " ") &&
    target.matches("button,input[type=checkbox],input[type=radio]")
  ) {
    target.click();
    return;
  }
  if (event.key === "Tab") {
    const scope = target.closest('[role="dialog"]') ?? document;
    const controls = [
      ...scope.querySelectorAll<HTMLElement>(
        "button,input,textarea,select,a[href],[tabindex]",
      ),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(":disabled") &&
        element.getClientRects().length,
    );
    const index = controls.indexOf(target);
    controls[
      (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
    ]?.focus();
  }
}

export function useExtensionInput(
  snapshot: DesktopSnapshot | undefined,
  run: Run,
) {
  const current = useRef(snapshot);
  current.current = snapshot;
  useEffect(() => {
    const pointerSelections = new WeakMap<HTMLElement, number>();
    const recordPointerSelection = (event: PointerEvent) => {
      if (event.target instanceof HTMLElement && isText(event.target))
        pointerSelections.set(event.target, (pointerSelections.get(event.target) ?? 0) + 1);
    };
    document.addEventListener("pointerdown", recordPointerSelection, true);
    const sendInput = async <T extends DesktopInputResult>(
      target: HTMLElement,
      args: Record<string, unknown>,
    ): Promise<T> => {
      const pointerRevision = pointerSelections.get(target) ?? 0;
      const owner = componentControlOwner(target);
      const surface = owner.closest<HTMLElement>("[data-surface-id]");
      await syncComponentScrollLayouts(owner, (controlAction, value) =>
        action("desktop.action", {
          id: surface?.dataset.surfaceId,
          instanceId: surface?.dataset.instanceId,
          action: controlAction,
          value,
        }),
      );
      const result = await action<T>("desktop.input", args);
      // The user may place the caret while this keyboard request is in flight.
      // Keep that newer selection when the response has no text change.
      if (
        result.editor && isText(target) &&
        (pointerSelections.get(target) ?? 0) !== pointerRevision &&
        result.editor.text === target.value
      ) {
        return { ...result, editor: { ...result.editor, selection: {
          start: target.selectionStart ?? 0,
          end: target.selectionEnd ?? 0,
        } } };
      }
      return result;
    };
    const compositions = new WeakMap<TextControl, Composition>();
    const pendingCompositions = new WeakMap<TextControl, Composition>();
    const pendingInsertions = new WeakMap<TextControl, Composition>();
    const endingInputs = new WeakMap<TextControl, Composition>();
    const externalDialogs = new WeakSet<TextControl>();
    const enqueue = (task: () => Promise<void>) => {
      void enqueueExtensionEvent(task).catch((error) => console.error(error));
    };
    const insertText = (
      target: TextControl,
      data: string,
      sessionId: string,
    ) => {
      if (
        target.dataset.desktopAction?.startsWith("component:") &&
        !isRaw(target) &&
        !pendingCompositions.has(target)
      ) {
        const context = inputContext(target);
        const start = context.selection?.start ?? 0;
        const end = context.selection?.end ?? start;
        const text = context.controlText ?? "";
        const insertion: Composition = {
          context,
          sessionId,
          committedData: data,
          previous: pendingInsertions.get(target),
          optimisticText: text.slice(0, start) + data + text.slice(end),
        };
        pendingInsertions.set(target, insertion);
        target.dataset.piInputPending = "true";
        applyEditorResult(
          target,
          {
            consume: true,
            editor: {
              text: insertion.optimisticText!,
              selection: {
                start: start + data.length,
                end: start + data.length,
              },
            },
          },
          true,
        );
        enqueue(async () => {
          try {
            if (!target.isConnected || current.current?.sessionId !== sessionId)
              return;
            const actual = committedContext(context, insertion.previous);
            insertion.previous = undefined;
            const result = await sendInput<DesktopInputResult>(target, {
              sessionId,
              data: encodeDesktopText(data),
              ...actual,
            });
            const value = actual.controlText ?? "";
            const range = actual.selection ?? { start: 0, end: 0 };
            const inserted = decodeDesktopText(result.data ?? data);
            insertion.editor =
              result.editor ??
              (result.consume
                ? { text: value, selection: range }
                : {
                    text:
                      value.slice(0, range.start) +
                      inserted +
                      value.slice(range.end),
                    selection: {
                      start: range.start + inserted.length,
                      end: range.start + inserted.length,
                    },
                  });
            if (
              !target.isConnected ||
              current.current?.sessionId !== sessionId ||
              pendingInsertions.get(target) !== insertion ||
              pendingCompositions.has(target)
            )
              return;
            const selected = committedContext(inputContext(target), insertion);
            applyEditorResult(target, {
              consume: true,
              editor: {
                ...insertion.editor,
                selection: selected.selection ?? insertion.editor.selection,
              },
            });
          } finally {
            if (pendingInsertions.get(target) === insertion) {
              pendingInsertions.delete(target);
              delete target.dataset.piInputPending;
              target.dispatchEvent(new Event("pi:composition-settled"));
            }
          }
        });
        return;
      }
      enqueue(async () => {
        if (!target.isConnected || current.current?.sessionId !== sessionId)
          return;
        const context = inputContext(target);
        const result = await sendInput<DesktopInputResult>(target, {
          sessionId,
          data: encodeDesktopText(data),
          ...context,
        });
        if (!target.isConnected || current.current?.sessionId !== sessionId)
          return;
        applyEditorResult(target, result);
        if (!result.consume && result.data !== undefined)
          replace(
            target,
            decodeDesktopText(result.data),
            context.selection?.start,
            context.selection?.end,
          );
      });
    };
    const keydown = (native: KeyboardEvent) => {
      if (
        replayed.has(native) ||
        native.isComposing ||
        // IMEs can emit punctuation with a printable key and isComposing=false.
        // Its text arrives through beforeinput/compositionend, not this key.
        native.keyCode === 229 ||
        native.key === "Process"
      )
        return;
      const state = current.current;
      if (!state || !(native.target instanceof HTMLElement)) return;
      let target = native.target;
      // Control replacement can leave focus on body; a text-only modal can
      // focus its surrounding focus-trap container. Route those keys to the
      // sole extension modal, without taking keys from sibling controls or
      // guessing when a separate SDK prompt is also open.
      if (!target.closest("[data-surface-id]")) {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        if (dialogs.length === 1 && target.contains(dialogs[0])) {
          const surface =
            dialogs[0].querySelector<HTMLElement>("[data-surface-id]");
          if (surface) target = surface;
        }
      }
      if (target.closest("[data-desktop-native-input]")) return;
      const event: DesktopKeyEvent = {
        key: native.key,
        type: native.type === "keyup" ? "release" : "press",
        code: native.code,
        ctrlKey: native.ctrlKey,
        altKey: native.altKey,
        shiftKey: native.shiftKey,
        metaKey: native.metaKey,
        repeat: native.repeat,
      };
      if (!encodeDesktopKey(event)) return;
      // Clipboard paste reaches listeners as bracketed text, matching terminal paste input.
      if (
        event.type !== "release" &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "v"
      )
        return;
      const surfaceId =
        componentControlOwner(target).closest<HTMLElement>("[data-surface-id]")
          ?.dataset.surfaceId;
      const captures =
        !!target.closest("[data-dialog-id]") ||
        state.extensionUI.inputListeners > 0 ||
        (!!surfaceId &&
          state.desktopSurfaces.some(
            (surface) => surface.id === surfaceId && surface.acceptsKeys,
          )) ||
        state.extensionUI.shortcuts.some(
          (shortcut) =>
            shortcut.split("+").sort().join("+") ===
            desktopKeyId(event).split("+").sort().join("+"),
        );
      if (!captures) return;
      native.preventDefault();
      native.stopImmediatePropagation();
      enqueue(async () => {
        if (
          !target.isConnected ||
          current.current?.sessionId !== state.sessionId
        )
          return;
        // Earlier queued navigation may already have moved this dialog's focus.
        const active = document.activeElement;
        const dialog = target.closest("[data-dialog-id]");
        if (
          target.closest("[data-dialog-option]") &&
          active instanceof HTMLElement &&
          active.closest("[data-dialog-option]") &&
          active.closest("[data-dialog-id]") === dialog
        )
          target = active;
        const result = await sendInput<
          DesktopInputResult & {
            changed?: boolean;
            data?: string;
            keyId?: string;
            repeat?: boolean;
          }
        >(target, {
          event,
          sessionId: state.sessionId,
          ...inputContext(target),
        });
        if (
          !target.isConnected ||
          current.current?.sessionId !== state.sessionId
        )
          return;
        applyEditorResult(target, result);
        if (
          result.dialogExternal &&
          isText(target) &&
          !externalDialogs.has(target)
        ) {
          const control = target;
          const id =
            control.closest<HTMLElement>("[data-dialog-id]")?.dataset.dialogId;
          if (id) {
            const initial = control.value;
            const readOnly = control.readOnly;
            let changed = false;
            const onInput = () => {
              changed = true;
            };
            externalDialogs.add(control);
            control.readOnly = true;
            control.addEventListener("input", onInput);
            void run<{ text?: string; cancelled?: boolean }>(
              "dialog.external",
              { id, text: initial },
            )
              .then((result) => {
                if (
                  result?.text !== undefined &&
                  !changed &&
                  control.isConnected &&
                  current.current?.sessionId === state.sessionId &&
                  control.value === initial
                ) {
                  control.readOnly = readOnly;
                  applyText(control, result.text);
                }
              })
              .finally(() => {
                control.removeEventListener("input", onInput);
                control.readOnly = readOnly;
                externalDialogs.delete(control);
              });
          }
        }
        if (result.consume) return;
        if (event.type === "release" && !result.changed) return;
        let replay = event;
        let inserted: string | undefined;
        if (result.changed) {
          if (result.data && !/[\x00-\x1f\x7f]/.test(result.data))
            inserted = result.data;
          else if (result.keyId) {
            const decoded = desktopKeyFromId(result.keyId);
            if (!decoded) return;
            replay = { ...decoded, type: "press", repeat: result.repeat };
          } else return;
        }
        if (inserted === undefined) {
          const dom = new KeyboardEvent("keydown", {
            ...replay,
            bubbles: true,
            cancelable: true,
          });
          replayed.add(dom);
          if (!target.dispatchEvent(dom)) return;
        }
        await nativeDefault(target, replay, inserted);
      });
    };
    const paste = (event: ClipboardEvent) => {
      if (
        !current.current ||
        !(event.target instanceof HTMLElement) ||
        !isText(event.target) ||
        !capturesInput(current.current, event.target) ||
        event.clipboardData?.files.length
      )
        return;
      const target = event.target,
        value = event.clipboardData?.getData("text/plain") ?? "";
      const sessionId = current.current.sessionId;
      event.preventDefault();
      if (isRaw(target)) event.stopImmediatePropagation();
      enqueue(async () => {
        if (!target.isConnected || current.current?.sessionId !== sessionId)
          return;
        const context = inputContext(target);
        const result = await sendInput<DesktopInputResult>(target, {
          sessionId,
          data: `\x1b[200~${value}\x1b[201~`,
          ...context,
        });
        if (!target.isConnected || current.current?.sessionId !== sessionId)
          return;
        applyEditorResult(target, result);
        if (!result.consume && result.data)
          replace(
            target,
            result.data.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, ""),
            context.selection?.start,
            context.selection?.end,
          );
      });
    };
    const beforeinput = (event: InputEvent) => {
      const state = current.current;
      if (
        isNativeInsertion() ||
        event.isComposing ||
        !event.cancelable ||
        !state ||
        !(event.target instanceof HTMLElement) ||
        !isText(event.target) ||
        !capturesInput(state, event.target)
      )
        return;
      const target = event.target;
      if (compositions.has(target)) return;
      const pending = pendingCompositions.get(target);
      if (
        pending &&
        !pending.finalInputSeen &&
        (event.inputType === "insertFromComposition" ||
          event.inputType === "insertCompositionText" ||
          (event.inputType === "insertText" &&
            event.data === pending.committedData))
      ) {
        endingInputs.set(target, pending);
        return;
      }
      const keys: Record<string, string> = {
        deleteContentBackward: "Backspace",
        deleteContentForward: "Delete",
        insertLineBreak: "Enter",
        insertParagraph: "Enter",
      };
      if (keys[event.inputType]) {
        event.preventDefault();
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: keys[event.inputType],
            bubbles: true,
            cancelable: true,
          }),
        );
        return;
      }
      if (event.inputType !== "insertText" || !event.data) return;
      event.preventDefault();
      insertText(target, event.data, state.sessionId);
    };
    const input = (event: Event) => {
      if (
        event.target instanceof HTMLElement &&
        isRaw(event.target) &&
        current.current &&
        capturesInput(current.current, event.target)
      )
        event.stopImmediatePropagation();
      if (
        !(event instanceof InputEvent) ||
        isNativeInsertion() ||
        event.isComposing ||
        !(event.target instanceof HTMLElement) ||
        !isText(event.target)
      )
        return;
      const active = compositions.get(event.target);
      const pending = active ?? pendingCompositions.get(event.target);
      const ending = endingInputs.get(event.target);
      endingInputs.delete(event.target);
      if (
        pending &&
        (active ||
          event.inputType === "insertFromComposition" ||
          event.inputType === "insertCompositionText" ||
          event.data === pending.committedData)
      )
        pending.finalInputSeen = true;
      // A commit repeats the already displayed text; a subsequent insertion changes it.
      if (
        ending &&
        ending === pending &&
        !active &&
        event.data &&
        event.target.value !== ending.optimisticText
      )
        insertText(event.target, event.data, ending.sessionId);
    };
    const compositionstart = (event: CompositionEvent) => {
      if (
        !current.current ||
        !(event.target instanceof HTMLElement) ||
        !isText(event.target) ||
        !capturesInput(current.current, event.target)
      )
        return;
      const previous =
        pendingCompositions.get(event.target) ??
        pendingInsertions.get(event.target);
      endingInputs.delete(event.target);
      const composition: Composition = {
        context: inputContext(event.target),
        sessionId: current.current.sessionId,
        previous:
          previous?.sessionId === current.current.sessionId
            ? previous
            : undefined,
      };
      compositions.set(event.target, composition);
      pendingCompositions.set(event.target, composition);
      event.target.dataset.piComposing = "true";
      if (isRaw(event.target)) event.stopImmediatePropagation();
    };
    const compositionend = (event: CompositionEvent) => {
      if (!(event.target instanceof HTMLElement) || !isText(event.target))
        return;
      const target = event.target,
        composition = compositions.get(target);
      if (!composition) return;
      if (isRaw(target)) event.stopImmediatePropagation();
      compositions.delete(target);
      const data = event.data;
      composition.committedData = data;
      const initial = composition.context;
      composition.optimisticText = data
        ? (initial.controlText ?? "").slice(0, initial.selection?.start ?? 0) +
          data +
          (initial.controlText ?? "").slice(initial.selection?.end ?? 0)
        : (initial.controlText ?? "");
      enqueue(async () => {
        try {
          if (
            !target.isConnected ||
            current.current?.sessionId !== composition.sessionId
          )
            return;
          const context = committedContext(
            composition.context,
            composition.previous,
          );
          composition.previous = undefined;
          const original = {
            text: context.controlText ?? "",
            selection: context.selection ?? { start: 0, end: 0 },
          };
          const result = data
            ? await sendInput<DesktopInputResult>(target, {
                sessionId: composition.sessionId,
                data: encodeDesktopText(data),
                ...context,
              })
            : { consume: true };
          if (
            !target.isConnected ||
            current.current?.sessionId !== composition.sessionId
          )
            return;
          const inserted = decodeDesktopText(result.data ?? data);
          const caret = original.selection.start + inserted.length;
          composition.editor =
            result.editor ??
            (result.consume
              ? original
              : {
                  text:
                    original.text.slice(0, original.selection.start) +
                    inserted +
                    original.text.slice(original.selection.end),
                  selection: { start: caret, end: caret },
                });
          if (pendingCompositions.get(target) !== composition) return;
          applyEditorResult(target, {
            consume: true,
            editor: result.editor ?? original,
          });
          if (!result.editor && !result.consume) {
            delete target.dataset.piComposing;
            replace(
              target,
              inserted,
              context.selection?.start,
              context.selection?.end,
            );
          }
        } finally {
          if (pendingCompositions.get(target) === composition) {
            pendingCompositions.delete(target);
            if (endingInputs.get(target) === composition)
              endingInputs.delete(target);
            delete target.dataset.piComposing;
            if (isRaw(target)) target.value = "";
            target.dispatchEvent(new Event("pi:composition-settled"));
          }
        }
      });
    };
    const compositionupdate = (event: CompositionEvent) => {
      if (
        event.target instanceof HTMLElement &&
        isText(event.target) &&
        isRaw(event.target) &&
        compositions.has(event.target)
      )
        event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keydown, true);
    window.addEventListener("paste", paste, true);
    window.addEventListener("beforeinput", beforeinput, true);
    window.addEventListener("input", input, true);
    window.addEventListener("compositionstart", compositionstart, true);
    window.addEventListener("compositionupdate", compositionupdate, true);
    window.addEventListener("compositionend", compositionend, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keydown, true);
      window.removeEventListener("paste", paste, true);
      window.removeEventListener("beforeinput", beforeinput, true);
      window.removeEventListener("input", input, true);
      window.removeEventListener("compositionstart", compositionstart, true);
      window.removeEventListener("compositionupdate", compositionupdate, true);
      window.removeEventListener("compositionend", compositionend, true);
      document.removeEventListener("pointerdown", recordPointerSelection, true);
    };
  }, [run]);
}
