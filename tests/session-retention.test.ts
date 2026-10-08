import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { persistDesktopSession } from "../backend/session-history.ts";
import { createFixture } from "./fixture.ts";

for (const custom of [false, true]) {
  test(
    `unsent desktop sessions survive switching and host restart (${custom ? "custom" : "default"} session directory)`,
    { timeout: 40000 },
    async () => {
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
              sessionDir: join(fixture.root, "saved-sessions"),
            }),
          );
        }
        await host.initialize(fixture.cwd);
        await host.action({ action: "session.new" });
        const first = host.snapshot();
        await host.action({ action: "session.new" });
        const second = host.snapshot();
        assert.notEqual(first.sessionId, second.sessionId);
        assert.equal(second.messages.length, 0);
        const header = JSON.parse(
          (await readFile(second.sessionFile!, "utf8")).split("\n")[0],
        );
        assert.equal(header.id, second.sessionId);
        for (const all of [false, true]) {
          const sessions = (await host.action({
            action: "sessions.list",
            args: { all },
          })) as { id: string; messageCount: number }[];
          assert.ok(sessions.some((item) => item.id === first.sessionId));
          assert.equal(
            sessions.find((item) => item.id === second.sessionId)?.messageCount,
            0,
          );
        }
        await host.action({
          action: "session.name",
          args: { name: "未发送的任务" },
        });
        await host.action({
          action: "session.switch",
          args: { path: first.sessionFile },
        });
        await host.action({
          action: "session.switch",
          args: { path: second.sessionFile },
        });
        assert.equal(host.snapshot().sessionId, second.sessionId);
        assert.equal(host.snapshot().sessionName, "未发送的任务");
        assert.equal(host.snapshot().messages.length, 0);
        await host.dispose();
        host = new DesktopHost(fixture.agentDir);
        await host.initialize(fixture.cwd);
        await host.action({
          action: "session.switch",
          args: { path: second.sessionFile },
        });
        assert.equal(host.snapshot().sessionId, second.sessionId);
        assert.equal(host.snapshot().sessionName, "未发送的任务");
        await host.action({
          action: "prompt",
          args: { message: "The first real message" },
        });
        const deadline = Date.now() + 15000;
        while (host.snapshot().busy) {
          assert.ok(Date.now() < deadline, "SDK response did not finish");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(
          host.snapshot().messages.filter((item) => item.role === "user")
            .length,
          1,
        );
        const reopened = SessionManager.open(second.sessionFile!);
        assert.equal(reopened.getSessionId(), second.sessionId);
        assert.equal(
          reopened
            .buildSessionContext()
            .messages.filter((item) => item.role === "user").length,
          1,
        );
      } finally {
        await host.dispose();
        await fixture.close();
      }
    },
  );
}

test("desktop retention leaves explicit in-memory SDK sessions in memory", () => {
  const manager = SessionManager.inMemory();
  persistDesktopSession(manager);
  assert.equal(manager.getSessionFile(), undefined);
  assert.equal(manager.isPersisted(), false);
});
