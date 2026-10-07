import type { DialogRequest } from "../shared/types.ts";
import type { DesktopKeybindings } from "./tui-api.ts";

export function dialogInput(
  dialog: DialogRequest,
  data: string,
  keys: DesktopKeybindings,
  target: { kind?: string; index?: number; text?: string },
) {
  if (
    (dialog.kind === "select" || dialog.kind === "confirm") &&
    keys.matches(data, "app.tools.expand")
  )
    return { toggleTools: true };
  if (keys.matches(data, "tui.select.cancel"))
    return { answer: true, value: undefined };
  if (target.kind === "native")
    return data === "\x1b" ? { consume: true } : undefined;
  if (dialog.kind === "select" || dialog.kind === "confirm") {
    const last =
      dialog.kind === "confirm" ? 1 : (dialog.options?.length ?? 0) - 1;
    const index = Math.max(0, Math.min(last, target.index ?? 0));
    if (keys.matches(data, "tui.select.up") || data === "k")
      return { focus: Math.max(0, index - 1) };
    if (keys.matches(data, "tui.select.down") || data === "j")
      return { focus: Math.max(0, Math.min(last, index + 1)) };
    if (keys.matches(data, "tui.select.confirm") || data === "\n") {
      if (dialog.kind === "confirm")
        return { answer: true, value: index === 0 };
      const option = dialog.options?.[index];
      return option === undefined
        ? { consume: true }
        : {
            answer: true,
            value: typeof option === "string" ? option : option.value,
          };
    }
  } else if (target.kind === "text") {
    if (dialog.kind === "editor" && keys.matches(data, "app.editor.external"))
      return { external: true };
    if (
      dialog.kind === "input" &&
      (keys.matches(data, "tui.select.confirm") || data === "\n")
    )
      return { answer: true, value: target.text ?? "" };
  }
  // Do not let native modal/button defaults bypass remapped Pi commands.
  if (data === "\x1b" || (target.kind === "option" && data === "\r"))
    return { consume: true };
  return undefined;
}
