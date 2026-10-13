import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

test("sidebar tool choices and thinking visibility survive relaunch before sending a message", async () => {
  const fixture = await createFixture();
  let host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const original = host
      .snapshot()
      .tools.filter((tool) => tool.active)
      .map((tool) => tool.name);
    const added = host
      .snapshot()
      .tools.find((tool) => !tool.active && tool.exposure !== "hidden")!;
    assert.ok(added, "fixture must have an inactive tool");
    for (const enabled of [true, false]) {
      const names = enabled
        ? [...original, added.name]
        : original.filter((name) => name !== added.name);
      await host.action({ action: "tools.set", args: { names } });
      await host.action({
        action: "display.thinking",
        args: { visible: enabled },
      });
      await host.dispose();
      host = new DesktopHost(fixture.agentDir);
      const restored = await host.initialize(fixture.cwd);
      assert.equal(
        restored.tools.find((tool) => tool.name === added.name)?.active,
        enabled,
      );
      assert.equal(restored.settings.hideThinkingBlock, !enabled);
      if (enabled) assert.equal(restored.sessionFile, undefined);
      assert.deepEqual(restored.messages, []);
      await host.action({ action: "session.new" });
      assert.equal(
        host.snapshot().tools.find((tool) => tool.name === added.name)?.active,
        enabled,
      );
    }
    // Choices belong to the workspace; another workspace retains its defaults.
    const other = join(fixture.root, "other");
    await mkdir(other);
    await host.action({ action: "tools.set", args: { names: [] } });
    await host.initialize(other);
    assert.deepEqual(
      host
        .snapshot()
        .tools.filter((tool) => tool.active)
        .map((tool) => tool.name),
      original,
    );
    await host.initialize(fixture.cwd);
    assert.equal(host.snapshot().tools.filter((tool) => tool.active).length, 0);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("tool output expansion survives relaunch and is included in reconnect snapshots", async () => {
  const fixture = await createFixture();
  let host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    for (const expanded of [true, false]) {
      await host.action({ action: "display.tools", args: { expanded } });
      assert.equal(
        host.session.extensionRunner.getUIContext().getToolsExpanded(),
        expanded,
      );
      await host.dispose();
      host = new DesktopHost(fixture.agentDir);
      const restored = await host.initialize(fixture.cwd);
      assert.equal(
        host.session.extensionRunner.getUIContext().getToolsExpanded(),
        expanded,
      );
      assert.equal(restored.toolsExpanded, expanded);
    }
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
