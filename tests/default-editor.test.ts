import test from "node:test";
import assert from "node:assert/strict";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { componentFocus } from "../backend/component-runtime.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesktopEvent } from "../shared/types.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Editor transition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("default editor exposes the original SDK instance and preserves it across replacement", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  try {
    await writeFile(
      join(files.agentDir, "keybindings.json"),
      JSON.stringify({
        "tui.editor.historyPrevious": "ctrl+p",
        "tui.editor.historyNext": "ctrl+n",
      }),
    );
    await host.initialize(files.cwd);
    const scope = host.desktopUI.terminalRuntime.capture();
    const tui = scope.tui;
    const container = tui.children[4];
    const editor = Reflect.get(container, "children")[0] as CustomEditor;
    assert.ok(editor instanceof CustomEditor);
    assert.equal(Reflect.get(editor, "tui"), tui);
    assert.equal(componentFocus(tui), editor);
    assert.equal(editor.embedWorkingStatus, true);
    const ui = host.session.extensionRunner.getUIContext();
    editor.setPaddingX(3);
    editor.setAutocompleteMaxVisible(4);
    editor.addToHistory("Retained history");
    ui.setEditorText("Default draft");
    const custom = (
      surfaceTui: typeof tui,
      theme: ConstructorParameters<typeof CustomEditor>[1],
      keys: ConstructorParameters<typeof CustomEditor>[2],
    ) => new CustomEditor(surfaceTui, theme, keys);
    ui.setEditorComponent(custom);
    await until(
      () =>
        Reflect.get(container, "children")[0] !== editor &&
        host.desktopUI.getEditorText() === "Default draft",
    );
    ui.setEditorText("Replacement draft");
    ui.setEditorComponent(undefined);
    await until(
      () =>
        Reflect.get(container, "children")[0] === editor &&
        host.desktopUI.getEditorText() === "Replacement draft",
    );
    assert.equal(editor.getPaddingX(), 3);
    assert.equal(editor.getAutocompleteMaxVisible(), 4);
    assert.equal(componentFocus(tui), editor);
    const result = await host.desktopUI.input("editor", "\x10");
    assert.equal(result.editor?.text, "Retained history");
    await host.desktopUI.input("editor", "\x0e");
    assert.equal(editor.getText(), "Replacement draft");
    editor.setText("Direct SDK mutation");
    tui.requestRender();
    assert.equal(ui.getEditorText(), "Direct SDK mutation");
    await host.action({
      action: "desktop.action",
      args: { id: "editor", action: "text", value: "Transport alias" },
    });
    assert.equal(editor.getText(), "Transport alias");
    await host.action({
      action: "desktop.action",
      args: {
        id: "editor",
        action: "selection",
        value: { text: "Transport alias", start: 3, end: 9 },
      },
    });
    assert.deepEqual(host.desktopUI.getEditorSelection(), { start: 3, end: 9 });
    await assert.rejects(
      host.desktopUI.action("editor", { action: "unavailable" }),
      /Desktop action is unavailable/,
    );
    let followUp: unknown;
    host.on("event", (event: DesktopEvent) => {
      if (
        event.type === "activity" &&
        event.name === "desktop_editor_followUp"
      ) {
        followUp = event.data;
        assert.equal(editor.getText(), "");
      }
    });
    const queued = await host.desktopUI.input(
      "editor",
      process.platform === "win32" ? "\x11" : "\x1b\r",
    );
    assert.equal(followUp, "Transport alias");
    assert.equal(queued.editor?.text, "");
    const api = await loadTuiApi();
    const add = tui.addChild;
    const text = new (Reflect.get(api, "Text"))("Extra registration");
    add(text);
    assert.equal(scope.registrationCount, 1);
    tui.removeChild(text);
    assert.equal(scope.registrationCount, 0);
  } finally {
    await host.dispose();
    await files.close();
  }
});

test("autocomplete replacements reach active and retained original default editors", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const tui = host.desktopUI.terminalRuntime.capture().tui;
    const original = Reflect.get(
      tui.children[4],
      "children",
    )[0] as CustomEditor;
    const ui = host.session.extensionRunner.getUIContext();
    ui.setEditorComponent(
      (tui, theme, keys) => new CustomEditor(tui, theme, keys),
    );
    await until(
      () =>
        Reflect.get(tui.children[4], "children")[0] instanceof CustomEditor &&
        Reflect.get(tui.children[4], "children")[0] !== original,
    );
    const provider = {
      getSuggestions: async () => null,
      applyCompletion: () => ({ lines: [""], cursorLine: 0, cursorCol: 0 }),
    };
    ui.addAutocompleteProvider(() => provider);
    assert.equal(Reflect.get(original, "autocompleteProvider"), provider);
    assert.equal(
      Reflect.get(
        Reflect.get(tui.children[4], "children")[0],
        "autocompleteProvider",
      ),
      provider,
    );
    ui.setEditorComponent(undefined);
    await until(() => Reflect.get(tui.children[4], "children")[0] === original);
    assert.equal(Reflect.get(original, "autocompleteProvider"), provider);
  } finally {
    await host.dispose();
    await files.close();
  }
});

test("application tree presents nested document, live queues, working state and string widgets", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const scope = host.desktopUI.terminalRuntime.capture();
    const tui = scope.tui;
    host.snapshot();
    assert.equal(tui.children.length, 7);
    assert.equal(Reflect.get(tui.children[0], "children").length, 3);
    assert.ok(tui.children[0].render(100).join("\n").includes("[Extensions]"));
    assert.equal(scope.registrationCount, 0);
    const ui = host.session.extensionRunner.getUIContext();
    ui.setWidget("above", ["Above string widget"]);
    ui.setWidget("below", ["Below string widget"], {
      placement: "belowEditor",
    });
    host.snapshot();
    assert.ok(
      tui.children[3].render(100).join("\n").includes("Above string widget"),
    );
    assert.ok(
      tui.children[5].render(100).join("\n").includes("Below string widget"),
    );
    await host.action({ action: "prompt", args: { message: "slow-response" } });
    await until(() => host.session.isStreaming);
    await host.action({
      action: "prompt",
      args: { message: "Native pending follow-up", mode: "followUp" },
    });
    ui.setWorkingMessage("Native working state");
    host.snapshot();
    assert.ok(
      tui.children[1]
        .render(100)
        .join("\n")
        .includes("Native pending follow-up"),
    );
    assert.ok(
      tui.children[4].render(100).join("\n").includes("Native working state"),
    );
    ui.setWorkingVisible(false);
    host.snapshot();
    assert.deepEqual(tui.children[2].render(100), []);
    await host.action({ action: "queue.restore", args: { abort: true } });
    await until(() => host.session.isIdle);
    host.snapshot();
    assert.deepEqual(tui.children[1].render(100), []);
    ui.setWidget("above", undefined);
    host.snapshot();
    assert.ok(
      !tui.children[3].render(100).join("\n").includes("Above string widget"),
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});
