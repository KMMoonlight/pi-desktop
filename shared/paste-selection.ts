import type { DesktopPasteSpan, DesktopSelection } from "./desktop-ui.ts";

/** Registered Pi paste markers behave as atomic segments in native selection too. */
export function normalizePasteSelection(
  text: string,
  selection: DesktopSelection,
  pastes: readonly Pick<DesktopPasteSpan, "start" | "end" | "marker">[],
): DesktopSelection {
  const bound = (value: number) =>
    Math.max(
      0,
      Math.min(text.length, Number.isFinite(value) ? Math.floor(value) : 0),
    );
  let start = bound(selection.start),
    end = Math.max(start, bound(selection.end));
  const collapsed = start === end;
  for (const paste of pastes) {
    if (text.slice(paste.start, paste.end) !== paste.marker) continue;
    if (start > paste.start && start < paste.end) start = paste.start;
    if (collapsed) end = start;
    else if (end > paste.start && end < paste.end) end = paste.end;
  }
  return { start, end };
}
