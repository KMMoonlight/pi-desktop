import test from "node:test";
import assert from "node:assert/strict";
import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { MODEL_THINKING_LEVELS } from "@earendil-works/pi-ai/providers/model-schema";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverProviderModels } from "../backend/provider-models.ts";
import { providerModelMetadata } from "../backend/provider-model-metadata.ts";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import {
  modelThinkingLevels,
  type DiscoveredProviderModel,
} from "../shared/types.ts";
import {
  mergeDiscoveredProviderModels,
  setProviderThinkingLevel,
  providerThinkingLevels,
} from "../shared/provider-models.ts";

test("browser thinking levels match the SDK catalog and supported-level rules", () => {
  assert.deepEqual([...modelThinkingLevels], [...MODEL_THINKING_LEVELS]);
  const model: Model<"openai-completions"> = {
    id: "chat",
    name: "Chat",
    api: "openai-completions",
    provider: "custom",
    baseUrl: "https://example.com/v1",
    reasoning: true,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  for (const thinkingLevelMap of [
    undefined,
    { xhigh: "max" },
    {
      off: null,
      minimal: null,
      low: "8192",
      medium: null,
      high: "high_effort",
      xhigh: "max",
      max: null,
    },
  ]) {
    for (const reasoning of [true, false]) {
      const current = { ...model, reasoning, thinkingLevelMap };
      assert.deepEqual(
        providerThinkingLevels({ ...current }),
        getSupportedThinkingLevels(current),
      );
    }
  }
});

test("model refresh keeps the first discovery for duplicate IDs", () => {
  assert.deepEqual(
    mergeDiscoveredProviderModels(
      [{ id: "existing" }],
      [
        { id: "existing", contextWindow: 128000 },
        { id: "existing", contextWindow: 32000 },
        { id: "new", name: "First" },
        { id: "new", name: "Duplicate" },
      ],
    ),
    [
      { id: "existing", contextWindow: 128000 },
      { id: "new", name: "First" },
    ],
  );
});

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

test("discovery imports native SDK and OpenRouter limits, reasoning, vision and tool metadata", async () => {
  const native = {
    id: "native-chat",
    name: "Native Chat",
    contextWindow: 262144,
    maxTokens: 32768,
    reasoning: true,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "max",
      max: null,
    },
    input: ["text", "image"],
    supportsTools: true,
    compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: false },
  };
  const server = await endpoint((_req, res) =>
    res.end(
      JSON.stringify({
        data: [
          native,
          {
            id: "router-chat",
            name: "Router Chat",
            context_length: 200000,
            top_provider: {
              context_length: 100000,
              max_completion_tokens: 8192,
            },
            architecture: { input_modalities: ["text", "image", "audio"] },
            supported_parameters: ["tools", "reasoning"],
            reasoning: { supported_efforts: ["none", "low", "high"] },
          },
          { id: "basic-chat" },
          {
            id: "limited-chat",
            context_window: "65536",
            max_output_tokens: "4096",
            reasoning: false,
            vision: false,
            tools: false,
            capabilities: { reasoning: true, vision: true, tools: true },
          },
        ],
      }),
    ),
  );
  try {
    assert.deepEqual(
      await discoverProviderModels(
        { baseUrl: server.url },
        new AbortController().signal,
      ),
      [
        native,
        {
          id: "router-chat",
          name: "Router Chat",
          contextWindow: 200000,
          maxTokens: 8192,
          input: ["text", "image"],
          reasoning: true,
          supportsTools: true,
          thinkingLevelMap: {
            off: "none",
            minimal: null,
            low: "low",
            medium: null,
            high: "high",
            xhigh: null,
            max: null,
          },
        },
        { id: "basic-chat" },
        {
          id: "limited-chat",
          contextWindow: 65536,
          maxTokens: 4096,
          reasoning: false,
          input: ["text"],
          supportsTools: false,
        },
      ],
    );
  } finally {
    await server.close();
  }
});

test("tool metadata requires positive evidence or an explicit boolean declaration", () => {
  for (const metadata of [
    { capabilities: [] },
    { supported_parameters: [] },
    { capabilities: [], supported_parameters: [] },
    { capabilities: ["reasoning"] },
    { supported_parameters: ["temperature"] },
  ])
    assert.equal(providerModelMetadata(metadata).supportsTools, undefined);
  assert.equal(
    providerModelMetadata({ capabilities: [], tools: false }).supportsTools,
    false,
  );
  assert.equal(
    providerModelMetadata({
      supportsTools: false,
      supported_parameters: ["tools"],
    }).supportsTools,
    false,
  );
  assert.equal(
    providerModelMetadata({ capabilities: [], supported_parameters: ["tools"] })
      .supportsTools,
    true,
  );
});

