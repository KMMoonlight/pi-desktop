import type {
  DesktopSelection,
  DesktopEditorLayout,
} from "../shared/desktop-ui.ts";
import {
  callComponentMethod,
  componentField,
  withComponentEditorLayout,
} from "./component-runtime.ts";
import { createDetachedTui } from "./detached-tui.ts";
import { loadTuiApi } from "./tui-api.ts";

/** Public Pi editor state/commands, with presentation supplied by the desktop. */
export async function createEditorCommands(
  bindings: Record<string, string | string[]>,
) {
  const api = await loadTuiApi();
  const geometry = { columns: 120, rows: 40 };
  const tui = await createDetachedTui(() => {}, geometry);
  const plain = (text: string) => text;
  class CommandEditor extends api.Editor {
    firstVisibleLine = 0;
    protected renderTopBorder(_width: number, hidden: number) {
      this.firstVisibleLine = hidden;
      return "";
    }
    protected renderBottomBorder() {
      return "";
    }
  }
  const editor = new CommandEditor(
    tui,
    {
      borderColor: plain,
      selectList: {
        selectedPrefix: plain,
        selectedText: plain,
        description: plain,
        scrollInfo: plain,
        noMatch: plain,
      },
    },
    { paddingX: 0 },
  );
  const manager = new api.KeybindingsManager(api.TUI_KEYBINDINGS, bindings);
  const positioning = new api.KeybindingsManager(api.TUI_KEYBINDINGS);
  const execute = (data: string, keys = manager) => {
    const previous = api.getKeybindings();
    // Pi's editor uses a global manager; scope it to this synchronous call.
    api.setKeybindings(keys);
    try {
      editor.handleInput(data);
    } finally {
      api.setKeybindings(previous);
    }
  };
  let jumping = false;
  let nativeSelection: DesktopSelection = { start: 0, end: 0 };
  const offset = () => {
    const { line, col } = editor.getCursor();
    return (
      editor
        .getLines()
        .slice(0, line)
        .reduce((sum, row) => sum + row.length + 1, 0) + col
    );
  };
  const layout = () => {
    const lines = editor.getLines();
    geometry.columns = lines.reduce(
      (width, line) => Math.max(width, api.visibleWidth(line) + 2),
      2,
    );
    geometry.rows = Math.max(
      40,
      Math.min(
        Math.ceil((lines.length + 1) / 0.3),
        Math.floor(1_000_000 / geometry.columns / 0.3),
      ),
    );
    // Unwrapped hit tests with bounded viewport allocation. Strings never reach the UI.
    editor.render(geometry.columns);
  };
  return {
    sync(text: string, selection: DesktopSelection) {
      nativeSelection = selection;
      if (text !== editor.getText()) editor.setText(text);
      const position = Math.min(editor.getText().length, selection.start);
      if (offset() === position) return;
      const before = editor.getText().slice(0, position).split("\n");
      layout();
      const line = before.length - 1,
        col = before.at(-1)!.length;
      const visible = Math.max(5, Math.floor(geometry.rows * 0.3));
      while (
        line < editor.firstVisibleLine ||
        line >= editor.firstVisibleLine + visible
      ) {
        const previous = editor.getCursor().line;
        execute(
          line < editor.firstVisibleLine ? "\x1b[5~" : "\x1b[6~",
          positioning,
        );
        layout();
        if (editor.getCursor().line === previous) break;
      }
      editor.handleMouse({
        type: "click",
        button: "left",
        x: api.visibleWidth(before.at(-1)!.slice(0, col)),
        y: line - editor.firstVisibleLine + 1,
        screenX: 0,
        screenY: 0,
        width: geometry.columns,
        height: geometry.rows,
        shift: false,
        alt: false,
        ctrl: false,
      });
    },
    addToHistory(text: string) {
      editor.addToHistory(text);
    },
    cancelJump() {
      if (jumping) execute("\x1b");
      jumping = false;
    },
    dispatch(data: string) {
      if (jumping) execute("\x1b");
      jumping = false;
      let submitted: string | undefined;
      const previous = editor.onSubmit;
      editor.onSubmit = (text) => {
        submitted = text;
      };
      try {
        execute(data);
      } finally {
        editor.onSubmit = previous;
      }
      const position = String(
        callComponentMethod(
          editor,
          "expandPasteMarkers",
          editor.getText().slice(0, offset()),
        ),
      ).length;
      return {
        text: editor.getExpandedText(),
        selection: { start: position, end: position },
        handled: true,
        pasting: componentField(editor, "isInPaste") === true,
        submitted,
      };
    },
    handle(data: string, nativeLayout?: DesktopEditorLayout) {
      const command = Object.keys(api.TUI_KEYBINDINGS).find(
        (key) =>
          key.startsWith("tui.editor.") &&
          key !== "tui.editor.undo" &&
          manager.matches(data, key),
      );
      if (!command && !jumping) return undefined;
      const wasJumping = jumping;
      const jump =
        command === "tui.editor.jumpForward" ||
        command === "tui.editor.jumpBackward";
      jumping = jump && !wasJumping;
      layout();
      withComponentEditorLayout(editor, nativeLayout, () => execute(data), {
        selection: nativeSelection,
      });
      const position = offset();
      return {
        text: editor.getText(),
        selection: { start: position, end: position },
        // A control key cancels jump targeting and continues normal handling.
        handled: !!command || (wasJumping && !/[\x00-\x1f\x7f]/.test(data)),
      };
    },
  };
}
