import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopEvent } from "../shared/types.ts";

test("prompt preparation publishes its new turn before running and cleans up attachment failures", { timeout: 30000 }, async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await host.action({ action: "prompt", args: { message: "completed-reply" } });
    await untilIdle(host);
    const message = "prepare-next-turn-with-attachment";
    const snapshots: { running: boolean; pending: string[]; hasUser: boolean }[] = [];
    host.on("event", (event: DesktopEvent) => {
      if (event.type !== "snapshot") return;
      const text = (blocks: typeof event.data.messages[number]["content"]) =>
        blocks.map(block => block.type === "text" ? block.text : "").join("\n");
      snapshots.push({
        running: event.data.running,
        pending: event.data.pendingPrompts?.map(prompt => text(prompt.content)) ?? [],
        hasUser: event.data.messages.some(item => item.role === "user" && text(item.content).startsWith(message)),
      });
    });
    await host.action({ action: "prompt", args: { message, files: ["test-note.txt"] } });
    await untilIdle(host);
    assert.equal(snapshots[0].running, true);
    assert.deepEqual(snapshots[0].pending, [message]);
    assert.equal(snapshots[0].hasUser, false);
    assert.ok(snapshots.every(snapshot => !snapshot.running || snapshot.hasUser || snapshot.pending.some(text => text.startsWith(message))));
    assert.ok(host.snapshot().messages.some(item => item.role === "user" && item.content.some(block => block.text?.includes("Real file attachment content."))));
    assert.deepEqual(host.snapshot().pendingPrompts, []);

    await assert.rejects(host.action({ action: "prompt", args: { message: "failed-preparation", files: ["missing-attachment.txt"] } }), /ENOENT/);
    assert.equal(host.snapshot().running, false);
    assert.deepEqual(host.snapshot().pendingPrompts, []);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

async function untilIdle(host: DesktopHost) {
  const deadline = Date.now() + 15000;
  while (host.snapshot().busy) {
    assert.ok(Date.now() < deadline, "Prompt did not finish");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
