export type TextControl = HTMLTextAreaElement | HTMLInputElement;
let inserting = false;
let applying = false;
export function isNativeInsertion() {
  return inserting;
}
export function isApplyingText() {
  return applying;
}

export function replaceText(
  control: TextControl,
  text: string,
  start = control.selectionStart ?? 0,
  end = control.selectionEnd ?? start,
) {
  control.focus();
  control.setSelectionRange(start, end);
  // Chromium insertion records a native undo transaction and emits React's input event.
  inserting = true;
  try {
    if (document.execCommand("insertText", false, text)) return;
  } finally {
    inserting = false;
  }
  const value = control.value.slice(0, start) + text + control.value.slice(end);
  const proto =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(control, value);
  control.setSelectionRange(start + text.length, start + text.length);
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

export function applyText(control: TextControl, next: string) {
  const previous = control.value;
  if (previous === next) return;
  let start = 0,
    end = previous.length,
    nextEnd = next.length;
  while (start < end && start < nextEnd && previous[start] === next[start])
    start++;
  while (
    end > start &&
    nextEnd > start &&
    previous[end - 1] === next[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  applying = true;
  try {
    replaceText(control, next.slice(start, nextEnd), start, end);
  } finally {
    applying = false;
  }
}
