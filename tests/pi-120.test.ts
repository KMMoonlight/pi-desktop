import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  symlink,
  unlink,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { VERSION } from "@earendil-works/pi-coding-agent";
import {
  migratePi120Config,
  migratePi120ProjectSettings,
} from "../backend/pi-config-migration.ts";
import { DesktopHost } from "../backend/host.ts";
import { desktopMcpOptions } from "../backend/mcp-options.ts";
import { createFixture } from "./fixture.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Pi 1.2 integration did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));

test("Azure configuration migrates before SDK loading, preserves current values and file permissions", async () => {
  const f = await createFixture();
  try {
    const auth = join(f.agentDir, "auth.json"),
      settings = join(f.agentDir, "settings.json"),
      models = join(f.agentDir, "models.json");
    await writeFile(
      auth,
      JSON.stringify({
        "azure-openai-responses": { type: "api_key", key: "fixture-key" },
      }),
      { mode: 0o600 },
    );
    await writeFile(
      models,
      JSON.stringify({
        $schema: "https://pi.dev/schemas/models.schema.json",
        providers: {
          "azure-openai-responses": {
            baseUrl: "https://fixture.example",
            headers: { "X-Fixture": "kept" },
          },
          azure: { baseUrl: "https://current.example" },
          other: { models: [] },
        },
      }),
    );
    await writeFile(
      settings,
      JSON.stringify({
        defaultProvider: "azure-openai-responses",
        enabledModels: ["azure-openai-responses/*", "other/*"],
        modelThinkingLevels: {
          "azure-openai-responses/old": "high",
          "azure-openai-responses/shared": "low",
          "azure/shared": "max",
        },
        unrelated: true,
      }),
    );
    migratePi120Config(f.agentDir);
    assert.deepEqual(await json(auth), {
      azure: { type: "api_key", key: "fixture-key" },
    });
    assert.deepEqual((await json(models)).providers.azure, {
      baseUrl: "https://current.example",
      headers: { "X-Fixture": "kept" },
    });
    assert.equal((await json(settings)).defaultProvider, "azure");
    assert.deepEqual((await json(settings)).enabledModels, [
      "azure/*",
      "other/*",
    ]);
    assert.deepEqual((await json(settings)).modelThinkingLevels, {
      "azure/old": "high",
      "azure/shared": "max",
    });
    if (process.platform !== "win32")
      assert.equal((await stat(auth)).mode & 0o777, 0o600);
    const before = await readFile(settings, "utf8");
    migratePi120Config(f.agentDir);
    assert.equal(await readFile(settings, "utf8"), before);
    if (process.platform !== "win32") {
      const target = join(f.root, "linked-settings.json");
      await writeFile(
        target,
        JSON.stringify({ defaultProvider: "azure-openai-responses" }),
      );
      await unlink(settings);
      await symlink(target, settings);
      migratePi120Config(f.agentDir);
      assert.equal((await json(target)).defaultProvider, "azure");
      assert.ok((await lstat(settings)).isSymbolicLink());
    }
    await writeFile(models, "{ malformed");
    migratePi120Config(f.agentDir);
    assert.equal(await readFile(models, "utf8"), "{ malformed");
    await mkdir(join(f.cwd, ".pi"));
    await writeFile(
      join(f.cwd, ".pi", "settings.json"),
      JSON.stringify({ defaultProvider: "azure-openai-responses" }),
    );
    migratePi120ProjectSettings(f.cwd);
    assert.equal(
      (await json(join(f.cwd, ".pi", "settings.json"))).defaultProvider,
      "azure",
    );
  } finally {
    await f.close();
  }
});

test("MCP project overrides retain the global connection and credentials while changing exposure", async () => {
  const f = await createFixture();
  try {
    await mkdir(join(f.cwd, ".pi"));
    await writeFile(
      join(f.agentDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: {
            url: "https://fixture.example/mcp",
            headers: { Authorization: "Bearer fixture" },
            enabled: true,
          },
        },
      }),
    );
    await writeFile(
      join(f.cwd, ".pi", "mcp.json"),
      JSON.stringify({
        mcpServers: { shared: { enabled: false, exposure: "direct" } },
      }),
    );
    const options = await desktopMcpOptions(f.agentDir, () => {});
    const load = (trusted: boolean) =>
      options.loadConfig!({
        cwd: f.cwd,
        isProjectTrusted: () => trusted,
      } as Parameters<NonNullable<typeof options.loadConfig>>[0]);
    const global = await load(false),
      project = await load(true);
    assert.equal(global.servers[0].config.enabled, true);
    assert.equal(project.servers[0].config.enabled, false);
    assert.equal(project.servers[0].config.exposure, "direct");
    assert.ok("url" in project.servers[0].config);
    assert.deepEqual(project.servers[0].config.headers, {
      Authorization: "Bearer fixture",
    });
    assert.equal(project.projectConfig, join(f.cwd, ".pi", "mcp.json"));
    assert.deepEqual(project.errors, []);
  } finally {
    await f.close();
  }
});

