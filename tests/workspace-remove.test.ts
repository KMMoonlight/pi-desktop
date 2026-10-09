import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

test("removing workspaces preserves files and sessions, switches selection and closes the last workspace", async () => {
  const fixture = await createFixture();
  let host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await host.action({ action: "session.new" });
    const original = host.snapshot();
    const other = join(fixture.root, "other-workspace");
    await mkdir(other);
    await writeFile(join(other, "keep.txt"), "Local files stay intact");
    await host.action({ action: "session.new", args: { cwd: other } });
    const second = host.snapshot();
    const remove = (cwd: string) =>
      host.action({ action: "workspace.remove", args: { cwd } });
    await remove(fixture.cwd);
    assert.equal(host.snapshot().sessionId, second.sessionId);
    assert.deepEqual(await host.action({ action: "workspaces.list" }), [other]);
    await access(original.sessionFile!);
    await host.action({ action: "workspace.add", args: { cwd: fixture.cwd } });
    const next = (await remove(other)) as DesktopSnapshot;
    assert.equal(next.cwd, fixture.cwd);
    assert.equal(next.sessionId, original.sessionId);
    assert.equal(
      await readFile(join(other, "keep.txt"), "utf8"),
      "Local files stay intact",
    );
    await access(second.sessionFile!);
    const events: string[] = [];
    host.on("event", (event) => events.push(event.type));
    assert.equal(await remove(fixture.cwd), null);
    assert.equal(host.runtime, undefined);
    assert.ok(events.includes("workspace_closed"));
    assert.ok(!events.includes("shutdown"));
    assert.deepEqual(await host.action({ action: "workspaces.list" }), []);
    await host.dispose();
    host = new DesktopHost(fixture.agentDir);
    assert.deepEqual(await host.action({ action: "workspaces.list" }), []);
    assert.equal(host.runtime, undefined);
    const restored = await host.initialize(other);
    assert.equal(restored.sessionId, second.sessionId);
    assert.deepEqual(restored.recentWorkspaces, [other]);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("an unavailable workspace can be removed without opening or deleting it", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    const missing = join(fixture.root, "unavailable-workspace");
    await writeFile(
      join(fixture.agentDir, "desktop.json"),
      JSON.stringify({ selectedWorkspaces: [missing], keep: "preference" }),
    );
    await host.action({ action: "workspace.remove", args: { cwd: missing } });
    assert.deepEqual(await host.action({ action: "workspaces.list" }), []);
    assert.equal(host.runtime, undefined);
    assert.equal(
      JSON.parse(await readFile(join(fixture.agentDir, "desktop.json"), "utf8"))
        .keep,
      "preference",
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