test("refresh merges partial thinking maps and keeps explicit overrides and disabled mappings", () => {
  assert.deepEqual(
    mergeDiscoveredProviderModels(
      [
        {
          id: "chat",
          name: "My name",
          reasoning: false,
          thinkingLevelMap: { low: "8192", high: null },
          disabledThinkingLevelMap: { high: "high_effort" },
          compat: { supportsStrictMode: false },
        },
        { id: "local-only", contextWindow: 65536 },
      ],
      [
        {
          id: "chat",
          name: "New name",
          reasoning: true,
          contextWindow: 128000,
          thinkingLevelMap: {
            low: "low",
            medium: "medium_effort",
            high: "high_effort",
            xhigh: "maximum",
          },
          compat: { supportsStrictMode: true, supportsToolSearch: true },
        },
        { id: "new-chat" },
      ],
    ),
    [
      {
        id: "chat",
        name: "My name",
        reasoning: false,
        contextWindow: 128000,
        thinkingLevelMap: {
          low: "8192",
          medium: "medium_effort",
          high: null,
          xhigh: "maximum",
        },
        disabledThinkingLevelMap: { high: "high_effort" },
        compat: { supportsStrictMode: false, supportsToolSearch: true },
      },
      { id: "local-only", contextWindow: 65536 },
      { id: "new-chat" },
    ],
  );
});

test("reasoning level toggles restore provider values after saving and reopening", () => {
  const original = {
    id: "chat",
    reasoning: true,
    thinkingLevelMap: { off: "disabled", low: "8192", high: "high_effort" },
  };
  let model = setProviderThinkingLevel(original, "high", false);
  model = setProviderThinkingLevel(model, "off", false);
  assert.deepEqual(model.disabledThinkingLevelMap, {
    high: "high_effort",
    off: "disabled",
  });
  model = JSON.parse(JSON.stringify(model));
  model = setProviderThinkingLevel(model, "high", true);
  model = setProviderThinkingLevel(model, "off", true);
  assert.deepEqual(model, original);
  assert.equal(original.thinkingLevelMap.high, "high_effort");
});

test("metadata ignores malformed values and request configuration, preserving explicit capability declarations", () => {
  assert.deepEqual(providerModelMetadata({ input: "text" }), {
    input: ["text"],
  });
  assert.deepEqual(providerModelMetadata({ input: "image" }), {
    input: ["image"],
  });
  assert.deepEqual(providerModelMetadata({ input: "audio" }), {});
  assert.equal(
    providerModelMetadata({
      capabilities: ["vision"],
      supported_parameters: ["tools"],
    }).supportsTools,
    true,
  );
  assert.deepEqual(
    providerModelMetadata({
      contextWindow: -1,
      context_length: 1.5,
      context_window: "128000",
      maxTokens: 0,
      max_output_tokens: "not-a-number",
      max_completion_tokens: 8192,
      reasoning: "true",
      supports_reasoning: false,
      supportsTools: "false",
      input: ["audio", "video"],
      architecture: { input_modalities: ["image", "image", "text"] },
      thinkingLevelMap: {
        low: 1,
        high: " high ",
        xhigh: null,
        unknown: "danger",
      },
      supported_parameters: ["temperature"],
      compat: {
        supportsStrictMode: true,
        supportsToolSearch: "true",
        chatTemplateKwargs: { untrusted: true },
        openRouterRouting: { only: ["untrusted"] },
      },
      api: "untrusted",
      baseUrl: "https://untrusted.example",
      apiKey: "untrusted",
      headers: { Authorization: "untrusted" },
    }),
    {
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: false,
      input: ["image", "text"],
      thinkingLevelMap: { high: "high", xhigh: null },
      compat: { supportsStrictMode: true },
    },
  );
  assert.deepEqual(
    providerModelMetadata({
      contextWindow: Number.MAX_SAFE_INTEGER + 1,
      maxTokens: Infinity,
      thinkingLevelMap: [],
      reasoning: {},
      input: [null],
      supported_parameters: [123],
      capabilities: "vision",
      compat: [true],
    }),
    {},
  );
  assert.deepEqual(
    providerModelMetadata({
      limit: { context: 32000, output: 4000 },
      capabilities: ["vision", "reasoning", "tools"],
      supported_thinking_levels: ["low", "xhigh"],
    }),
    {
      contextWindow: 32000,
      maxTokens: 4000,
      input: ["text", "image"],
      reasoning: true,
      supportsTools: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: null,
        high: null,
        xhigh: "xhigh",
        max: null,
      },
    },
  );
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
  const imported: DiscoveredProviderModel = {
    id: "imported-chat",
    contextWindow: 65536,
    maxTokens: 8192,
    reasoning: true,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: null,
    },
    input: ["text", "image"],
    supportsTools: true,
    compat: { supportsStrictMode: true },
  };
  const server = await endpoint((_req, res) =>
    res.end(JSON.stringify({ data: [imported] })),
  );
  const path = join(fixture.agentDir, "models.json");
  const original = await readFile(path, "utf8");
  const request = {
    action: "models.discover",
    args: { baseUrl: `${server.url}/v1`, apiKey: "test-only" },
  };
  try {
    const models = (await host.action(request)) as DiscoveredProviderModel[];
    assert.deepEqual(models, [imported]);
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
    const model = host
      .runtime!.services.modelRuntime.getModels("imported")
      .find((model) => model.id === "imported-chat")!;
    assert.equal(model.contextWindow, 65536);
    assert.equal(model.maxTokens, 8192);
    assert.equal(model.reasoning, true);
    assert.deepEqual(model.input, ["text", "image"]);
    assert.deepEqual(model.thinkingLevelMap, imported.thinkingLevelMap);
    assert.deepEqual(getSupportedThinkingLevels(model), ["off", "low", "high"]);
    assert.deepEqual(model.compat, imported.compat);
  } finally {
    await host.dispose();
    await fixture.close();
    await server.close();
  }
});
