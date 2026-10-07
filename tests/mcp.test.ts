import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { createMcpHttpFixture } from "./mcp-http-fixture.ts";
import { desktopMcpOptions } from "../backend/mcp-options.ts";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";

test(
  "independent desktop hosts retain MCP configuration, credentials, logs and project trust",
  { timeout: 40000 },
  async () => {
    const first = await createFixture({
      modelTools: {
        "invoke-scoped": { name: "mcp__scoped__echo", args: { text: "first" } },
      },
    });
    const second = await createFixture({
      modelTools: {
        "invoke-scoped": {
          name: "mcp__scoped__echo",
          args: { text: "second" },
        },
      },
    });
    const peerA = await createMcpHttpFixture({
      token: "fixture-a",
      logMessage: "scoped-log-a",
    });
    const peerB = await createMcpHttpFixture({
      token: "fixture-b",
      logMessage: "scoped-log-b",
    });
    const hosts = [
      new DesktopHost(first.agentDir),
      new DesktopHost(second.agentDir),
    ];
    const previous = process.env.PI_CODING_AGENT_DIR;
    const unrelated = join(first.root, "unrelated-agent");
    await mkdir(unrelated);
    process.env.PI_CODING_AGENT_DIR = unrelated;
    try {
      const optionsA = await desktopMcpOptions(first.agentDir, () => {});
      const optionsB = await desktopMcpOptions(second.agentDir, () => {});
      for (const [options, peer, token] of [
        [optionsA, peerA, "fixture-a"],
        [optionsB, peerB, "fixture-b"],
      ] as const) {
        await options.credentials!.forServer("scoped", peer.config.url).save({
          serverUrl: peer.config.url,
          tokens: { access_token: token, token_type: "Bearer" },
        });
      }
      const config = (peer: typeof peerA) => ({
        mcpServers: { scoped: { ...peer.config, headers: {} } },
      });
      await writeFile(
        join(first.agentDir, "mcp.json"),
        JSON.stringify(config(peerA)),
      );
      await writeFile(
        join(second.agentDir, "mcp.json"),
        JSON.stringify(config(peerA)),
      );
      await mkdir(join(second.cwd, ".pi"));
      await writeFile(
        join(second.cwd, ".pi", "mcp.json"),
        JSON.stringify(config(peerB)),
      );
      new ProjectTrustStore(second.agentDir).set(second.cwd, true);
      await Promise.all(
        hosts.map((host, index) =>
          host.initialize(index === 0 ? first.cwd : second.cwd),
        ),
      );
      assert.equal(process.env.PI_CODING_AGENT_DIR, unrelated);
      await Promise.all(
        hosts.map((host) => host.session.prompt("invoke-scoped")),
      );
      for (const [peer, expected] of [
        [peerA, "first"],
        [peerB, "second"],
      ] as const) {
        const calls = peer.requests.filter(
          (request) => request.method === "tools/call",
        );
        assert.equal(calls.length, 1);
        assert.equal(calls[0].params.arguments.text, expected);
      }
      const context = hosts[1].session.extensionRunner.createContext();
      const untrusted = optionsB.loadConfig!({
        ...context,
        isProjectTrusted: () => false,
      }).servers[0].config;
      const trusted = optionsB.loadConfig!(context).servers[0].config;
      assert.ok("url" in untrusted && "url" in trusted);
      assert.equal(untrusted.url, peerA.config.url);
      assert.equal(trusted.url, peerB.config.url);
      assert.match(
        await readFile(join(first.agentDir, "mcp.log"), "utf8"),
        /scoped-log-a/,
      );
      assert.doesNotMatch(
        await readFile(join(first.agentDir, "mcp.log"), "utf8"),
        /scoped-log-b/,
      );
      assert.match(
        await readFile(join(second.agentDir, "mcp.log"), "utf8"),
        /scoped-log-b/,
      );
      assert.equal(
        optionsA.credentials!.tokens("scoped", peerB.config.url),
        undefined,
      );
      assert.equal(
        optionsB.credentials!.tokens("scoped", peerA.config.url),
        undefined,
      );
      await hosts[0].action({
        action: "mcp.command",
        args: { name: "scoped", operation: "logout" },
      });
      const freshA = await desktopMcpOptions(first.agentDir, () => {});
      const freshB = await desktopMcpOptions(second.agentDir, () => {});
      assert.equal(
        freshA.credentials!.tokens("scoped", peerA.config.url),
        undefined,
      );
      assert.equal(
        freshB.credentials!.tokens("scoped", peerB.config.url)?.access_token,
        "fixture-b",
      );
      assert.deepEqual(await readdir(unrelated), []);
    } finally {
      await Promise.all(hosts.map((host) => host.dispose()));
      await Promise.all([
        peerA.close(),
        peerB.close(),
        first.close(),
        second.close(),
      ]);
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  },
);

test(
  "desktop SDK discovers and invokes Streamable HTTP MCP tools and resources",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture({
      modelTools: {
        "mcp-echo": {
          name: "mcp__local_http__echo",
          args: { text: "桌面 MCP" },
        },
        "mcp-resources": {
          name: "list_mcp_resources",
          args: { server: "local_http" },
        },
        "mcp-templates": {
          name: "list_mcp_resource_templates",
          args: { server: "local_http" },
        },
        "mcp-read": {
          name: "read_mcp_resource",
          args: { server: "local_http", uri: "fixture://note" },
        },
      },
    });
    const peer = await createMcpHttpFixture();
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const unrelatedAgentDir = join(fixture.root, "unrelated-agent");
    await mkdir(unrelatedAgentDir);
    process.env.PI_CODING_AGENT_DIR = unrelatedAgentDir;
    const host = new DesktopHost(fixture.agentDir);
    const events: unknown[] = [];
    host.on("event", (event) => events.push(event));
    try {
      await writeFile(
        join(fixture.agentDir, "mcp.json"),
        JSON.stringify({ mcpServers: { local_http: peer.config } }),
      );
      await host.initialize(fixture.cwd);
      const deadline = Date.now() + 10000;
      while (
        !host.session.getActiveToolNames().includes("mcp__local_http__echo")
      ) {
        if (Date.now() > deadline)
          throw new Error("MCP tool was not discovered");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      for (const [prompt, expected] of [
        ["mcp-echo", "MCP:桌面 MCP"],
        ["mcp-resources", "fixture://note"],
        ["mcp-templates", "fixture://note/{id}"],
        ["mcp-read", "Remote MCP resource content"],
      ]) {
        await host.session.prompt(prompt);
        const result = host.session.messages
          .filter((message) => message.role === "toolResult")
          .at(-1);
        assert.ok(result && result.role === "toolResult");
        assert.equal(result.isError, false);
        assert.ok(
          JSON.stringify(result.content).includes(expected),
          JSON.stringify(result),
        );
      }
      assert.ok(
        peer.requests.some(
          (request) =>
            request.method === "tools/call" &&
            request.params.arguments.text === "桌面 MCP",
        ),
      );
      // Renderer failures are reported asynchronously and must not hide behind tool success.
      await new Promise((resolve) => setTimeout(resolve, 100));
      host.snapshot();
      assert.doesNotMatch(
        JSON.stringify(events),
        /Unsupported Pi TUI|requires a compatibility update/,
      );
      const manager = host.session.prompt("/mcp");
      const managerDeadline = Date.now() + 5000;
      while (
        !host.desktopUI.surfaces.some((surface) => surface.slot === "dialog")
      ) {
        if (Date.now() > managerDeadline)
          throw new Error("MCP manager did not open");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const surface = host.desktopUI.surfaces.find(
        (surface) => surface.slot === "dialog",
      )!;
      assert.match(JSON.stringify(surface.view), /local_http/);
      await host.desktopUI.input(surface.id, "\u001b");
      await manager;
      assert.equal(
        host.desktopUI.surfaces.some((surface) => surface.slot === "dialog"),
        false,
      );
      const initializations = () =>
        peer.requests.filter((request) => request.method === "initialize")
          .length;
      const beforeReconnect = initializations();
      await host.action({
        action: "mcp.command",
        args: { name: "local_http", operation: "reconnect" },
      });
      assert.ok(initializations() > beforeReconnect);
      await host.session.prompt("mcp-echo");
      const beforeReload = initializations();
      await host.session.reload();
      const reloadDeadline = Date.now() + 10000;
      while (
        !host.session.getActiveToolNames().includes("mcp__local_http__echo")
      ) {
        if (Date.now() > reloadDeadline)
          throw new Error("MCP tool was not rediscovered after reload");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(initializations() > beforeReload);
      await host.session.prompt("mcp-echo");
      assert.equal(
        peer.requests.filter((request) => request.method === "tools/call")
          .length,
        3,
      );
      const managerPending = host.action({ action: "mcp.status" }).then(
        () => null,
        (error) => error,
      );
      const closeDeadline = Date.now() + 5000;
      while (
        !host.desktopUI.surfaces.some((surface) => surface.slot === "dialog")
      ) {
        if (Date.now() > closeDeadline)
          throw new Error("MCP manager did not reopen");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await host.dispose();
      const interrupted = await managerPending;
      assert.ok(interrupted instanceof Error);
      assert.equal(interrupted.name, "AbortError");
    } finally {
      await host.dispose();
      await peer.close();
      await fixture.close();
      if (previousAgentDir === undefined)
        delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  },
);
