import type { KeyboardEvent } from "react";

/** Works on real buttons so Enter/Space keep their native activation semantics. */
export function menuKeyboard(
  event: KeyboardEvent<HTMLElement>,
  close?: () => void,
) {
  if (event.key === "Escape" && close) {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
    event.nativeEvent.isComposing
  )
    return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ),
  ].filter((button) => button.getClientRects().length > 0);
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (index + 1) % items.length
          : index < 0
            ? items.length - 1
            : (index - 1 + items.length) % items.length;
  items[next].focus();
}