test("tool duration, output padding and registered renderers survive a saved-session reload", async () => {
  const f = await createFixture({
    modelTools: { "timed-tool": { name: "timed_probe", args: {} } },
  });
  const host = new DesktopHost(f.agentDir);
  try {
    await writeFile(
      join(f.agentDir, "extensions", "pi-120.ts"),
      `
      import { Text } from '@earendil-works/pi-tui';
      export default function(pi) {
        pi.registerTool({ name:'timed_probe', label:'Timed probe', description:'Measure execution', parameters:{type:'object',properties:{}},
          execute: async () => { await new Promise(r=>setTimeout(r,60)); return {content:[{type:'text',text:'timed result'}]}; } });
        pi.registerToolRenderer((name,next) => name !== 'timed_probe' ? next() : {
          renderCall(_args,_theme,ctx) { ctx.state.callContext=ctx; return new Text('timed call',0,0); },
          renderResult(_result,_options,_theme,ctx) { ctx.state.resultContext=ctx; return new Text('timed result',0,0); }
        });
      }
    `,
    );
    await host.initialize(f.cwd);
    assert.equal(VERSION, "1.2.0");
    host.session.settingsManager.setOutputPad(0);
    await host.action({ action: "prompt", args: { message: "timed-tool" } });
    await until(() => !host.snapshot().running);
    const raw = host.session.messages.find(
      (message) =>
        message.role === "toolResult" && message.toolName === "timed_probe",
    );
    assert.ok(
      raw?.role === "toolResult" &&
        raw.durationMs !== undefined &&
        raw.durationMs >= 50,
    );
    const id = raw.toolCallId;
    await until(() =>
      host
        .snapshot()
        .desktopSurfaces.some((surface) => surface.target?.toolCallId === id),
    );
    const inspect = () => {
      const snapshot = host.snapshot();
      const message = snapshot.messages.find(
        (message) => message.toolCallId === id,
      )!;
      assert.equal(message.toolPresentation?.durationMs, raw.durationMs);
      const context = host.desktopUI.toolState(id).resultContext as {
        durationMs: number;
        outputPad: number;
      };
      assert.equal(context.durationMs, raw.durationMs);
      assert.equal(context.outputPad, 0);
      assert.ok(
        JSON.stringify(snapshot.desktopSurfaces).includes("timed call"),
        JSON.stringify(
          snapshot.desktopSurfaces.filter((surface) => surface.slot === "tool"),
        ),
      );
    };
    inspect();
    const file = host.session.sessionFile!;
    await host.action({ action: "session.new" });
    await host.action({ action: "session.switch", args: { path: file } });
    await until(() =>
      host
        .snapshot()
        .desktopSurfaces.some((surface) => surface.target?.toolCallId === id),
    );
    inspect();
  } finally {
    await host.dispose();
    await f.close();
  }
});

test("custom-message runs use the new before_agent_start union and cancellation reports idle", async () => {
  const f = await createFixture();
  const host = new DesktopHost(f.agentDir);
  try {
    await writeFile(
      join(f.agentDir, "extensions", "custom-run.ts"),
      `
      export default function(pi) {
        pi.on('before_agent_start',(event,ctx) => {
          ctx.ui.setStatus('start-kind', event.messageType + ':' + ctx.isIdle());
          if(event.messageType==='user') return;
          return {systemPrompt:ctx.getSystemPrompt()+'\\nCustom run setup.'};
        });
        pi.registerCommand('custom-run',{handler:() => pi.sendMessage({customType:'fixture-custom',content:'Custom run',display:true},{triggerTurn:true})});
      }
    `,
    );
    await host.initialize(f.cwd);
    await host.action({ action: "prompt", args: { message: "/custom-run" } });
    await until(
      () =>
        host.snapshot().statuses["start-kind"] === "custom:false" &&
        !host.snapshot().running,
    );
    assert.equal(host.snapshot().extensionUI.programStatus?.state, "done");
    const pending = host.action({
      action: "prompt",
      args: { message: "slow-response" },
    });
    await until(() => host.snapshot().running);
    await host.action({ action: "abort" });
    await pending;
    assert.equal(host.snapshot().extensionUI.programStatus?.state, "idle");
    const waiting = host.ask({ kind: "confirm", title: "Continue?" });
    assert.equal(host.snapshot().extensionUI.programStatus?.state, "blocked");
    assert.equal(host.snapshot().extensionUI.programStatus?.kind, "permission");
    host.answer(host.pendingDialogs[0].id, false);
    await waiting;
    assert.equal(host.snapshot().extensionUI.programStatus?.state, "idle");
  } finally {
    await host.dispose();
    await f.close();
  }
});

test("published keybinding schema metadata and invalid bindings stay out of desktop commands", async () => {
  const f = await createFixture();
  const host = new DesktopHost(f.agentDir);
  try {
    await writeFile(
      join(f.agentDir, "keybindings.json"),
      JSON.stringify({
        $schema: "https://pi.dev/schemas/keybindings.schema.json",
        "app.clear": "alt+c",
        "app.message.copy": "invalid+key",
      }),
    );
    await host.initialize(f.cwd);
    const keys = host.snapshot().extensionUI.editorCommandKeys!;
    assert.ok(keys.includes("alt+c"));
    assert.ok(!keys.includes("https://pi.dev/schemas/keybindings.schema.json"));
    assert.ok(!keys.includes("invalid+key"));
  } finally {
    await host.dispose();
    await f.close();
  }
});
