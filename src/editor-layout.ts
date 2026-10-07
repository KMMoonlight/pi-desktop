import type { DesktopEditorLayout } from "../shared/desktop-ui";

const cache = new WeakMap<
  HTMLTextAreaElement | HTMLInputElement,
  { key: string; layout: DesktopEditorLayout }
>();
const verticalCarets = new WeakMap<
  HTMLTextAreaElement,
  { text: string; width: number; offset: number; x: number }
>();

export function moveEditorVertically(
  control: HTMLTextAreaElement,
  key: string,
  shift: boolean,
) {
  const layout = measureEditorLayout(control);
  const start = control.selectionStart,
    end = control.selectionEnd;
  const cursor = control.selectionDirection === "backward" ? start : end;
  const rowIndex = layout.rows.findIndex((row) =>
    row.carets.some((caret) => caret.offset === cursor),
  );
  if (rowIndex < 0) return;
  const prior = verticalCarets.get(control);
  const x =
    prior?.text === control.value &&
    prior.width === layout.width &&
    prior.offset === cursor
      ? prior.x
      : Math.floor(
          layout.rows[rowIndex].carets.find((caret) => caret.offset === cursor)!
            .x,
        );
  const direction = key.endsWith("Up") ? -1 : 1;
  const step = key.startsWith("Page") ? Math.max(5, layout.pageRows) : 1;
  const target =
    layout.rows[
      Math.max(0, Math.min(layout.rows.length - 1, rowIndex + direction * step))
    ];
  const position = target.carets.reduce((a, b) =>
    Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a,
  ).offset;
  const anchor = control.selectionDirection === "backward" ? end : start;
  control.setSelectionRange(
    shift ? Math.min(anchor, position) : position,
    shift ? Math.max(anchor, position) : position,
    position < anchor ? "backward" : "forward",
  );
  verticalCarets.set(control, {
    text: control.value,
    width: layout.width,
    offset: position,
    x,
  });
}

/** Measure browser wrapping with the same text, font and content width as the control. */
export function measureEditorLayout(
  control: HTMLTextAreaElement | HTMLInputElement,
): DesktopEditorLayout {
  const style = getComputedStyle(control);
  const properties = [
    "font",
    "font-kerning",
    "font-feature-settings",
    "font-variation-settings",
    "letter-spacing",
    "word-spacing",
    "line-height",
    "text-indent",
    "text-transform",
    "text-align",
    "direction",
    "tab-size",
    "white-space",
    "overflow-wrap",
    "word-break",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "box-sizing",
  ];
  const styles = properties.map((key) => style.getPropertyValue(key));
  const key = JSON.stringify([
    control.value,
    control.clientWidth,
    control.clientHeight,
    control instanceof HTMLTextAreaElement ? control.wrap : "off",
    styles,
  ]);
  const previous = cache.get(control);
  if (previous?.key === key) return previous.layout;
  const mirror = document.createElement("div");
  properties.forEach((property, index) =>
    mirror.style.setProperty(property, styles[index]),
  );
  const paddingX =
    parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  Object.assign(mirror.style, {
    position: "fixed",
    left: "0",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
    height: "auto",
    border: "0",
    margin: "0",
    overflow: "visible",
  });
  mirror.style.width = `${control.clientWidth - (style.boxSizing === "border-box" ? 0 : paddingX)}px`;
  if (control instanceof HTMLInputElement || control.wrap === "off")
    mirror.style.whiteSpace = "pre";
  mirror.setAttribute("aria-hidden", "true");
  // The sentinel supplies a caret rectangle for a final empty logical line.
  const node = document.createTextNode(control.value + "\u200b");
  mirror.append(node);
  document.body.append(mirror);
  const rows: DesktopEditorLayout["rows"] = [];
  const range = document.createRange();
  let logicalLine = 0,
    lineStart = 0,
    top = Number.NaN;
  try {
    for (const segment of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(node.data)) {
      range.setStart(node, segment.index);
      range.setEnd(node, segment.index + segment.segment.length);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      let row = rows.at(-1);
      if (
        !row ||
        row.logicalLine !== logicalLine ||
        Math.abs(top - rect.top) > 1
      ) {
        row = {
          logicalLine,
          startCol: segment.index - lineStart,
          length: 0,
          carets: [],
        };
        rows.push(row);
        top = rect.top;
      }
      range.collapse(true);
      const caret = range.getBoundingClientRect();
      row.carets.push({
        offset: segment.index,
        x: Math.abs(caret.top - rect.top) <= 1 ? caret.left : rect.left,
      });
      row.length = segment.index - lineStart - row.startCol;
      if (segment.segment === "\n") {
        logicalLine++;
        lineStart = segment.index + 1;
      } else if (segment.index < control.value.length) {
        row.length += segment.segment.length;
      }
    }
    const lineHeight =
      parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const pageRows = Math.max(
      1,
      Math.floor(
        (control.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom)) /
          lineHeight,
      ) - 1,
    );
    const layout = {
      direction:
        style.direction === "rtl" ? ("rtl" as const) : ("ltr" as const),
      text: control.value,
      width: control.clientWidth,
      pageRows,
      rows,
    };
    cache.set(control, { key, layout });
    return layout;
  } finally {
    mirror.remove();
  }
}
