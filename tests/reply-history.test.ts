import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { replySummary } from "../src/transcript-turns.ts";

test("completed tool loops collapse once and retain elapsed time after a fresh host loads history", { timeout: 30000 }, async () => {
  const fixture = await createFixture();
  let host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await host.action({ action: "prompt", args: { message: "activity-loop-probe" } });
    const deadline = Date.now() + 15000;
    while (host.snapshot().busy) {
      assert.ok(Date.now() < deadline);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const finished = host.snapshot();
    const calls = finished.messages.flatMap(message => message.content.filter(block => block.type === "toolCall"));
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.toolPresentation?.expanded === false));
    await host.action({ action: "transcript.tool", args: { sessionId: finished.sessionId, toolCallId: calls[2].id, expanded: true } });
    assert.equal(host.snapshot().messages.flatMap(message => message.content).find(block => block.id === calls[2].id)?.toolPresentation?.expanded, true);
    // Further snapshots must leave a manually reopened completed tool alone.
    assert.equal(host.snapshot().messages.flatMap(message => message.content).find(block => block.id === calls[2].id)?.toolPresentation?.expanded, true);
    const file = finished.sessionFile!;
    const disk = await readFile(file, "utf8");
    const messages = finished.messages.filter(message => message.role === "assistant");
    const liveElapsed = replySummary(messages.map(message => ({ kind: "message", message })))!.generation!.elapsedMs!;
    assert.ok(liveElapsed > 1000);
    await host.dispose();
    host = new DesktopHost(fixture.agentDir);
    await host.initialize(fixture.cwd);
    const reopened = host.snapshot().messages.filter(message => message.role === "assistant");
    assert.equal(reopened.length, 3);
    assert.ok(reopened.every(message => message.generation?.completed && message.generation.elapsedMs! > 0));
    const restored = replySummary(reopened.map(message => ({ kind: "message", message })))!;
    assert.ok(Math.abs(restored.generation!.elapsedMs! - liveElapsed) < 250);
    assert.equal(restored.outputTokens, 100);
    // Pi refreshes the serialized system prompt on restore; conversation entries
    // and generation timing must remain unchanged.
    const conversation = (contents: string) => contents.trim().split("\n")
      .map(line => JSON.parse(line))
      .filter(entry => entry.message?.role !== "system");
    assert.deepEqual(conversation(await readFile(file, "utf8")), conversation(disk));
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
