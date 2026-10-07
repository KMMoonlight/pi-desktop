import { createEditorCommands } from "./editor-commands.ts";
import { createInputCommands } from "./input-commands.ts";
import { loadTuiApi } from "./tui-api.ts";
import type {
  DesktopEditorLayout,
  DesktopInputResult,
  DesktopSelection,
} from "../shared/desktop-ui.ts";

/** Pi command state belongs to one dialog; text/selection/undo live in its desktop control. */
export async function createDialogTextCommands(
  config: Record<string, string | string[] | undefined>,
  kind: "input" | "editor",
) {
  const bindings: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) bindings[key] = value;
  }
  const api = await loadTuiApi();
  const keys = new api.KeybindingsManager(api.TUI_KEYBINDINGS, bindings);
  const commands =
    kind === "editor" ? await createEditorCommands(bindings) : undefined;
  const input = kind === "input" ? await createInputCommands(keys) : undefined;
  let paste: { value: string; caret: DesktopSelection } | undefined;
  const handle = (
    data: string,
    text: string,
    selection: DesktopSelection,
    layout?: DesktopEditorLayout,
  ): (DesktopInputResult & { answer?: string }) | undefined => {
    if (paste || data.includes("\x1b[200~")) {
      if (!paste) {
        const value =
          text.slice(0, selection.start) + text.slice(selection.end);
        const caret = { start: selection.start, end: selection.start };
        paste = { value, caret };
        commands?.sync(value, caret);
      }
      const result = input
        ? input(data, paste.value, paste.caret, layout)!
        : commands!.dispatch(data);
      if (result.pasting) return { consume: true };
      paste = undefined;
      return {
        consume: true,
        editor: { text: result.text, selection: result.selection },
        ...(result.submitted !== undefined ? { answer: result.submitted } : {}),
      };
    }
    commands?.sync(text, selection);
    // Match Pi's accepted newline encodings, then let its handler decide
    // between submission, a newline, and the backslash/Enter workaround.
    if (
      commands &&
      (keys.matches(data, "tui.input.submit") ||
        keys.matches(data, "tui.input.newLine") ||
        data === "\n" ||
        data === "\x1b\r" ||
        data === "\x1b[13;2~" ||
        (data.length > 1 &&
          (data.charCodeAt(0) === 10 ||
            (data.includes("\x1b") && data.includes("\r")))))
    ) {
      const result = commands.dispatch(data);
      if (result.submitted !== undefined)
        return { consume: true, answer: result.submitted };
      const position = result.selection.start;
      const value =
        result.text !== text && selection.start !== selection.end
          ? result.text.slice(0, position) +
            result.text.slice(position + selection.end - selection.start)
          : result.text;
      return {
        consume: true,
        editor: { text: value, selection: result.selection },
      };
    }
    if (keys.matches(data, "tui.editor.undo"))
      return { consume: false, data: "\x1a" };
    if (
      api.matchesKey(data, "ctrl+a") &&
      !bindings["tui.editor.cursorLineStart"]
    )
      return { consume: false, data };
    if (
      selection.start !== selection.end &&
      ["tui.editor.deleteCharBackward", "tui.editor.deleteCharForward"].some(
        (key) => keys.matches(data, key),
      )
    )
      return { consume: false, data: "\x7f" };
    const result = input
      ? input(data, text, selection, layout)
      : commands!.handle(data, layout);
    if (!result?.handled) return undefined;
    return {
      consume: true,
      editor: { text: result.text, selection: result.selection },
    };
  };
  return { handle };
}
