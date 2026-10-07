import { useEffect, useRef, type RefObject } from "react";
import { isApplyingText } from "./textEditing";

type TextControl = HTMLTextAreaElement | HTMLInputElement;

export function useTextSelection(
  control: RefObject<TextControl | null>,
  onSelect: (control: TextControl) => void,
) {
  const callback = useRef(onSelect);
  callback.current = onSelect;
  useEffect(() => {
    let previous: string | undefined;
    const selected = () => {
      if (isApplyingText()) return;
      const target = control.current;
      if (!target || document.activeElement !== target) return;
      const next = JSON.stringify([
        target.value,
        target.selectionStart,
        target.selectionEnd,
      ]);
      if (next === previous) return;
      previous = next;
      callback.current(target);
    };
    // React's selection plugin can miss native selection after captured key events.
    document.addEventListener("select", selected, true);
    document.addEventListener("selectionchange", selected);
    document.addEventListener("input", selected, true);
    return () => {
      document.removeEventListener("select", selected, true);
      document.removeEventListener("selectionchange", selected);
      document.removeEventListener("input", selected, true);
    };
  }, [control]);
}
