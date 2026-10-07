import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { workspacePath } from "../backend/files.ts";
import { createFixture } from "./fixture.ts";

async function until(check: () => boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for SDK state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
test(
  "real SDK desktop lifecycle, tools, attachments, dialogs, cancellation and persistence",
  { timeout: 90000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const events: any[] = [];
    host.on("event", (event) => events.push(event));
    try {
      const initial = await host.initialize(fixture.cwd);
      assert.equal(initial.model?.provider, "desktop-test");
      assert.equal(initial.busy, false);
      assert.ok(initial.commands.some((c) => c.name === "desktop-dialog"));
      assert.equal(
        initial.diagnostics.length,
        0,
        JSON.stringify(initial.diagnostics),
      );
      await host.action({
        action: "prompt",
        args: { message: "run-tool", files: ["test-note.txt"] },
      });
      await until(() => !host.snapshot().busy);
      const completed = host.snapshot();
      assert.ok(
        completed.messages.some((m) => m.role === "toolResult" && !m.isError),
      );
      assert.ok(
        completed.messages.some((m) =>
          m.content.some((b) => b.text?.includes("tool verified")),
        ),
      );
      assert.ok(
        JSON.stringify(fixture.requests[0]).includes(
          "Real file attachment content.",
        ),
      );
      assert.ok(
        events.some(
          (e) => e.type === "activity" && e.name === "tool_execution_start",
        ),
      );
      assert.ok(events.some((e) => e.type === "snapshot" && e.data.streaming));
      const path = completed.sessionFile!;
      assert.ok((await readFile(path, "utf8")).includes("run-tool"));
      const user = completed.messages.find((m) => m.role === "user")!;
      await host.action({
        action: "session.name",
        args: { name: "Verified session" },
      });
      await host.action({ action: "session.new" });
      assert.notEqual(host.snapshot().sessionId, completed.sessionId);
      await host.action({ action: "session.switch", args: { path } });
      assert.equal(host.snapshot().sessionName, "Verified session");
      assert.equal(host.snapshot().cwd, fixture.cwd);
      await host.action({ action: "session.fork", args: { id: user.entryId } });
      assert.ok(
        events.some((e) => e.type === "editor" && e.text.includes("run-tool")),
      );
      await host.action({
        action: "prompt",
        args: { message: "/desktop-dialog" },
      });
      await until(() => host.pendingDialogs.length > 0);
      await assert.rejects(host.action({ action: "session.new" }), /停止/);
      await host.action({
        action: "dialog.answer",
        args: { id: host.pendingDialogs[0].id, value: true },
      });
      await until(() => host.pendingDialogs[0]?.kind === "input");
      assert.equal(host.pendingDialogs[0].placeholder, "Value");
      await host.action({
        action: "dialog.answer",
        args: { id: host.pendingDialogs[0].id, value: "Desktop answer" },
      });
      await until(() => !host.snapshot().busy);
      assert.equal(host.snapshot().statuses.fixture, "dialog-completed");
      assert.equal(
        host.snapshot().widgets.fixture[0],
        "Desktop extension widget",
      );
      await host.action({
        action: "prompt",
        args: { message: "/desktop-custom" },
      });
      await until(() => !host.snapshot().busy);
      assert.ok(
        events.some((e) => e.type === "notice" && e.message.includes("TUI")),
      );
      await host.action({
        action: "prompt",
        args: { message: "slow-response" },
      });
      await until(() => host.session.isStreaming);
      await host.action({
        action: "prompt",
        args: { message: "queued", mode: "followUp" },
      });
      assert.ok(host.snapshot().queue.followUp.includes("queued"));
      await host.action({ action: "queue.clear" });
      await host.action({ action: "abort" });
      await until(() => !host.snapshot().busy);
      const settings = {
        ...host.snapshot().globalSettings,
        defaultThinkingLevel: "off",
        retry: { enabled: false, maxRetries: 1 },
      };
      const saved = (await host.action({
        action: "settings.save",
        args: { scope: "global", settings },
      })) as ReturnType<DesktopHost["snapshot"]>;
      assert.equal(saved.busy, false);
      assert.equal(
        JSON.parse(
          await readFile(join(fixture.agentDir, "settings.json"), "utf8"),
        ).retry.maxRetries,
        1,
      );
      await host.action({
        action: "session.label",
        args: { id: host.snapshot().leafId, label: "checkpoint" },
      });
      const exportPath = join(fixture.root, "export.jsonl");
      await host.action({
        action: "session.export",
        args: { path: exportPath, format: "jsonl" },
      });
      assert.ok((await readFile(exportPath, "utf8")).includes("checkpoint"));
      await assert.rejects(
        host.action({
          action: "prompt",
          args: { message: "bad", files: ["../agent/settings.json"] },
        }),
        /工作区/,
      );
      await assert.rejects(
        workspacePath(fixture.cwd, "../agent/settings.json"),
        /工作区/,
      );
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "configured session directory and simultaneous workspace initialization",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      const path = join(fixture.agentDir, "settings.json");
      const settings = JSON.parse(await readFile(path, "utf8"));
      const custom = join(fixture.root, "custom-sessions");
      await writeFile(
        path,
        JSON.stringify({ ...settings, sessionDir: custom }),
      );
      const initializing = host.initialize(fixture.cwd);
      await assert.rejects(host.initialize(fixture.cwd), /切换/);
      await initializing;
      assert.equal(host.session.sessionManager.getSessionDir(), custom);
      const controller = new AbortController();
      const pending = host.ask(
        { kind: "input", title: "Abort dialog" },
        controller.signal,
      );
      controller.abort();
      assert.equal(await pending, undefined);
      assert.equal(host.pendingDialogs.length, 0);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);
