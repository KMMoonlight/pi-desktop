/** Measure outside the flex layout so an editor resize cannot clamp the transcript scroll. */
export function resizeComposer(editor: HTMLTextAreaElement) {
  const style = getComputedStyle(editor);
  const mirror = document.createElement("textarea");
  for (const property of [
    "box-sizing",
    "width",
    "font",
    "letter-spacing",
    "line-height",
    "word-spacing",
    "text-indent",
    "tab-size",
    "white-space",
    "overflow-wrap",
    "word-break",
    "padding",
    "border-width",
    "border-style",
  ])
    mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    top: "0",
    left: "0",
    height: "0",
    minHeight: "0",
    maxHeight: "none",
    overflow: "hidden",
  });
  mirror.tabIndex = -1;
  mirror.inert = true;
  mirror.setAttribute("aria-hidden", "true");
  mirror.wrap = editor.wrap;
  mirror.value = editor.value;
  document.body.append(mirror);
  let height: number;
  try {
    const border =
      style.boxSizing === "border-box"
        ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        : 0;
    height = Math.min(360, Math.max(96, mirror.scrollHeight + border));
  } finally {
    mirror.remove();
  }
  if (editor.style.height === `${height}px`) return;
  const transcript = editor
    .closest(".chat-view")
    ?.querySelector<HTMLElement>(".transcript");
  const scrollTop = transcript?.scrollTop ?? 0;
  const atBottom = transcript
    ? transcript.scrollHeight - transcript.clientHeight - scrollTop <= 1
    : false;
  editor.style.height = `${height}px`;
  // Preserve the bottom immediately, before the next frame/ResizeObserver.
  if (transcript)
    transcript.scrollTop = atBottom ? transcript.scrollHeight : scrollTop;
}
