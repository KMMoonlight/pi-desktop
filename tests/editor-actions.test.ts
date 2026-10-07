import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import type { DesktopEvent } from "../shared/types.ts";
import type { DesktopInputResult } from "../shared/desktop-ui.ts";
import { createFixture } from "./fixture.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Editor action did not complete");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/ACiqeP8EkgJKJCPrYwAAAABJRU5ErkJggg==",
  "base64",
);

for (const modal of [false, true])
  test(
    `native ${modal ? "modal" : "default"} editor handles application actions and prioritizes history over model cycling`,
    { timeout: 60000 },
    async () => {
      const fixture = await createFixture({ officialEditor: modal });
      const writes: string[] = [];
      let clipboard = "Clipboard text";
      const host = new DesktopHost(fixture.agentDir, {
        legacyExampleAdapters: modal,
        clipboard: {
          getText: async () => clipboard,
          getImage: async () => null,
          setText: async (text) => {
            writes.push(text);
          },
        },
      });
      const events: DesktopEvent[] = [];
      host.on("event", (event) => events.push(event));
      try {
        await writeFile(
          join(fixture.agentDir, "keybindings.json"),
          JSON.stringify({
            "tui.editor.historyPrevious": "ctrl+p",
            "tui.editor.historyNext": "ctrl+n",
            "app.session.new": "ctrl+alt+n",
            "app.session.fork": "ctrl+alt+f",
          }),
        );
        await host.initialize(fixture.cwd);
        await until(() =>
          host.desktopUI.surfaces.some(
            (surface) =>
              surface.slot === "editor" &&
              (!modal || surface.title === "Modal editor"),
          ),
        );
        const input = (key: string, extra = {}) =>
          host.action({
            action: "desktop.input",
            args: {
              surfaceId: "editor",
              editorText: host.session.extensionRunner
                .getUIContext()
                .getEditorText(),
              selection: host.desktopUI.getEditorSelection(),
              event: { key, ...extra },
            },
          }) as Promise<DesktopInputResult>;
        let ui = host.session.extensionRunner.getUIContext();
        host.desktopUI.addEditorHistory("History prompt");
        ui.setEditorText("Draft");
        assert.equal(
          (await input("p", { ctrlKey: true })).editor?.text,
          "History prompt",
        );
        assert.equal(
          (await input("n", { ctrlKey: true })).editor?.text,
          "Draft",
        );
        assert.equal(
          events.some(
            (event) => event.type === "notice" && event.level === "error",
          ),
          false,
        );
        await input("t", { ctrlKey: true });
        assert.equal(host.session.settingsManager.getHideThinkingBlock(), true);
        await input("t", { ctrlKey: true });
        assert.equal(
          host.session.settingsManager.getHideThinkingBlock(),
          false,
        );
        await input("s", { ctrlKey: true });
        assert.equal(
          host.session.settingsManager.getDefaultThinkingLevel(),
          host.session.thinkingLevel,
        );
        const clear = await input("c", { ctrlKey: true });
        assert.equal(clear.editor?.text, "");
        await input("v", { altKey: true });
        assert.equal(ui.getEditorText(), "Clipboard text");
        await host.action({
          action: "prompt",
          args: { message: "Reply to copy" },
        });
        await until(() => !host.snapshot().busy);
        await input("x", { ctrlKey: true });
        await until(() => writes.length === 1);
        assert.equal(writes[0], host.session.getLastAssistantText());
        await input("l", { ctrlKey: true });
        await until(() => host.pendingDialogs.length === 1);
        const selector = host.pendingDialogs[0];
        assert.ok(selector.options?.includes("desktop-test/desktop-test"));
        host.answer(selector.id, "desktop-test/desktop-test");
        await until(() =>
          events.some(
            (event) =>
              event.type === "notice" && event.message.startsWith("已选择模型"),
          ),
        );
        ui.setEditorText("unfinished");
        await host.action({
          action: "prompt",
          args: { message: "slow-response" },
        });
        await until(() => host.session.isStreaming);
        await host.action({
          action: "prompt",
          args: { message: "steering", mode: "steer" },
        });
        await host.action({
          action: "prompt",
          args: { message: "follow-up", mode: "followUp" },
        });
        const restored = await input("q", { altKey: true });
        assert.equal(
          restored.editor?.text,
          "steering\n\nfollow-up\n\nunfinished",
        );
        assert.deepEqual(host.snapshot().queue, { steering: [], followUp: [] });
        await host.action({
          action: "prompt",
          args: { message: "restored on abort", mode: "followUp" },
        });
        await input("Escape");
        if (modal) await input("Escape");
        await until(() => !host.snapshot().busy);
        assert.equal(
          ui.getEditorText(),
          "restored on abort\n\nsteering\n\nfollow-up\n\nunfinished",
        );
        const originalSession = host.session.sessionId;
        const path = host.session.sessionFile!;
        await host.action({ action: "session.new" });
        ui = host.session.extensionRunner.getUIContext();
        assert.equal(ui.getEditorText(), "");
        await host.action({ action: "session.switch", args: { path } });
        assert.equal(host.session.sessionId, originalSession);
        ui = host.session.extensionRunner.getUIContext();
        await until(() => ui.getEditorText().startsWith("restored on abort"));
        if (modal) await input("i");
        clipboard = "new clipboard";
        await input("f", { ctrlKey: true, altKey: true });
        await until(() => host.pendingDialogs.length === 1);
        const fork = host.pendingDialogs[0];
        host.answer(fork.id, fork.options![0]);
        await until(
          () =>
            host.session.sessionId !== originalSession &&
            !host.snapshot().changing,
        );
        ui = host.session.extensionRunner.getUIContext();
        await until(() => ui.getEditorText() === "Reply to copy");
        assert.equal(
          events.some(
            (event) => event.type === "notice" && event.level === "error",
          ),
          false,
          JSON.stringify(events.filter((event) => event.type === "notice")),
        );
      } finally {
        await host.dispose();
        await fixture.close();
      }
    },
  );

