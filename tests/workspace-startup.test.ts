import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type {
  DesktopSnapshot,
  DesktopSettingsSnapshot,
} from "../shared/types.ts";

test("startup stays empty until a workspace is explicitly selected", async () => {
  const fixture = await createFixture();
  const initialCwd = process.env.PI_DESKTOP_CWD;
  delete process.env.PI_DESKTOP_CWD;
  const host = new DesktopHost(fixture.agentDir);
  try {
    assert.equal(
      await host.action({
        action: "initialize",
        args: { resumeExisting: true },
      }),
      null,
    );
    assert.equal(host.runtime, undefined);
    await assert.rejects(access(join(fixture.agentDir, "desktop.json")), {
      code: "ENOENT",
    });

    const selected = (await host.action({
      action: "initialize",
      args: { cwd: fixture.cwd },
    })) as DesktopSnapshot;
    assert.equal(selected.cwd, fixture.cwd);
    assert.deepEqual(selected.recentWorkspaces, [fixture.cwd]);
    const resumed = (await host.action({
      action: "initialize",
      args: { resumeExisting: true },
    })) as DesktopSnapshot;
    assert.equal(resumed.sessionId, selected.sessionId);
  } finally {
    if (initialCwd === undefined) delete process.env.PI_DESKTOP_CWD;
    else process.env.PI_DESKTOP_CWD = initialCwd;
    await host.dispose();
    await fixture.close();
  }
});

test("global settings work without creating a workspace or session", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    const initial = (await host.action({
      action: "settings.snapshot",
    })) as DesktopSettingsSnapshot;
    assert.equal(initial.cwd, "");
    assert.ok(initial.models.some((m) => m.id === "desktop-test"));
    await host.action({
      action: "settings.save",
      args: {
        settings: { ...initial.globalSettings, defaultThinkingLevel: "high" },
      },
    });
    await host.action({ action: "theme.set", args: { theme: "dark" } });
    await host.action({
      action: "config.save",
      args: { name: "mcp.json", content: "{}" },
    });
    assert.equal(
      await host.action({ action: "config.read", args: { name: "mcp.json" } }),
      "{}",
    );
    const updated = (await host.action({
      action: "settings.snapshot",
    })) as DesktopSettingsSnapshot;
    assert.equal(updated.globalSettings.defaultThinkingLevel, "high");
    assert.equal(updated.globalSettings.theme, "dark");
    await assert.rejects(
      host.action({
        action: "settings.save",
        args: { scope: "project", settings: {} },
      }),
      /请先选择工作区/,
    );
    assert.equal(host.runtime, undefined);
    await assert.rejects(access(join(fixture.agentDir, "desktop.json")), {
      code: "ENOENT",
    });
    assert.deepEqual(await host.action({ action: "packages.list" }), []);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("legacy automatic workspace registrations are not merged into user selections", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await writeFile(
      join(fixture.agentDir, "desktop.json"),
      JSON.stringify({ workspaces: [process.cwd()], keep: "preference" }),
    );
    await host.initialize(fixture.cwd);
    assert.deepEqual(host.snapshot().recentWorkspaces, [fixture.cwd]);
    const stored = JSON.parse(
      await readFile(join(fixture.agentDir, "desktop.json"), "utf8"),
    );
    assert.deepEqual(stored.selectedWorkspaces, [fixture.cwd]);
    assert.equal(stored.keep, "preference");
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("provider API key login and logout do not need a workspace", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  host.on("event", (event) => {
    if (event.type === "dialog") host.answer(event.data.id, "test-only-key");
  });
  try {
    await host.action({
      action: "auth.login",
      args: { provider: "openai", method: "api_key" },
    });
    const loggedIn = (await host.action({
      action: "settings.snapshot",
    })) as DesktopSettingsSnapshot;
    assert.equal(
      loggedIn.providers.find((p) => p.id === "openai")?.configured,
      true,
    );
    await host.action({ action: "auth.logout", args: { provider: "openai" } });
    assert.equal(host.runtime, undefined);
    await assert.rejects(access(join(fixture.agentDir, "desktop.json")), {
      code: "ENOENT",
    });
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("an explicit PI_DESKTOP_CWD still selects the initial workspace", async () => {
  const fixture = await createFixture();
  const initialCwd = process.env.PI_DESKTOP_CWD;
  process.env.PI_DESKTOP_CWD = fixture.cwd;
  const host = new DesktopHost(fixture.agentDir);
  try {
    const selected = (await host.action({
      action: "initialize",
    })) as DesktopSnapshot;
    assert.equal(selected.cwd, fixture.cwd);
  } finally {
    if (initialCwd === undefined) delete process.env.PI_DESKTOP_CWD;
    else process.env.PI_DESKTOP_CWD = initialCwd;
    await host.dispose();
    await fixture.close();
  }
});
