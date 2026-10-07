import type { DesktopEditorLayout, DesktopSelection } from "./desktop-ui";

/** Collapse a native selection toward the requested visual edge, without stepping. */
export function collapseEditorSelection(
  selection: DesktopSelection,
  right: boolean,
  layout?: DesktopEditorLayout,
): number {
  const startRow =
    layout?.rows.findIndex((row) =>
      row.carets.some((caret) => caret.offset === selection.start),
    ) ?? -1;
  const endRow =
    layout?.rows.findIndex((row) =>
      row.carets.some((caret) => caret.offset === selection.end),
    ) ?? -1;
  if (layout && startRow >= 0 && startRow === endRow) {
    const carets = layout.rows[startRow].carets;
    const start = carets.find((caret) => caret.offset === selection.start)!;
    const end = carets.find((caret) => caret.offset === selection.end)!;
    if (start.x !== end.x)
      return right === start.x > end.x ? selection.start : selection.end;
  }
  return right ? selection.end : selection.start;
}
