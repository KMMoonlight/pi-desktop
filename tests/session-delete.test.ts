import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  persistDesktopSession,
  rememberDesktopSession,
} from "../backend/session-history.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopSnapshot, SessionItem } from "../shared/types.ts";

const history = (host: DesktopHost) =>
  host.action({
    action: "sessions.list",
    args: { all: true },
  }) as Promise<SessionItem[]>;
const remove = (host: DesktopHost, session: DesktopSnapshot) =>
  host.action({
    action: "session.delete",
    args: { id: session.sessionId, path: session.sessionFile },
  });

for (const custom of [false, true]) {
  test(`deleting sessions preserves selection and returns to an unsaved empty workspace (${custom ? "custom" : "default"} directory)`, async () => {
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
      await host.action({ action: "session.new" });
      const second = host.snapshot();
      await host.action({ action: "session.new" });
      const third = host.snapshot();
      await remove(host, first);
      assert.equal(host.snapshot().sessionId, third.sessionId);
      await assert.rejects(access(first.sessionFile!), { code: "ENOENT" });
      assert.equal((await history(host)).length, 2);
      await remove(host, third);
      assert.equal(host.snapshot().sessionId, second.sessionId);
      assert.deepEqual(
        (await history(host)).map((item) => item.id),
        [second.sessionId],
      );
      await remove(host, second);
      assert.equal(host.snapshot().sessionFile, undefined);
      assert.deepEqual(host.snapshot().messages, []);
      assert.deepEqual(await history(host), []);
      const selected = JSON.parse(
        await readFile(
          join(fixture.agentDir, "desktop", "active-sessions.json"),
          "utf8",
        ),
      );
      assert.equal(selected[fixture.cwd], undefined);
      await host.dispose();
      host = new DesktopHost(fixture.agentDir);
      await host.initialize(fixture.cwd);
      assert.equal(host.snapshot().sessionFile, undefined);
      assert.deepEqual(await history(host), []);
      // Sending from the empty state persists only the newly started conversation.
      await host.action({
        action: "prompt",
        args: { message: "Start after deleting the last session" },
      });
      const deadline = Date.now() + 15000;
      while (host.snapshot().busy) {
        assert.ok(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal((await history(host)).length, 1);
      assert.ok(host.snapshot().sessionFile);
      assert.notEqual(host.snapshot().sessionId, second.sessionId);
      await assert.rejects(access(second.sessionFile!), { code: "ENOENT" });
    } finally {
      await host.dispose();
      await fixture.close();
    }
  });
}

test("deleting a session in another workspace clears its remembered selection without switching workspaces", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await host.action({ action: "session.new" });
    const original = host.snapshot();
    const otherCwd = join(fixture.root, "other-workspace");
    await mkdir(otherCwd);
    await host.action({ action: "session.new", args: { cwd: otherCwd } });
    const other = host.snapshot();
    await host.initialize(fixture.cwd);
    await remove(host, other);
    assert.equal(host.snapshot().sessionId, original.sessionId);
    assert.equal(host.snapshot().cwd, fixture.cwd);
    const selected = JSON.parse(
      await readFile(
        join(fixture.agentDir, "desktop", "active-sessions.json"),
        "utf8",
      ),
    );
    assert.equal(selected[otherCwd], undefined);
    await host.initialize(otherCwd);
    assert.equal(host.snapshot().sessionFile, undefined);
    assert.deepEqual(
      (await history(host)).map((item) => item.id),
      [original.sessionId],
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("deletion rejects unrelated paths, mismatched IDs and running sessions", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await host.action({ action: "session.new" });
    const current = host.snapshot();
    const unrelated = join(fixture.cwd, "keep.jsonl");
    await writeFile(unrelated, "keep me");
    for (const args of [
      { id: current.sessionId, path: unrelated },
      { id: "not-the-session", path: current.sessionFile },
    ])
      await assert.rejects(
        host.action({ action: "session.delete", args }),
        /会话不存在/,
      );
    assert.equal(await readFile(unrelated, "utf8"), "keep me");
    await access(current.sessionFile!);
    await host.action({
      action: "prompt",
      args: { message: "streaming-final-usage-probe" },
    });
    assert.equal(host.snapshot().busy, true);
    await assert.rejects(remove(host, current), /请先停止当前任务/);
    await access(current.sessionFile!);
    await host.action({ action: "abort" });
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("an extension that cancels leaving the current session also prevents its deletion", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    const directory = join(fixture.agentDir, "sessions", "delete-veto");
    const first = SessionManager.create(fixture.cwd, directory);
    const second = SessionManager.create(fixture.cwd, directory);
    persistDesktopSession(first);
    persistDesktopSession(second);
    rememberDesktopSession(fixture.agentDir, first);
    await writeFile(
      join(fixture.agentDir, "extensions", "delete-veto.ts"),
      'export default (pi) => { pi.on("session_before_switch", () => ({ cancel: true })); };',
    );
    await host.initialize(fixture.cwd);
    assert.equal(host.snapshot().sessionId, first.getSessionId());
    // The resume path and the empty-workspace path must both respect the veto.
    for (const last of [false, true]) {
      if (last)
        await host.action({
          action: "session.delete",
          args: { id: second.getSessionId(), path: second.getSessionFile() },
        });
      await assert.rejects(remove(host, host.snapshot()), /会话切换已取消/);
      assert.equal(host.snapshot().sessionId, first.getSessionId());
      await access(first.getSessionFile()!);
      assert.equal((await history(host)).length, last ? 1 : 2);
    }
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
