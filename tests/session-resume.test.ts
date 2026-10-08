import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

async function sessionIds(host: DesktopHost) {
  const sessions = (await host.action({
    action: "sessions.list",
    args: { all: true },
  })) as { id: string }[];
  return sessions.map((item) => item.id).sort();
}

for (const custom of [false, true]) {
  test(`relaunch restores the last selected session without adding sessions (${custom ? "shared custom" : "default"} directory)`, async () => {
    const fixture = await createFixture();
    let host = new DesktopHost(fixture.agentDir);
    try {
      if (custom) {
        const path = join(fixture.agentDir, "settings.json");
        const settings = JSON.parse(await readFile(path, "utf8"));
        await writeFile(
          path,
          JSON.stringify({
            ...settings,
            sessionDir: join(fixture.root, "shared-sessions"),
          }),
        );
      }
      await host.initialize(fixture.cwd);
      await host.action({ action: "session.new" });
      const first = host.snapshot();
      await host.action({
        action: "session.name",
        args: { name: "上次打开的会话" },
      });
      await host.action({
        action: "prompt",
        args: { message: "Keep this conversation when reopening the app" },
      });
      const deadline = Date.now() + 15000;
      while (host.snapshot().busy) {
        assert.ok(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const messages = host
        .snapshot()
        .messages.map((message) => message.content);
      await host.action({ action: "session.new" });
      const second = host.snapshot();
      assert.notEqual(first.sessionId, second.sessionId);
      await host.action({
        action: "session.name",
        args: { name: "较新的会话" },
      });
      // Selecting an older session does not modify its transcript timestamp.
      await host.action({
        action: "session.switch",
        args: { path: first.sessionFile },
      });
      const ids = await sessionIds(host);
      for (let attempt = 0; attempt < 2; attempt++) {
        await host.dispose();
        host = new DesktopHost(fixture.agentDir);
        const resumed = (await host.action({
          action: "initialize",
          args: { cwd: fixture.cwd, resumeExisting: true },
        })) as DesktopSnapshot;
        assert.equal(resumed.sessionId, first.sessionId);
        assert.equal(resumed.sessionName, "上次打开的会话");
        assert.deepEqual(
          resumed.messages.map((message) => message.content),
          messages,
        );
        assert.deepEqual(await sessionIds(host), ids);
      }
      // Deliberately creating a session still creates one, even in another workspace.
      const other = join(fixture.root, "other-workspace");
      await mkdir(other);
      await host.action({ action: "session.new", args: { cwd: other } });
      const otherFirst = host.snapshot();
      await host.initialize(fixture.cwd);
      assert.equal(host.snapshot().sessionId, first.sessionId);
      await host.action({ action: "session.new", args: { cwd: other } });
      const otherSecond = host.snapshot();
      assert.notEqual(otherSecond.sessionId, otherFirst.sessionId);
      await host.dispose();
      host = new DesktopHost(fixture.agentDir);
      await host.initialize(fixture.cwd);
      assert.equal(host.snapshot().sessionId, first.sessionId);
      await host.initialize(other);
      assert.equal(host.snapshot().sessionId, otherSecond.sessionId);
      // A deliberately created, empty session also resumes across relaunches.
      await host.action({
        action: "session.switch",
        args: { path: second.sessionFile },
      });
      await host.dispose();
      host = new DesktopHost(fixture.agentDir);
      await host.initialize(fixture.cwd);
      assert.equal(host.snapshot().sessionId, second.sessionId);
      assert.equal(host.snapshot().messages.length, 0);
      const beforeFallback = await sessionIds(host);
      await host.dispose();
      // A removed saved session must not be re-created as a new blank transcript.
      await unlink(second.sessionFile!);
      host = new DesktopHost(fixture.agentDir);
      await host.initialize(fixture.cwd);
      assert.equal(host.snapshot().sessionId, first.sessionId);
      assert.deepEqual(
        await sessionIds(host),
        beforeFallback.filter((id) => id !== second.sessionId),
      );
      await host.dispose();
      // Older installations have no last-opened record; reuse existing history.
      await rm(join(fixture.agentDir, "desktop", "active-sessions.json"), {
        force: true,
      });
      host = new DesktopHost(fixture.agentDir);
      await host.initialize(fixture.cwd);
      assert.equal(host.snapshot().sessionId, first.sessionId);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  });
}

for (const custom of [false, true]) {
  test(`a workspace without history stays unsaved until explicit creation or a real message (${custom ? "custom" : "default"} directory)`, async () => {
    const fixture = await createFixture();
    let host = new DesktopHost(fixture.agentDir);
    try {
      if (custom) {
        const path = join(fixture.agentDir, "settings.json");
        const settings = JSON.parse(await readFile(path, "utf8"));
        await writeFile(
          path,
          JSON.stringify({
            ...settings,
            sessionDir: join(fixture.root, "shared-sessions"),
          }),
        );
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const blank = await host.initialize(fixture.cwd);
        assert.equal(blank.sessionFile, undefined);
        assert.deepEqual(await sessionIds(host), []);
        await assert.rejects(
          readFile(host.session.sessionManager.getSessionFile()!, "utf8"),
          { code: "ENOENT" },
        );
        await host.action({
          action: "editor.update",
          args: { sessionId: blank.sessionId, text: "Unsent workspace draft" },
        });
        await host.action({
          action: "display.thinking",
          args: { visible: true },
        });
        await host.action({ action: "theme.set", args: { theme: "dark" } });
        assert.deepEqual(await sessionIds(host), []);
        await assert.rejects(
          readFile(
            join(fixture.agentDir, "desktop", "active-sessions.json"),
            "utf8",
          ),
          { code: "ENOENT" },
        );
        await host.dispose();
        host = new DesktopHost(fixture.agentDir);
      }
      const draft = await host.initialize(fixture.cwd);
      await assert.rejects(
        host.action({ action: "prompt", args: { message: "" } }),
      );
      assert.deepEqual(await sessionIds(host), []);
      await host.action({
        action: "prompt",
        args: { message: "First real conversation" },
      });
      const deadline = Date.now() + 15000;
      while (host.snapshot().busy) {
        assert.ok(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const sent = host.snapshot();
      assert.equal(sent.sessionId, draft.sessionId);
      assert.ok(sent.sessionFile);
      assert.deepEqual(await sessionIds(host), [sent.sessionId]);
      await host.dispose();
      host = new DesktopHost(fixture.agentDir);
      const restored = await host.initialize(fixture.cwd);
      assert.equal(restored.sessionId, sent.sessionId);
      assert.ok(restored.messages.some((message) => message.role === "user"));
      // Explicit creation works even when another workspace's history shares the directory.
      const other = join(fixture.root, "no-history-workspace");
      await mkdir(other);
      const blank = await host.initialize(other);
      assert.equal(blank.sessionFile, undefined);
      assert.deepEqual(await sessionIds(host), [sent.sessionId]);
      await host.action({ action: "session.new" });
      const created = host.snapshot();
      assert.ok(created.sessionFile);
      assert.deepEqual(created.messages, []);
      assert.equal((await sessionIds(host)).length, 2);
      await host.dispose();
      host = new DesktopHost(fixture.agentDir);
      assert.equal((await host.initialize(other)).sessionId, created.sessionId);
      assert.equal((await sessionIds(host)).length, 2);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  });
}