test(
  "clipboard prioritizes paths, converts images, replaces selections and rejects stale transfers",
  { timeout: 60000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const events: DesktopEvent[] = [];
    host.on("event", (event) => events.push(event));
    try {
      await host.initialize(fixture.cwd);
      const ui = host.session.extensionRunner.getUIContext();
      host.setClipboard({
        getFilePaths: async () => ["C:/path with spaces/file.png"],
        getImage: async () => {
          throw new Error("Image read should not run");
        },
        getText: async () => {
          throw new Error("Text read should not run");
        },
      });
      await host.action({
        action: "editor.update",
        args: { text: "aXYZb", selection: { start: 1, end: 4 } },
      });
      await host.action({ action: "clipboard.paste" });
      assert.equal(ui.getEditorText(), "a C:/path with spaces/file.png b");
      host.setClipboard({
        getFilePaths: async () => ["unsafe\npath"],
        getImage: async () => null,
        getText: async () => null,
      });
      await assert.rejects(
        host.action({ action: "clipboard.paste" }),
        /control characters/,
      );
      host.setClipboard({
        getImage: async () => png,
        getText: async () => {
          throw new Error("Text read should not run");
        },
      });
      const image = (await host.action({ action: "clipboard.paste" })) as {
        kind: string;
        data: string;
        mimeType: string;
      };
      assert.equal(image.kind, "image");
      assert.equal(image.mimeType, "image/png");
      assert.deepEqual(Buffer.from(image.data, "base64"), png);
      assert.ok(
        events.some(
          (event) =>
            event.type === "activity" &&
            event.name === "desktop_clipboard_image",
        ),
      );
      host.setClipboard({
        getImage: async () => Buffer.from("invalid image"),
        getText: async () => null,
      });
      await assert.rejects(host.action({ action: "clipboard.paste" }));
      let release!: (text: string) => void;
      host.setClipboard({
        getImage: async () => null,
        getText: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      });
      const paste = host.action({ action: "clipboard.paste" });
      await until(() => !!release);
      ui.setEditorText("Changed draft");
      release("stale clipboard");
      assert.deepEqual(await paste, { cancelled: true });
      assert.equal(ui.getEditorText(), "Changed draft");
      host.setClipboard({
        getImage: async () => undefined,
        getText: async () => undefined,
      });
      await assert.rejects(
        host.action({ action: "clipboard.paste" }),
        /unavailable/,
      );
      host.setClipboard({
        getImage: async () => null,
        getText: async () => null,
      });
      assert.deepEqual(await host.action({ action: "clipboard.paste" }), {
        kind: "empty",
      });
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "selectors cancel when sessions change and restored drafts cannot overwrite newer text",
  { timeout: 60000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      await host.action({
        action: "prompt",
        args: { message: "Tree user message" },
      });
      await until(() => !host.snapshot().busy);
      const path = host.session.sessionFile;
      const leaf = host.snapshot().leafId;
      const user = host.snapshot().tree.find((item) => item.role === "user")!;
      const tree = host.action({
        action: "session.selector",
        args: { kind: "tree", summarize: false },
      });
      await until(() => host.pendingDialogs.length === 1);
      const dialog = host.pendingDialogs[0];
      const index = host
        .snapshot()
        .tree.findIndex((item) => item.id === user.id);
      host.answer(dialog.id, dialog.options![index]);
      await tree;
      assert.notEqual(host.snapshot().leafId, leaf);
      assert.equal(
        host.session.extensionRunner.getUIContext().getEditorText(),
        "Tree user message",
      );
      const model = host.action({ action: "model.select" });
      await until(() => host.pendingDialogs.length === 1);
      await host.action({ action: "session.new" });
      assert.deepEqual(await model, { cancelled: true });
      assert.equal(host.pendingDialogs.length, 0);
      const resume = host.action({
        action: "session.selector",
        args: { kind: "resume" },
      });
      await until(() => host.pendingDialogs.length === 1);
      const resumeDialog = host.pendingDialogs[0];
      host.answer(resumeDialog.id, resumeDialog.options![0]);
      await resume;
      assert.equal(host.session.sessionFile, path);
      const revision = host.snapshot().editor.revision;
      host.session.extensionRunner.getUIContext().setEditorText("New text");
      await host.action({
        action: "editor.restore",
        args: {
          sessionId: host.session.sessionId,
          revision,
          text: "Stale cached draft",
        },
      });
      assert.equal(
        host.session.extensionRunner.getUIContext().getEditorText(),
        "New text",
      );
      await host.action({
        action: "editor.update",
        args: { sessionId: "obsolete-session", text: "Stale update" },
      });
      assert.equal(
        host.session.extensionRunner.getUIContext().getEditorText(),
        "New text",
      );
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);
