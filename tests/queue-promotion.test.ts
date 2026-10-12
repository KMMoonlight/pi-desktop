import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

test("promoting one follow-up preserves duplicate messages, images, other queues and stale-click safety", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const session = host.session;
    const image = { type: "image" as const, mimeType: "image/png", data: "aW1hZ2U=" };
    await session.steer("existing steering");
    await session.followUp("duplicate", [image]);
    await session.followUp("duplicate");
    await session.followUp("last message");
    session.extensionRunner.getUIContext().setEditorText("unfinished draft");
    const ids = host.snapshot().queue.followUpIds!;
    assert.equal(new Set(ids).size, 3);
    assert.deepEqual(host.snapshot().queue.followUpIds, ids);
    const result = await host.action({ action: "queue.promote", args: { id: ids[0] } });
    assert.deepEqual(result, { promoted: true });
    assert.deepEqual(session.getSteeringMessages(), ["existing steering", "duplicate"]);
    assert.deepEqual(session.getFollowUpMessages(), ["duplicate", "last message"]);
    session.agent.steeringMode = "all";
    const promoted = session.agent.peekQueuedMessages()[1];
    assert.equal(promoted.role, "user");
    assert.ok("content" in promoted && Array.isArray(promoted.content));
    assert.deepEqual(promoted.content, [{ type: "text", text: "duplicate" }, image]);
    assert.equal(session.extensionRunner.getUIContext().getEditorText(), "unfinished draft");
    assert.deepEqual(await host.action({ action: "queue.promote", args: { id: ids[0] } }), { promoted: false });
    assert.deepEqual(host.snapshot().queue.followUpIds, ids.slice(1));
    // Retrieving/consuming an item also makes an old card harmless.
    session.clearQueue();
    assert.deepEqual(await host.action({ action: "queue.promote", args: { id: ids[1] } }), { promoted: false });
    assert.equal(session.agent.hasQueuedMessages(), false);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("a promoted message reaches the real agent loop exactly once", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await host.action({ action: "prompt", args: { message: "slow-response promotion check" } });
    const until = async (condition: () => boolean) => {
      const deadline = Date.now() + 15000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for queued delivery");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    await until(() => host.session.isStreaming);
    await host.session.followUp("promoted once");
    const id = host.snapshot().queue.followUpIds![0];
    await host.action({ action: "queue.promote", args: { id } });
    await until(() => !host.snapshot().busy);
    const delivered = host.snapshot().messages.filter(message => message.role === "user" &&
      message.content.some(block => block.type === "text" && block.text === "promoted once"));
    assert.equal(delivered.length, 1);
    assert.deepEqual(host.snapshot().queue, { steering: [], followUp: [], followUpIds: [] });
    assert.deepEqual(await host.action({ action: "queue.promote", args: { id } }), { promoted: false });
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
