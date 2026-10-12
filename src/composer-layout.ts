const properties = [
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
] as const;

const measurements = new WeakMap<
  HTMLTextAreaElement,
  {
    mirror: HTMLTextAreaElement;
    styleKey?: string;
  }
>();

/** Measure outside the flex layout without inserting/removing DOM on every key. */
export function resizeComposer(editor: HTMLTextAreaElement) {
  // ComputedStyle is live. Read ALL metrics before writing to the mirror, or
  // subsequent reads can force document layout after each style mutation.
  const style = getComputedStyle(editor);
  const values = properties.map((property) => style.getPropertyValue(property));
  const border =
    style.boxSizing === "border-box"
      ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
      : 0;
  const styleKey = values.join("\0");
  let measurement = measurements.get(editor);
  if (!measurement) {
    const mirror = document.createElement("textarea");
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
      contain: "strict",
    });
    mirror.tabIndex = -1;
    mirror.inert = true;
    mirror.setAttribute("aria-hidden", "true");
    mirror.dataset.composerMeasure = "";
    measurement = { mirror };
    measurements.set(editor, measurement);
  }
  const { mirror } = measurement;
  if (measurement.styleKey !== styleKey) {
    properties.forEach((property, index) =>
      mirror.style.setProperty(property, values[index]),
    );
    measurement.styleKey = styleKey;
  }
  if (mirror.wrap !== editor.wrap) mirror.wrap = editor.wrap;
  if (mirror.value !== editor.value) mirror.value = editor.value;
  if (!mirror.isConnected) document.body.append(mirror);
  const height = Math.min(360, Math.max(96, mirror.scrollHeight + border));
  if (editor.style.height === `${height}px`) return;
  const transcript = editor
    .closest(".chat-view")
    ?.querySelector<HTMLElement>(".transcript");
  const scrollTop = transcript?.scrollTop ?? 0;
  const atBottom = transcript
    ? transcript.scrollHeight - transcript.clientHeight - scrollTop <= 1
    : false;
  editor.style.height = `${height}px`;
  if (transcript)
    transcript.scrollTop = atBottom ? transcript.scrollHeight : scrollTop;
}

/** Width/font observation belongs to the mounted editor, not to each draft value. */
export function observeComposer(editor: HTMLTextAreaElement) {
  let active = true;
  const resize = () => {
    if (active && editor.isConnected) resizeComposer(editor);
  };
  resize();
  let width = editor.getBoundingClientRect().width;
  const observer = new ResizeObserver(() => {
    const next = editor.getBoundingClientRect().width;
    if (next !== width) {
      width = next;
      resize();
    }
  });
  observer.observe(editor);
  const appearance = new MutationObserver(resize);
  appearance.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class", "data-theme"],
  });
  document.fonts.addEventListener("loadingdone", resize);
  void document.fonts.ready.then(resize);
  return () => {
    active = false;
    observer.disconnect();
    appearance.disconnect();
    document.fonts.removeEventListener("loadingdone", resize);
    measurements.get(editor)?.mirror.remove();
    measurements.delete(editor);
  };
}
