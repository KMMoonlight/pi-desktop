import type {
  DesktopSelection,
  DesktopEditorLayout,
} from "../shared/desktop-ui.ts";
import type { DesktopComponent } from "./desktop-ui.ts";
import type { DesktopSdkContext } from "./sdk-access.ts";
import { loadTuiApi } from "./tui-api.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeDesktopKey } from "../shared/keyboard.ts";
import { errorMessage } from "../shared/errors.ts";
import { createEditorCommands } from "./editor-commands.ts";

const normalKeys: Record<string, string> = {
  h: "\x1b[D",
  j: "\x1b[B",
  k: "\x1b[A",
  l: "\x1b[C",
  "0": "\x1b[H",
  $: "\x1b[F",
  x: "\x1b[3~",
};

export async function createNativeEditor(
  sdk: DesktopSdkContext,
  modal = false,
): Promise<DesktopComponent> {
  const tui = await loadTuiApi();
  const terminalInput = sdk.desktop.terminalInput.capture();
  let bindings: Record<string, string | string[]> = {};
  try {
    bindings = JSON.parse(
      await readFile(join(sdk.host.agentDir, "keybindings.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const appDefaults: Record<string, string | string[]> = {
    "app.interrupt": "escape",
    "app.clear": "ctrl+c",
    "app.exit": "ctrl+d",
    "app.thinking.cycle": "shift+tab",
    "app.model.cycleForward": "ctrl+p",
    "app.model.cycleBackward":
      process.platform === "win32" ? "alt+p" : "shift+ctrl+p",
    "app.tools.expand": "ctrl+o",
    "app.editor.external": "ctrl+g",
    "app.model.select": "ctrl+l",
    "app.thinking.save": "ctrl+s",
    "app.thinking.toggle": "ctrl+t",
    "app.message.copy": "ctrl+x",
    "app.message.followUp":
      process.platform === "win32" ? "ctrl+q" : "alt+enter",
    "app.message.dequeue": process.platform === "win32" ? "alt+q" : "alt+up",
    "app.clipboard.pasteImage":
      process.platform === "win32" ? "alt+v" : "ctrl+v",
    "app.session.new": [],
    "app.session.tree": [],
    "app.session.fork": [],
    "app.session.resume": [],
  };
  const matches = (data: string, action: string) => {
    const keys =
      bindings[action] ??
      appDefaults[action] ??
      tui.TUI_KEYBINDINGS[action]?.defaultKeys ??
      [];
    return (Array.isArray(keys) ? keys : [keys]).some((key) =>
      tui.matchesKey(data, key),
    );
  };
  const commands = await createEditorCommands(bindings);
  const completionKeys = Object.fromEntries(
    [
      ["up", "tui.select.up"],
      ["down", "tui.select.down"],
      ["pageUp", "tui.select.pageUp"],
      ["pageDown", "tui.select.pageDown"],
      ["confirm", "tui.select.confirm"],
      ["cancel", "tui.select.cancel"],
      ["trigger", "tui.input.tab"],
    ].map(([name, key]) => {
      const keys = bindings[key] ?? tui.TUI_KEYBINDINGS[key].defaultKeys;
      return [name, Array.isArray(keys) ? keys : [keys]];
    }),
  );
  for (const message of sdk.session.messages) {
    if (message.role !== "user") continue;
    commands.addToHistory(
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n"),
    );
  }
  let value = "",
    mode: "insert" | "normal" = "insert";
  let selection: DesktopSelection = { start: 0, end: 0 };
  let selectionRevision = 0;
  let textRevision = 0;
  let selectionText = "";
  const setSelection = (next: DesktopSelection) => {
    const start = Math.min(value.length, Math.max(0, Number(next.start) || 0));
    selection = {
      start,
      end: Math.min(value.length, Math.max(start, Number(next.end) || 0)),
    };
  };
  const setText = (next: string) => {
    if (next !== value) textRevision++;
    value = next;
    selectionText = next;
    selection = { start: next.length, end: next.length };
    selectionRevision++;
  };
  const run = (action: string, args?: Record<string, unknown>) => {
    return sdk.host.action({ action, args }).catch((error) => {
      sdk.host.notice(errorMessage(error), "error");
    });
  };
  const transaction = () => ({
    consume: true,
    editor: {
      text: value,
      selection: { ...selection },
      revision: textRevision,
    },
  });
  const command = (data: string, layout?: DesktopEditorLayout) => {
    const result = commands.handle(data, layout);
    if (!result?.handled) return undefined;
    value = result.text;
    textRevision++;
    selectionText = value;
    selection = result.selection;
    selectionRevision++;
    return transaction();
  };
  return {
    handlesTerminalInput: true,
    title: modal ? "Modal editor" : undefined,
    getText: () => value,
    setText,
    setSelection,
    getSelection: () => ({ ...selection }),
    addToHistory: (text) => commands.addToHistory(text),
    pasteText: (text) => {
      textRevision++;
      value =
        value.slice(0, selection.start) + text + value.slice(selection.end);
      const end = selection.start + text.length;
      selection = { start: end, end };
      selectionText = value;
      selectionRevision++;
    },
    view: () => ({
      kind: "column",
      children: [
        ...(modal ? [{ kind: "text" as const, text: mode.toUpperCase() }] : []),
        {
          kind: "textarea",
          action: "text",
          label: "消息",
          desktopLabel: true,
          value,
          revision: textRevision,
          selectionAction: "selection",
          selection: {
            ...selection,
            revision: selectionRevision,
            text: selectionText,
          },
          autocomplete: mode === "insert",
          completionKeys,
        },
      ],
    }),
    handleAction: ({ action, value: next }) => {
      if (action === "text" && typeof next === "string") {
        if (next !== value) textRevision++;
        value = next;
      }
      if (action === "selection" && next && typeof next === "object") {
        const state = next as DesktopSelection & { text?: string };
        if (typeof state.text === "string" && state.text !== value) return;
        setSelection(next as DesktopSelection);
      }
    },
    handleInput: async (data, _event, context) => {
      const release = tui.isKeyRelease(data) || _event?.type === "release";
      if (!release && typeof context?.editorText === "string") {
        if (context.editorText !== value) textRevision++;
        value = context.editorText;
      }
      if (!release && context?.selection) setSelection(context.selection);
      const before = { value, selectionRevision };
      const filtered =
        context && "terminalFiltered" in context && context.terminalFiltered
          ? { consume: false, data }
          : terminalInput.run(data);
      if (filtered.consume)
        return release &&
          before.value === value &&
          before.selectionRevision === selectionRevision
          ? { consume: true }
          : transaction();
      data = filtered.data ?? data;
      if (!(
        context &&
        "terminalFiltered" in context &&
        context.terminalFiltered
      )) {
        const routed = sdk.desktop.terminalRuntime
          .capture()
          .dispatchSlot("editor", data, _event);
        if (routed) return { consume: true };
      }
      const mutated =
        before.value !== value ||
        before.selectionRevision !== selectionRevision;
      if (tui.isKeyRelease(data))
        return mutated ? transaction() : { consume: true };
      commands.sync(value, selection);
      if (tui.matchesKey(data, "escape")) {
        commands.cancelJump();
        if (!modal) {
          if (!context?.autocompleteActive && matches(data, "app.interrupt")) {
            void run("queue.restore", { abort: true });
            return transaction();
          }
          return { consume: !context?.autocompleteActive, data };
        }
        if (mode === "insert") mode = "normal";
        else if (
          !context?.autocompleteActive &&
          matches(data, "app.interrupt")
        ) {
          void run("queue.restore", { abort: true });
          return transaction();
        }
        return { consume: !context?.autocompleteActive, data };
      }
      if (
        context?.autocompleteActive &&
        [
          "tui.select.up",
          "tui.select.down",
          "tui.select.pageUp",
          "tui.select.pageDown",
          "tui.select.confirm",
          "tui.input.tab",
          "tui.select.cancel",
        ].some((key) => matches(data, key))
      )
        return { consume: false, data };
      if (matches(data, "app.interrupt")) {
        void run("queue.restore", { abort: true });
        return transaction();
      }
      if (matches(data, "app.clipboard.pasteImage")) {
        await run("clipboard.paste");
        return transaction();
      }
      if (
        ["tui.editor.historyPrevious", "tui.editor.historyNext"].some((key) =>
          matches(data, key),
        )
      )
        return command(data) ?? { consume: true };
      if (matches(data, "app.clear") && selection.start === selection.end) {
        setText("");
        sdk.host.emitEvent({ type: "editor", text: "", selection });
        return transaction();
      }
      if (matches(data, "app.exit")) {
        if (value.length) return { consume: false, data: "\x1b[3~" };
        sdk.host.emitEvent({
          type: "activity",
          name: "desktop_editor_exit",
        });
        return { consume: true };
      }
      if (matches(data, "app.thinking.cycle")) {
        run("thinking.cycle");
        return { consume: true };
      }
      if (
        matches(data, "app.model.cycleForward") ||
        matches(data, "app.model.cycleBackward")
      ) {
        run("model.cycle", {
          direction: matches(data, "app.model.cycleBackward")
            ? "backward"
            : "forward",
        });
        return { consume: true };
      }
      if (matches(data, "app.tools.expand")) {
        const expanded = !sdk.session.extensionRunner
          .getUIContext()
          .getToolsExpanded();
        run("display.tools", { expanded });
        sdk.host.emitEvent({
          type: "activity",
          name: "tools_expanded",
          data: expanded,
        });
        return { consume: true };
      }
      if (matches(data, "app.editor.external")) {
        run("editor.external");
        return { consume: true };
      }
      const applicationActions: Record<
        string,
        [string, Record<string, unknown>?]
      > = {
        "app.model.select": ["model.select"],
        "app.thinking.save": [
          "thinking.set",
          { level: sdk.session.thinkingLevel, persist: true },
        ],
        "app.thinking.toggle": [
          "display.thinking",
          { visible: sdk.settingsManager.getHideThinkingBlock() },
        ],
        "app.session.new": ["session.new"],
        "app.session.tree": ["session.selector", { kind: "tree" }],
        "app.session.fork": ["session.selector", { kind: "fork" }],
        "app.session.resume": ["session.selector", { kind: "resume" }],
      };
      if (matches(data, "app.message.dequeue")) {
        void run("queue.restore");
        return transaction();
      }
      for (const [key, [action, args]] of Object.entries(applicationActions)) {
        if (!matches(data, key)) continue;
        run(action, args);
        return { consume: true };
      }
      if (
        matches(data, "app.message.copy") &&
        selection.start === selection.end
      ) {
        run("clipboard.copy");
        return { consume: true };
      }
      if (matches(data, "app.message.followUp")) {
        sdk.host.emitEvent({
          type: "activity",
          name: "desktop_editor_followUp",
          data: value,
        });
        return { consume: true };
      }
      if (matches(data, "tui.input.submit")) {
        sdk.host.emitEvent({
          type: "activity",
          name: "desktop_editor_submit",
          data: value,
        });
        return { consume: true };
      }
      if (matches(data, "tui.input.newLine"))
        return {
          consume: false,
          data: encodeDesktopKey({ key: "Enter", shiftKey: true }),
        };
      if (mode === "insert") {
        if (matches(data, "tui.editor.undo"))
          return {
            consume: false,
            data: encodeDesktopKey({ key: "z", ctrlKey: true }),
          };
        // Desktop selection conventions take precedence over the terminal Ctrl+A binding.
        if (
          tui.matchesKey(data, "ctrl+a") &&
          !bindings["tui.editor.cursorLineStart"]
        )
          return { consume: false, data };
        if (
          selection.start !== selection.end &&
          [
            "tui.editor.deleteCharBackward",
            "tui.editor.deleteCharForward",
          ].some((key) => matches(data, key))
        )
          return { consume: false, data: "\x7f" };
        const result = command(data, context?.editorLayout);
        if (result) return result;
        if (mutated || release) {
          const result = commands.dispatch(data);
          value = result.text;
          textRevision++;
          selectionText = value;
          selection = result.selection;
          selectionRevision++;
          return transaction();
        }
        return { consume: false, data };
      }
      const printable = tui.decodeKittyPrintable(data) ?? data;
      if (printable === "i" || printable === "a") {
        mode = "insert";
        return printable === "a"
          ? { consume: false, data: "\x1b[C" }
          : { consume: true };
      }
      if (normalKeys[printable])
        return { consume: false, data: normalKeys[printable] };
      if (Array.from(printable).length === 1 && printable.codePointAt(0)! >= 32)
        return { consume: true };
      return { consume: false, data };
    },
  };
}
