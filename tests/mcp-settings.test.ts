import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readMcpSettings, changeMcpSettings } from "../backend/mcp-settings.ts";
import { DesktopHost } from "../backend/host.ts";
import type { McpSettingsSnapshot } from "../shared/types.ts";
import { createFixture } from "./fixture.ts";

test("MCP project settings inherit native transport/auth and write only overrides with native default semantics", async () => {
  const f = await createFixture();
  const globalPath = join(f.agentDir, "mcp.json"),
    projectPath = join(f.cwd, ".pi", "mcp.json");
  const global = JSON.stringify(
    {
      metadata: "preserved",
      mcpServers: {
        shared: {
          url: "https://fixture.example/mcp",
          auth: { provider: "openai" },
          headers: { "X-Fixture": "kept" },
          enabled: false,
          exposure: "direct",
        },
      },
    },
    null,
    4,
  );
  try {
    await writeFile(globalPath, global);
    await mkdir(join(f.cwd, ".pi"), { recursive: true });
    await writeFile(
      projectPath,
      JSON.stringify(
        {
          metadata: "project",
          mcpServers: {
            local: { command: "node", args: ["--version"], enabled: false },
          },
        },
        null,
        4,
      ),
    );
    let view = await readMcpSettings(f.agentDir, f.cwd, true, true);
    const inherited = view.servers.find((server) => server.name === "shared")!;
    assert.equal(inherited.inherited, true);
    assert.equal(inherited.overridden, false);
    assert.equal(inherited.config.url, "https://fixture.example/mcp");
    assert.deepEqual(inherited.config.auth, { provider: "openai" });
    await changeMcpSettings(f.agentDir, f.cwd, true, true, {
      name: "shared",
      enabled: true,
    });
    await changeMcpSettings(f.agentDir, f.cwd, true, true, {
      name: "shared",
      exposure: "codemode",
    });
    let project = JSON.parse(await readFile(projectPath, "utf8"));
    assert.deepEqual(project.mcpServers.shared, {
      enabled: true,
      exposure: "codemode",
    });
    assert.equal(project.metadata, "project");
    assert.equal(project.mcpServers.local.command, "node");
    assert.equal(await readFile(globalPath, "utf8"), global);
    view = await readMcpSettings(f.agentDir, f.cwd, true, true);
    assert.equal(
      view.servers.find((server) => server.name === "shared")!.overridden,
      true,
    );
    assert.equal(
      view.servers.find((server) => server.name === "shared")!.config.exposure,
      "codemode",
    );
    await changeMcpSettings(f.agentDir, f.cwd, true, true, {
      name: "shared",
      remove: true,
    });
    view = await readMcpSettings(f.agentDir, f.cwd, true, true);
    assert.equal(
      view.servers.find((server) => server.name === "shared")!.config.enabled,
      false,
    );
    assert.equal(
      view.servers.find((server) => server.name === "shared")!.config.exposure,
      "direct",
    );
    project = JSON.parse(await readFile(projectPath, "utf8"));
    assert.equal(project.mcpServers.shared, undefined);
    assert.equal(project.mcpServers.local.command, "node");
    assert.equal(await readFile(globalPath, "utf8"), global);
    await changeMcpSettings(f.agentDir, f.cwd, false, false, {
      name: "shared",
      enabled: true,
      exposure: "codemode",
    });
    const saved = JSON.parse(await readFile(globalPath, "utf8"));
    assert.equal(saved.mcpServers.shared.enabled, undefined);
    assert.equal(saved.mcpServers.shared.exposure, undefined);
    assert.deepEqual(saved.mcpServers.shared.auth, { provider: "openai" });
    assert.equal(saved.metadata, "preserved");
  } finally {
    await f.close();
  }
});

test("untrusted projects cannot write MCP overrides; full project definitions replace globals and removal restores inheritance", async () => {
  const f = await createFixture();
  try {
    await writeFile(
      join(f.agentDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: { url: "https://global.example/mcp", enabled: false },
        },
      }),
    );
    await mkdir(join(f.cwd, ".pi"), { recursive: true });
    const path = join(f.cwd, ".pi", "mcp.json");
    const raw = JSON.stringify({
      mcpServers: { shared: { command: "node", enabled: false } },
    });
    await writeFile(path, raw);
    const untrusted = await readMcpSettings(f.agentDir, f.cwd, true, false);
    assert.equal(untrusted.servers[0].config.url, "https://global.example/mcp");
    await assert.rejects(
      changeMcpSettings(f.agentDir, f.cwd, true, false, {
        name: "shared",
        enabled: true,
      }),
      /请先信任/,
    );
    assert.equal(await readFile(path, "utf8"), raw);
    const trusted = await readMcpSettings(f.agentDir, f.cwd, true, true);
    assert.equal(trusted.servers[0].inherited, false);
    assert.equal(trusted.servers[0].config.command, "node");
    await assert.rejects(
      changeMcpSettings(f.agentDir, f.cwd, true, true, {
        name: "shared",
        exposure: "invalid",
      }),
      /格式错误/,
    );
    assert.equal(await readFile(path, "utf8"), raw);
    await changeMcpSettings(f.agentDir, f.cwd, true, true, {
      name: "shared",
      remove: true,
    });
    assert.equal(
      (await readMcpSettings(f.agentDir, f.cwd, true, true)).servers[0]
        .inherited,
      true,
    );
  } finally {
    await f.close();
  }
});

test("MCP settings actions work globally without a workspace and reload project overrides in an active session", async () => {
  const f = await createFixture();
  const host = new DesktopHost(f.agentDir);
  try {
    await writeFile(
      join(f.agentDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: { url: "https://fixture.example/mcp", enabled: false },
        },
      }),
    );
    let view = (await host.action({
      action: "mcp.config",
    })) as McpSettingsSnapshot;
    assert.equal(view.servers[0].name, "shared");
    view = (await host.action({
      action: "mcp.configure",
      args: { name: "shared", exposure: "direct" },
    })) as McpSettingsSnapshot;
    assert.equal(view.servers[0].config.exposure, "direct");
    await assert.rejects(
      host.action({
        action: "mcp.configure",
        args: { name: "shared", local: true, enabled: false },
      }),
      /选择工作区/,
    );
    await host.initialize(f.cwd);
    view = (await host.action({
      action: "mcp.configure",
      args: { name: "shared", local: true, exposure: "hidden" },
    })) as McpSettingsSnapshot;
    assert.equal(view.servers[0].overridden, true);
    assert.equal(view.servers[0].config.exposure, "hidden");
    assert.equal(host.snapshot().changing, false);
    const settings = await readMcpSettings(f.agentDir, f.cwd, false, true);
    assert.equal(settings.servers[0].config.exposure, "direct");
  } finally {
    await host.dispose();
    await f.close();
  }
});
