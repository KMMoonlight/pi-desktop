import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopEvent, DesktopSnapshot } from "../shared/types.ts";

test("mutation response reuses its final published snapshot instead of rebuilding the history", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const published: DesktopSnapshot[] = [];
    host.on("event", (event: DesktopEvent) => {
      if (event.type === "snapshot") published.push(event.data);
    });
    const result = (await host.action({
      action: "thinking.set",
      args: { level: "off" },
    })) as DesktopSnapshot;
    assert.equal(result, published.at(-1));
    assert.equal(result.changing, false);
    assert.equal(published.filter((snapshot) => !snapshot.changing).length, 1);
    published.length = 0;
    const next = (await host.action({
      action: "session.new",
    })) as DesktopSnapshot;
    assert.equal(next, published.at(-1));
    assert.equal(next.changing, false);
    assert.ok(published.some((snapshot) => snapshot.changing));
    assert.notEqual(next.sessionId, result.sessionId);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
