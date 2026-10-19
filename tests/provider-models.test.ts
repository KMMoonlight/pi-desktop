import test from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverProviderModels } from "../backend/provider-models.ts";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DiscoveredProviderModel } from "../shared/types.ts";

async function endpoint(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("model discovery uses the API prefix and SDK credential interpolation, deduplicating valid IDs", async () => {
  const requests: { url?: string; auth?: string; tenant?: string }[] = [];
  const server = await endpoint((req, res) => {
    requests.push({
      url: req.url,
      auth: req.headers.authorization,
      tenant: String(req.headers["x-tenant"]),
    });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: [
          { id: "chat-a", name: "Chat A", owned_by: "ignored" },
          { id: " chat-b " },
          { id: "chat-a" },
          { id: "" },
          { id: 123 },
          null,
        ],
      }),
    );
  });
  const original = process.env.PI_DESKTOP_DISCOVERY_KEY;
  process.env.PI_DESKTOP_DISCOVERY_KEY = "discovery-secret";
  try {
    for (const apiKey of [
      "${PI_DESKTOP_DISCOVERY_KEY}",
      "!node -e \"process.stdout.write('discovery-secret')\"",
      "discovery-secret",
    ]) {
      assert.deepEqual(
        await discoverProviderModels(
          {
            baseUrl: `${server.url}/gateway/v1///?tenant=one`,
            apiKey,
            headers: { "X-Tenant": "prefix-$PI_DESKTOP_DISCOVERY_KEY" },
          },
          new AbortController().signal,
        ),
        [{ id: "chat-a", name: "Chat A" }, { id: "chat-b" }],
      );
    }
    assert.equal(requests.length, 3);
    for (const request of requests)
      assert.deepEqual(request, {
        url: "/gateway/v1/models?tenant=one",
        auth: "Bearer discovery-secret",
        tenant: "prefix-discovery-secret",
      });
    await discoverProviderModels(
      {
        baseUrl: `${server.url}/v1`,
        apiKey: "unused",
        headers: { authorization: "Bearer header-secret" },
      },
      new AbortController().signal,
    );
    assert.equal(requests.at(-1)?.auth, "Bearer header-secret");
    await discoverProviderModels(
      { baseUrl: `${server.url}/v1` },
      new AbortController().signal,
    );
    assert.equal(requests.at(-1)?.auth, undefined);
  } finally {
    if (original === undefined) delete process.env.PI_DESKTOP_DISCOVERY_KEY;
    else process.env.PI_DESKTOP_DISCOVERY_KEY = original;
    await server.close();
  }
});

test("discovery reports endpoint, HTTP, JSON and empty-list errors without echoing response secrets", async () => {
  let status = 200,
    body = "";
  const server = await endpoint((_req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  });
  const signal = new AbortController().signal;
  try {
    for (const baseUrl of ["", "bad-url", "file:///tmp/models"])
      await assert.rejects(
        discoverProviderModels({ baseUrl }, signal),
        /HTTP 或 HTTPS/,
      );
    const args = { baseUrl: `${server.url}/v1`, apiKey: "secret" };
    for (const code of [401, 404, 500]) {
      status = code;
      body = '{"error":"secret-token-echo"}';
      await assert.rejects(discoverProviderModels(args, signal), (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(`HTTP ${code}`));
        assert.ok(!error.message.includes("secret"));
        return true;
      });
    }
    status = 200;
    for (const invalid of [
      "<html>not JSON</html>",
      "null",
      "[]",
      '{"data":{}}',
    ]) {
      body = invalid;
      await assert.rejects(discoverProviderModels(args, signal), /data 数组/);
    }
    for (const empty of [
      '{"data":[]}',
      '{"data":[null,{"id":" "},{"name":"no id"}]}',
    ]) {
      body = empty;
      await assert.rejects(
        discoverProviderModels(args, signal),
        /未返回可用模型/,
      );
    }
    await assert.rejects(
      discoverProviderModels({ ...args, headers: { "X-Key": 123 } }, signal),
      /请求头/,
    );
  } finally {
    await server.close();
  }
});

test("discovery cancels an in-flight response when its owner is disposed", async () => {
  let ready!: () => void;
  const requested = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const server = await endpoint((_req, _res) => ready());
  const controller = new AbortController();
  try {
    const discovery = discoverProviderModels(
      { baseUrl: `${server.url}/v1` },
      controller.signal,
    );
    const rejected = assert.rejects(discovery, /Discovery cancelled/);
    await requested;
    controller.abort(new Error("Discovery cancelled"));
    await rejected;
  } finally {
    await server.close();
  }
});

test("discovery works before and after opening a workspace and leaves saved configuration untouched", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const server = await endpoint((_req, res) =>
    res.end('{"data":[{"id":"imported-chat"}]}'),
  );
  const path = join(fixture.agentDir, "models.json");
  const original = await readFile(path, "utf8");
  const request = {
    action: "models.discover",
    args: { baseUrl: `${server.url}/v1`, apiKey: "test-only" },
  };
  try {
    const models = (await host.action(request)) as DiscoveredProviderModel[];
    assert.deepEqual(models, [{ id: "imported-chat" }]);
    assert.equal(host.runtime, undefined);
    assert.equal(await readFile(path, "utf8"), original);
    await host.initialize(fixture.cwd);
    assert.deepEqual(await host.action(request), models);
    assert.equal(await readFile(path, "utf8"), original);
    const config = JSON.parse(original);
    config.providers.imported = {
      ...request.args,
      api: "openai-completions",
      models,
    };
    await host.action({
      action: "config.save",
      args: { name: "models.json", content: JSON.stringify(config) },
    });
    assert.ok(
      host
        .snapshot()
        .models.some(
          (model) =>
            model.provider === "imported" &&
            model.id === "imported-chat" &&
            model.available,
        ),
    );
  } finally {
    await host.dispose();
    await fixture.close();
    await server.close();
  }
});
