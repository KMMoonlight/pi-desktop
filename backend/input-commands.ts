import { componentField, setComponentField } from "./component-runtime.ts";
import { loadTuiApi, type DesktopKeybindings } from "./tui-api.ts";
import { collapseEditorSelection } from "../shared/editor-navigation.ts";
import type {
  DesktopEditorLayout,
  DesktopSelection,
} from "../shared/desktop-ui.ts";

/** Command-only use of the original single-line Input, with desktop text/selection. */
export async function createInputCommands(keys: DesktopKeybindings) {
  const api = await loadTuiApi();
  const input = new api.Input();
  const actions = [
    "deleteCharBackward",
    "deleteCharForward",
    "deleteWordBackward",
    "deleteWordForward",
    "deleteToLineStart",
    "deleteToLineEnd",
    "yank",
    "yankPop",
    "cursorLeft",
    "cursorRight",
    "cursorLineStart",
    "cursorLineEnd",
    "cursorWordLeft",
    "cursorWordRight",
  ].map((name) => `tui.editor.${name}`);
  return (
    data: string,
    text: string,
    selection: DesktopSelection,
    layout?: DesktopEditorLayout,
  ) => {
    const wasPasting = componentField(input, "isInPaste") === true;
    if (!wasPasting) {
      if (
        input.getValue() !== text ||
        componentField(input, "cursor") !== selection.start
      )
        setComponentField(input, "lastAction", null);
      input.setValue(text);
      setComponentField(input, "cursor", selection.start);
    }
    const command = actions.find((key) => keys.matches(data, key));
    const paste = wasPasting || data.includes("\x1b[200~");
    if (!command && !paste) {
      setComponentField(input, "lastAction", null);
      return undefined;
    }
    const left = "tui.editor.cursorLeft",
      right = "tui.editor.cursorRight";
    const horizontal = !paste && (command === left || command === right);
    const previous = api.getKeybindings();
    api.setKeybindings({
      getKeys: (action) => keys.getKeys(action),
      matches: (value, action) =>
        keys.matches(
          value,
          layout?.direction === "rtl" && horizontal
            ? action === left
              ? right
              : action === right
                ? left
                : action
            : action,
        ),
    });
    try {
      input.handleInput(data);
      if (horizontal && selection.start !== selection.end)
        setComponentField(
          input,
          "cursor",
          collapseEditorSelection(selection, keys.matches(data, right), layout),
        );
    } finally {
      api.setKeybindings(previous);
    }
    const position = Number(componentField(input, "cursor"));
    return {
      text: input.getValue(),
      selection: { start: position, end: position },
      handled: true,
      pasting: componentField(input, "isInPaste") === true,
      submitted: undefined,
    };
  };
}
