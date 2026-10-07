import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { desktopKeyFromId, encodeDesktopKey } from "../shared/keyboard.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Native editor did not reach its expected state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const editor = (host: DesktopHost) =>
  host.desktopUI.surfaces.find((surface) => surface.slot === "editor");

test("native Pi commands retain history drafts, kill accumulation, yank rotation and Unicode jump targets", async () => {
  const fixture = await createFixture({ officialEditor: true });
  const host = new DesktopHost(fixture.agentDir, { legacyExampleAdapters: true });
  try {
    await writeFile(
      join(fixture.agentDir, "keybindings.json"),
      JSON.stringify({
        "tui.editor.historyPrevious": "alt+h",
        "tui.editor.historyNext": "alt+n",
        "tui.editor.deleteToLineEnd": "alt+k",
      }),
    );
    await host.initialize(fixture.cwd);
    await until(() => editor(host)?.title === "Modal editor");
    const ui = host.session.extensionRunner.getUIContext();
    const input = (key: string, extra = {}, position?: number) =>
      host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          event: { key, ...extra },
          editorText: ui.getEditorText(),
          selection:
            position === undefined
              ? host.desktopUI.getEditorSelection()
              : { start: position, end: position },
        },
      });
    host.desktopUI.addEditorHistory("old prompt");
    host.desktopUI.addEditorHistory("recent prompt");
    ui.setEditorText("unfinished draft");
    await input("h", { altKey: true });
    assert.equal(ui.getEditorText(), "recent prompt");
    await input("h", { altKey: true });
    assert.equal(ui.getEditorText(), "old prompt");
    await input("n", { altKey: true });
    await input("n", { altKey: true });
    assert.equal(ui.getEditorText(), "unfinished draft");
    assert.equal(host.desktopUI.getEditorSelection()?.start, 16);
    ui.setEditorText("one two three");
    await input("w", { ctrlKey: true });
    await input("w", { ctrlKey: true });
    assert.equal(ui.getEditorText(), "one ");
    await input("y", { ctrlKey: true });
    assert.equal(ui.getEditorText(), "one two three");
    ui.setEditorText("left right");
    await input("k", { altKey: true }, 5);
    assert.equal(ui.getEditorText(), "left ");
    await input("y", { ctrlKey: true });
    assert.equal(ui.getEditorText(), "left right");
    await input("y", { altKey: true });
    assert.equal(ui.getEditorText(), "left two three");
    ui.setEditorText("a\u4e2db\n\u4e2dc");
    await input("]", { ctrlKey: true }, 0);
    await input("\u4e2d");
    assert.equal(host.desktopUI.getEditorSelection()?.start, 1);
    await input("]", { ctrlKey: true });
    await input("\u4e2d");
    assert.equal(host.desktopUI.getEditorSelection()?.start, 4);
    assert.equal(ui.getEditorText(), "a\u4e2db\n\u4e2dc");
    const long = "abcd ".repeat(400) + "\n" + "x\u4e2dz";
    ui.setEditorText(long);
    await input("]", { ctrlKey: true, altKey: true }, long.length);
    await input("\u4e2d");
    assert.equal(host.desktopUI.getEditorSelection()?.start, long.length - 2);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test(
  "official modal editor preserves native mode semantics, transformed input, selection and replacement",
  { timeout: 60000 },
  async () => {
    const fixture = await createFixture({ officialEditor: true });
    const host = new DesktopHost(fixture.agentDir, { legacyExampleAdapters: true });
    try {
      await host.initialize(fixture.cwd);
      await until(() => editor(host)?.title === "Modal editor");
      let ui = host.session.extensionRunner.getUIContext();
      assert.equal(typeof ui.getEditorComponent(), "function");
      const input = (key: string, extra = {}) =>
        host.action({
          action: "desktop.input",
          args: { surfaceId: "editor", event: { key, ...extra } },
        });
      ui.setEditorText("abcdef");
      await host.action({
        action: "desktop.action",
        args: {
          id: "editor",
          action: "selection",
          value: { start: 2, end: 4 },
        },
      });
      ui.pasteToEditor("X");
      assert.equal(ui.getEditorText(), "abXef");
      assert.deepEqual(host.desktopUI.getEditorSelection(), {
        start: 3,
        end: 3,
      });
      assert.deepEqual(await input("Escape"), { consume: true });
      assert.ok(JSON.stringify(editor(host)?.view).includes("NORMAL"));
      const stop = ui.onTerminalInput((data) =>
        data === "z" ? { data: "h" } : undefined,
      );
      assert.deepEqual(await input("z"), {
        consume: false,
        data: "\x1b[D",
        keyId: "left",
        changed: true,
      });
      stop();
      assert.deepEqual(await input("q"), { consume: true });
      assert.deepEqual(await input("a"), {
        consume: false,
        data: "\x1b[C",
        keyId: "right",
        changed: true,
      });
      assert.ok(JSON.stringify(editor(host)?.view).includes("INSERT"));
      assert.deepEqual(await input("z"), {
        consume: false,
        data: "z",
        keyId: "z",
        changed: false,
      });

      await host.action({
        action: "prompt",
        args: { message: "persist-editor-session" },
      });
      await until(() => !host.snapshot().busy);
      const path = host.snapshot().sessionFile;
      const originalFactory = ui.getEditorComponent();
      const previousInstance = editor(host)!.instanceId;
      await host.action({ action: "resources.reload" });
      await until(() => editor(host)?.title === "Modal editor");
      ui = host.session.extensionRunner.getUIContext();
      assert.notEqual(ui.getEditorComponent(), originalFactory);
      ui.setEditorText("Keep when restoring default editor");
      await host.action({
        action: "desktop.action",
        args: {
          id: "editor",
          instanceId: previousInstance,
          action: "text",
          value: "stale edit",
        },
      });
      assert.deepEqual(
        await host.action({
          action: "desktop.input",
          args: {
            surfaceId: "editor",
            instanceId: previousInstance,
            editorText: "stale edit",
            event: { key: "w", ctrlKey: true },
          },
        }),
        { consume: true },
      );
      assert.equal(ui.getEditorText(), "Keep when restoring default editor");
      ui.setEditorComponent(undefined);
      await until(() => !!editor(host) && !editor(host)?.title);
      assert.equal(ui.getEditorComponent(), undefined);
      assert.equal(ui.getEditorText(), "Keep when restoring default editor");
      await host.action({ action: "session.new" });
      await until(() => editor(host)?.title === "Modal editor");
      assert.ok(JSON.stringify(editor(host)?.view).includes("INSERT"));
      await host.action({ action: "session.switch", args: { path } });
      await until(() => editor(host)?.title === "Modal editor");
      assert.ok(JSON.stringify(editor(host)?.view).includes("INSERT"));
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test("component inputs receive transformed raw data while legacy key controllers keep browser metadata", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir, { legacyExampleAdapters: true });
  try {
    await host.initialize(fixture.cwd);
    const seen: unknown[] = [];
    host.desktopUI.registerAdapter({
      id: "raw-input-test",
      matches: (source) => source === "raw" || source === "keys",
      create: ({ source }) => ({
        view: () => ({ kind: "text", text: "Input receiver" }),
        handleAction() {},
        ...(source === "raw"
          ? {
              handleInput: (data: string) => {
                seen.push(data);
                return { consume: true };
              },
            }
          : {
              handleKey: (event: unknown) => {
                seen.push(event);
                return true;
              },
            }),
      }),
    });
    await host.desktopUI.mount("raw", "header", "raw");
    await host.desktopUI.mount("keys", "footer", "keys");
    const ui = host.session.extensionRunner.getUIContext();
    const stop = ui.onTerminalInput((data) =>
      data === "y"
        ? { data: "Z" }
        : data === "a"
          ? { data: "\x1b" }
          : undefined,
    );
    await host.action({
      action: "desktop.input",
      args: { surfaceId: "raw", event: { key: "y" } },
    });
    await host.action({
      action: "desktop.input",
      args: { surfaceId: "raw", data: "\x1b[200~paste\x1b[201~" },
    });
    await host.action({
      action: "desktop.input",
      args: { surfaceId: "keys", event: { key: "a" } },
    });
    const key = {
      key: "ArrowLeft",
      code: "ArrowLeft",
      repeat: true,
      ctrlKey: true,
    };
    await host.action({
      action: "desktop.input",
      args: { surfaceId: "keys", event: key },
    });
    assert.deepEqual(seen, [
      "Z",
      "\x1b[200~paste\x1b[201~",
      {
        key: "Escape",
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
      },
      key,
    ]);
    stop();
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("SDK paste replaces the default editor selection", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir, { legacyExampleAdapters: true });
  try {
    await host.initialize(fixture.cwd);
    await host.action({
      action: "editor.update",
      args: { text: "abcdef", selection: { start: 1, end: 5 } },
    });
    const ui = host.session.extensionRunner.getUIContext();
    ui.pasteToEditor("XY");
    assert.equal(ui.getEditorText(), "aXYf");
    ui.pasteToEditor("Z");
    assert.equal(ui.getEditorText(), "aXYZf");
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("native editor honors configured submission and clear bindings, completion priority and exit semantics", async () => {
  const fixture = await createFixture({ officialEditor: true });
  await writeFile(
    join(fixture.agentDir, "keybindings.json"),
    JSON.stringify({
      "tui.input.submit": "ctrl+enter",
      "app.clear": "ctrl+k",
    }),
  );
  const host = new DesktopHost(fixture.agentDir, { legacyExampleAdapters: true });
  try {
    await host.initialize(fixture.cwd);
    await until(() => editor(host)?.title === "Modal editor");
    const ui = host.session.extensionRunner.getUIContext();
    const events: { type: string; name?: string; data?: unknown }[] = [];
    host.on("event", (event) => events.push(event));
    const input = (key: string, extra = {}, context = {}) =>
      host.action({
        action: "desktop.input",
        args: { surfaceId: "editor", event: { key, ...extra }, ...context },
      });
    ui.setEditorText("Bound submission");
    assert.equal(
      ((await input("Enter")) as { consume: boolean }).consume,
      false,
    );
    assert.equal(
      (
        (await input(
          "Enter",
          { ctrlKey: true },
          { autocompleteActive: true },
        )) as { consume: boolean }
      ).consume,
      true,
    );
    assert.deepEqual(
      events
        .filter((event) => event.name === "desktop_editor_submit")
        .map((event) => event.data),
      ["Bound submission"],
    );
    assert.equal(
      (
        (await input("Enter", {}, { autocompleteActive: true })) as {
          consume: boolean;
        }
      ).consume,
      false,
    );
    await input("k", { ctrlKey: true });
    assert.equal(ui.getEditorText(), "");
    await input("d", { ctrlKey: true });
    assert.equal(
      events.filter((event) => event.name === "desktop_editor_exit").length,
      1,
    );
    ui.setEditorText("Delete here");
    assert.equal(
      ((await input("d", { ctrlKey: true })) as { data?: string }).data,
      "\x1b[3~",
    );
    assert.equal(
      events.filter((event) => event.name === "desktop_editor_exit").length,
      1,
    );
    for (const id of ["ctrl++", "shift+f12", "alt+left"]) {
      const key = desktopKeyFromId(id);
      assert.ok(key);
      assert.ok(encodeDesktopKey(key));
    }
    assert.deepEqual(desktopKeyFromId("ctrl++"), {
      key: "+",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    });
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
