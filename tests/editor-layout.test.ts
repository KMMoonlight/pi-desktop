import test from "node:test";
import assert from "node:assert/strict";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createDetachedTui } from "../backend/detached-tui.ts";
import { withComponentEditorLayout } from "../backend/component-runtime.ts";
import { createEditorCommands } from "../backend/editor-commands.ts";
import type { DesktopEditorLayout } from "../shared/desktop-ui.ts";

const layout: DesktopEditorLayout = {
  text: "WWii\nx\nWWii",
  width: 100,
  pageRows: 5,
  rows: [
    {
      logicalLine: 0,
      startCol: 0,
      length: 4,
      carets: [
        { offset: 0, x: 0 },
        { offset: 1, x: 12 },
        { offset: 2, x: 24 },
        { offset: 3, x: 28 },
        { offset: 4, x: 32 },
      ],
    },
    {
      logicalLine: 1,
      startCol: 0,
      length: 1,
      carets: [
        { offset: 5, x: 0 },
        { offset: 6, x: 7 },
      ],
    },
    {
      logicalLine: 2,
      startCol: 0,
      length: 4,
      carets: [
        { offset: 7, x: 0 },
        { offset: 8, x: 12 },
        { offset: 9, x: 24 },
        { offset: 10, x: 28 },
        { offset: 11, x: 32 },
      ],
    },
  ],
};

test("browser layout preserves configured Pi commands and sticky pixel positions across short rows", async () => {
  const commands = await createEditorCommands({
    "tui.editor.cursorDown": "alt+j",
    "tui.editor.cursorUp": "alt+k",
  });
  commands.sync(layout.text, { start: 2, end: 2 });
  assert.equal(commands.handle("\x1bj", layout)?.selection.start, 6);
  commands.sync(layout.text, { start: 6, end: 6 });
  assert.equal(commands.handle("\x1bj", layout)?.selection.start, 9);
  commands.sync(layout.text, { start: 9, end: 9 });
  assert.equal(commands.handle("\x1bk", layout)?.selection.start, 6);
  commands.sync(layout.text, { start: 6, end: 6 });
  assert.equal(commands.handle("\x1bk", layout)?.selection.start, 2);
});

test("native geometry retains original editor handlers and restores instance methods after exceptions", async () => {
  const api = await loadTuiApi();
  const tui = await createDetachedTui(() => {});
  const identity = (text: string) => text;
  let handled = 0;
  const originalInput = api.Editor.prototype.handleInput;
  class OriginalEditor extends api.Editor {
    handleInput = (data: string) => {
      handled++;
      if (data === "consume") return;
      originalInput.call(this, data === "v" ? "\x1b[B" : data);
    };
  }
  const editor = new OriginalEditor(tui, {
    borderColor: identity,
    selectList: {
      selectedPrefix: identity,
      selectedText: identity,
      description: identity,
      scrollInfo: identity,
      noMatch: identity,
    },
  });
  editor.setText(layout.text);
  const methods = [
    "buildVisualLineMap",
    "moveToVisualLine",
    "computeVerticalMoveColumn",
    "pageScroll",
    "moveCursor",
    "tui",
  ];
  const before = methods.map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(editor, key),
    value: Reflect.get(editor, key),
  }));
  withComponentEditorLayout(editor, layout, () => editor.handleInput("v"));
  assert.equal(handled, 1);
  assert.equal(editor.getCursor().line, 2);
  const retained = editor.getCursor();
  let collapsed = false;
  withComponentEditorLayout(
    editor,
    layout,
    () => editor.handleInput("consume"),
    {
      selection: { start: 1, end: 4 },
      onCollapse: () => {
        collapsed = true;
      },
    },
  );
  assert.deepEqual(editor.getCursor(), retained);
  assert.equal(
    collapsed,
    false,
    "A consuming original handler retains ownership of selection",
  );
  assert.throws(
    () =>
      withComponentEditorLayout(editor, layout, () => {
        editor.handleInput("\x1b[5~");
        throw new Error("Original handler error");
      }),
    /Original handler error/,
  );
  for (const { key, descriptor, value } of before) {
    assert.equal(Reflect.get(editor, key), value);
    assert.deepEqual(Object.getOwnPropertyDescriptor(editor, key), descriptor);
  }
  const stale = { ...layout, text: "obsolete" };
  assert.equal(
    withComponentEditorLayout(editor, stale, () => 42),
    42,
  );
});

test("native horizontal navigation collapses selected ranges and retains remapped commands in RTL layouts", async () => {
  const commands = await createEditorCommands({
    "tui.editor.cursorRight": "alt+l",
    "tui.editor.cursorLeft": "alt+h",
  });
  commands.sync(layout.text, { start: 1, end: 4 });
  assert.equal(commands.handle("\x1bl", layout)?.selection.start, 4);
  commands.sync(layout.text, { start: 1, end: 4 });
  assert.equal(commands.handle("\x1bh", layout)?.selection.start, 1);
  const rtl: DesktopEditorLayout = { ...layout, direction: "rtl" };
  commands.sync(layout.text, { start: 2, end: 2 });
  assert.equal(commands.handle("\x1bh", rtl)?.selection.start, 3);
  commands.sync(layout.text, { start: 2, end: 2 });
  assert.equal(commands.handle("\x1bl", rtl)?.selection.start, 1);
});
