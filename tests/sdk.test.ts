import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as official from "@earendil-works/pi-coding-agent";
import * as access from "../backend/sdk-access.ts";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopEvent } from "../shared/types.ts";
import type {
  DesktopComponent,
  DesktopAdapterContext,
} from "../backend/desktop-ui.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("SDK operation did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test(
  "replaced desktop components cannot close or overwrite their successors",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      let pendingContext: DesktopAdapterContext | undefined;
      let finish: ((component: DesktopComponent) => void) | undefined;
      let disposed = false;
      host.desktopUI.registerAdapter({
        id: "replacement-race",
        matches: (source) => source === "pending" || source === "current",
        create: (context) => {
          if (context.source === "pending") {
            pendingContext = context;
            return new Promise<DesktopComponent>((resolve) => {
              finish = resolve;
            });
          }
          return {
            view: () => ({ kind: "text", text: "Current component" }),
            handleAction: () => {},
          };
        },
      });
      const previous = host.desktopUI.mount("pending", "header", "header");
      await host.desktopUI.mount("current", "header", "header");
      assert.equal(pendingContext!.signal.aborted, true);
      pendingContext!.done("stale completion");
      assert.ok(
        host.desktopUI.surfaces.some((surface) => surface.id === "header"),
      );
      finish!({
        view: () => ({ kind: "text", text: "Old component" }),
        handleAction: () => {},
        dispose: () => {
          disposed = true;
        },
      });
      await previous;
      assert.ok(disposed);
      assert.deepEqual(
        host.desktopUI.surfaces.find((surface) => surface.id === "header")
          ?.view,
        {
          kind: "text",
          text: "Current component",
        },
      );
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "native input hooks, shortcut contexts and session teardown",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      await host.action({
        action: "prompt",
        args: { message: "/desktop-input" },
      });
      assert.equal(host.snapshot().extensionUI.inputListeners, 1);
      const input = (key: string, modifiers = {}) =>
        host.action({
          action: "desktop.input",
          args: { event: { key, ...modifiers } },
        });
      assert.deepEqual(await input("x"), { consume: true });
      assert.deepEqual(await input("y"), {
        consume: false,
        data: "Z",
        keyId: "Z",
        changed: true,
      });
      const ui = host.session.extensionRunner.getUIContext();
      let last = "";
      const remove = ui.onTerminalInput((data) => {
        last = data;
        return undefined;
      });
      await input("ArrowLeft", { ctrlKey: true });
      assert.equal(last, "\x1b[1;5D");
      await input("Tab", { shiftKey: true });
      assert.equal(last, "\x1b[9;2u");
      remove();
      assert.deepEqual(await input("u", { ctrlKey: true, altKey: true }), {
        consume: true,
      });
      await until(() => ui.getEditorText() === "Shortcut handled");
      await host.action({ action: "session.new" });
      assert.equal(host.snapshot().extensionUI.inputListeners, 0);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "native transcript adapters receive tool results, custom messages, entries and expansion",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      let updates = 0,
        disposals = 0;
      host.desktopUI.registerAdapter({
        id: "native-tool-test",
        matches: (source, slot) => slot === "tool",
        create: ({ source }) => {
          let current =
            source as import("../backend/desktop-ui.ts").DesktopRenderSource;
          return {
            view: () => ({
              kind: "text",
              text: `${current.kind}:${current.context.expanded}`,
            }),
            handleAction() {},
            update(next) {
              current = next;
              updates++;
            },
            dispose() {
              disposals++;
            },
          };
        },
      });
      await host.action({ action: "prompt", args: { message: "run-tool" } });
      await until(
        () =>
          !host.snapshot().busy &&
          host
            .snapshot()
            .desktopSurfaces.some(
              (surface) => surface.target?.phase === "result",
            ),
      );
      const snapshot = host.snapshot();
      const result = snapshot.messages.find(
        (message) => message.role === "toolResult",
      )!;
      assert.ok(result.desktopSurfaceId);
      assert.ok(
        snapshot.messages.some((message) =>
          message.content.some((block) => block.desktopSurfaceId),
        ),
      );
      await host.action({ action: "display.tools", args: { expanded: true } });
      await until(() =>
        host
          .snapshot()
          .desktopSurfaces.some(
            (surface) =>
              surface.view.kind === "text" &&
              surface.view.text === "toolResult:true",
          ),
      );
      assert.ok(updates > 0);
      await host.action({
        action: "prompt",
        args: { message: "/desktop-renderers" },
      });
      await until(() =>
        host
          .snapshot()
          .desktopSurfaces.some((surface) => surface.slot === "entry"),
      );
      assert.ok(
        host
          .snapshot()
          .messages.some((message) => message.role === "customEntry"),
      );
      assert.ok(
        host
          .snapshot()
          .messages.find((message) => message.customType === "native-message")
          ?.desktopSurfaceId,
      );
      await host.action({ action: "session.new" });
      assert.ok(
        host
          .snapshot()
          .desktopSurfaces.every((surface) => surface.slot === "editor"),
      );
      assert.ok(disposals > 0);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "native overlays retain dynamic bounds, visibility, focus and editor text",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      let disposed = 0;
      host.desktopUI.registerAdapter({
        id: "native-overlay-editor",
        matches: (source) =>
          typeof source === "function" &&
          (source.name === "overlay" || source.name === "editor"),
        create: () => {
          let value = "";
          return {
            title: "Native overlay",
            view: () => ({
              kind: "textarea",
              action: "text",
              value,
              label: "Native editor",
            }),
            handleAction: (event) => {
              value = String(event.value);
            },
            getText: () => value,
            setText: (text) => {
              value = text;
            },
            dispose: () => {
              disposed++;
            },
          };
        },
      });
      const ui = host.session.extensionRunner.getUIContext();
      type Options = NonNullable<Parameters<typeof ui.custom>[1]>;
      let handle: Parameters<NonNullable<Options["onHandle"]>>[0] | undefined;
      let width = "50%" as `${number}%`;
      const pending = ui.custom(
        function overlay() {
          return {} as never;
        },
        {
          overlay: true,
          overlayOptions: () => ({
            width,
            maxHeight: "50%",
            visible: (columns) => columns > 30,
          }),
          onHandle: (next) => {
            handle = next;
          },
        },
      );
      await until(() => !!handle);
      await host.action({
        action: "desktop.viewport",
        args: { width: 100, height: 40 },
      });
      assert.equal(handle!.getBounds()!.width, 50);
      assert.equal(handle!.isFocused(), true);
      handle!.setHidden(true);
      assert.equal(handle!.isHidden(), true);
      handle!.setHidden(false);
      width = "75%";
      assert.equal(handle!.getBounds()!.width, 75);
      await host.action({
        action: "desktop.viewport",
        args: { width: 20, height: 40 },
      });
      assert.equal(handle!.getBounds(), undefined);
      handle!.hide();
      assert.equal(
        host.desktopUI.surfaces.some((surface) => surface.slot === "dialog"),
        false,
      );
      host.desktopUI.clearSurfaces();
      assert.equal(await pending, undefined);
      ui.setEditorText("Preserved text");
      ui.setEditorComponent(function editor() {
        return {} as never;
      });
      await until(() => host.desktopUI.getEditorText() === "Preserved text");
      await host.action({
        action: "desktop.action",
        args: { id: "editor", action: "text", value: "Edited text" },
      });
      ui.setEditorComponent(undefined);
      assert.equal(ui.getEditorText(), "Edited text");
      assert.ok(disposed >= 2);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "runtime factories support custom loaders and tool definitions across session replacement",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    let calls = 0;
    const host = new DesktopHost(fixture.agentDir, {
      runtimeFactory: async (options, createDefault, sdk) => {
        calls++;
        const initial = await createDefault(options);
        initial.session.dispose();
        const resourceLoader = new sdk.DefaultResourceLoader({
          cwd: options.cwd,
          agentDir: options.agentDir,
          settingsManager: initial.services.settingsManager,
          noThemes: true,
          systemPrompt: "Custom desktop SDK prompt",
        });
        await resourceLoader.reload();
        const services = { ...initial.services, resourceLoader };
        const definition = sdk.createReadToolDefinition(options.cwd);
        const session = await sdk.createAgentSessionFromServices({
          services,
          sessionManager: options.sessionManager,
          sessionStartEvent: options.sessionStartEvent,
          customTools: [sdk.defineTool({ ...definition, name: "custom-read" })],
        });
        return { ...session, services, diagnostics: services.diagnostics };
      },
    });
    try {
      await host.initialize(fixture.cwd);
      assert.ok(
        host.session.systemPrompt.includes("Custom desktop SDK prompt"),
      );
      assert.ok(
        host.session.getAllTools().some((tool) => tool.name === "custom-read"),
      );
      assert.equal(host.sdk.resourceLoader.getThemes().themes.length, 0);
      const ui = host.session.extensionRunner.getUIContext();
      assert.equal(ui.theme.name, "system");
      assert.deepEqual(
        ui.getAllThemes().map(({ name }) => name),
        ["system", "dark", "light"],
      );
      for (const name of ["system", "dark", "light"])
        assert.equal(ui.getTheme(name)?.name, name);
      await host.action({ action: "session.new" });
      assert.equal(calls, 2);
      assert.ok(
        host.session.systemPrompt.includes("Custom desktop SDK prompt"),
      );
      assert.ok(host.session.getCallableToolNames().includes("custom-read"));
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "native SDK access retains every exported value, callbacks and live session references",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      for (const name of Object.keys(official) as (keyof typeof official)[])
        assert.equal(access[name], official[name], name);
      const context = host.sdk;
      assert.equal(context.session, host.session);
      assert.equal(context.agent, host.session.agent);
      const bus = context.sdk.createEventBus();
      let delivered: unknown;
      const off = bus.on("native", (value) => {
        delivered = value;
      });
      bus.emit("native", { callback: true });
      assert.deepEqual(delivered, { callback: true });
      off();
      await host.withSdk(async ({ runtime }) => {
        await runtime.newSession({
          setup: async (manager) => {
            manager.appendCustomEntry("desktop-setup", {
              callback: "preserved",
            });
          },
        });
      });
      assert.equal(context.session, host.session);
      assert.ok(
        context.sessionManager
          .getEntries()
          .some(
            (entry) =>
              entry.type === "custom" && entry.customType === "desktop-setup",
          ),
      );
      const events: DesktopEvent[] = [];
      host.on("event", (event) => events.push(event));
      const file = join(fixture.agentDir, "desktop", "inspect.mjs");
      await writeFile(
        file,
        `export default async ({ session, sdk, emit }) => {
      emit("module", { native: true });
      return { version: sdk.VERSION, prompt: session.systemPrompt, tools: session.getCallableToolNames() };
    }`,
      );
      const result = (await host.action({
        action: "sdk.run",
        args: { path: file, id: "native" },
      })) as { version: string; prompt: string; tools: string[] };
      assert.equal(result.version, official.VERSION);
      assert.ok(result.prompt.length);
      assert.ok(result.tools.includes("read"));
      assert.ok(
        events.some(
          (event) => event.type === "activity" && event.name === "sdk:module",
        ),
      );
      await assert.rejects(
        host.action({
          action: "sdk.run",
          args: { path: join(fixture.cwd, "test-note.txt") },
        }),
        /trusted/,
      );
      const projectModules = join(fixture.cwd, ".pi", "desktop");
      await mkdir(projectModules, { recursive: true });
      await writeFile(
        join(projectModules, "module.mjs"),
        "export default () => 42;",
      );
      host.session.settingsManager.setProjectTrusted(false);
      await assert.rejects(
        host.action({
          action: "sdk.run",
          args: { path: join(projectModules, "module.mjs") },
        }),
        /trusted/,
      );
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "advanced session operations persist custom content, context edits and virtual routing",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      await host.action({
        action: "message.custom",
        args: {
          customType: "hidden",
          content: "private context",
          display: false,
        },
      });
      assert.ok(
        host.session.messages.some(
          (message) =>
            "customType" in message && message.customType === "hidden",
        ),
      );
      assert.ok(
        !host
          .snapshot()
          .messages.some((message) => message.customType === "hidden"),
      );
      await host.action({
        action: "message.custom",
        args: {
          customType: "visible",
          content: "visible context",
          details: { preserved: true },
        },
      });
      assert.ok(
        host
          .snapshot()
          .messages.some((message) => message.customType === "visible"),
      );
      await host.action({
        action: "message.user",
        args: { content: "Original question" },
      });
      const user = host.session.sessionManager
        .getEntries()
        .find(
          (entry) => entry.type === "message" && entry.message.role === "user",
        )!;
      await host.action({
        action: "context.edit",
        args: {
          id: user.id,
          replacement: {
            content: [{ type: "text", text: "Revised question" }],
          },
        },
      });
      assert.ok(
        JSON.stringify(host.session.messages).includes("Revised question"),
      );
      await host.action({ action: "cache.mode", args: { mode: "idle" } });
      assert.equal(host.session.settingsManager.getCacheWarmingMode(), "idle");
      await assert.rejects(
        host.action({ action: "cache.mode", args: { mode: "invalid" } }),
        /Invalid/,
      );
      const physical = host.session.modelRuntime.getModel(
        "desktop-test",
        "desktop-test",
      )!;
      const routes: string[] = [];
      host.sdk.modelRuntime.registerVirtualModel({
        provider: "desktop-test",
        id: "router",
        name: "Desktop router",
        contextWindow: 128000,
        route: (request) => {
          routes.push(request.reason);
          return {
            model: physical,
            thinkingLevel: "off",
            state: { routed: true },
          };
        },
      });
      await host.action({
        action: "model.set",
        args: { provider: "desktop-test", id: "router" },
      });
      await host.action({
        action: "message.user",
        args: { content: "Routed request" },
      });
      assert.ok(routes.includes("user"));
      assert.equal(host.snapshot().routedModel?.id, "desktop-test");
      const inspection = (await host.action({ action: "sdk.inspect" })) as {
        systemPrompt: string;
        callableTools: string[];
        entries: unknown[];
      };
      assert.ok(inspection.systemPrompt.length);
      assert.ok(inspection.callableTools.includes("read"));
      assert.ok(inspection.entries.length);
      const report = await host.action({
        action: "session.bugReport",
        args: { id: "report" },
      });
      assert.equal(typeof report, "string");
      const ui = host.session.extensionRunner.getUIContext();
      ui.setWorkingVisible(false);
      ui.setWorkingIndicator({ frames: ["A", "B"], intervalMs: 80 });
      ui.setHiddenThinkingLabel("Reasoning hidden");
      ui.setWidget("below", ["Below composer"], { placement: "belowEditor" });
      assert.equal(host.snapshot().extensionUI.workingVisible, false);
      assert.equal(
        host.snapshot().extensionUI.hiddenThinkingLabel,
        "Reasoning hidden",
      );
      assert.equal(host.snapshot().widgetPlacements.below, "belowEditor");
      assert.ok(ui.getAllThemes().some((theme) => theme.name === "dark"));
      assert.equal(ui.setTheme("dark").success, true);
      assert.equal(ui.theme.name, "dark");
      assert.equal(ui.setTheme("missing-theme").success, false);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "native extension form actions, cancellation and disposal preserve SDK callbacks",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      await host.action({
        action: "prompt",
        args: { message: "/desktop-native-form" },
      });
      await until(() =>
        host
          .snapshot()
          .desktopSurfaces.some((surface) => surface.slot === "dialog"),
      );
      const form = host
        .snapshot()
        .desktopSurfaces.find((surface) => surface.slot === "dialog")!;
      assert.equal(form.slot, "dialog");
      await assert.rejects(
        host.action({
          action: "desktop.action",
          args: { id: form.id, action: "disabled" },
        }),
        /unavailable/,
      );
      await host.action({
        action: "desktop.action",
        args: { id: form.id, action: "title", value: "Native task" },
      });
      await host.action({
        action: "desktop.action",
        args: { id: form.id, action: "priority", value: "high" },
      });
      await host.action({
        action: "desktop.action",
        args: { id: form.id, action: "submit" },
      });
      await until(() => !host.snapshot().busy);
      assert.equal(host.snapshot().statuses["native-form"], "Native task:high");
      assert.ok(
        host
          .snapshot()
          .desktopSurfaces.every((surface) => surface.slot === "editor"),
      );
      await host.action({
        action: "prompt",
        args: { message: "/desktop-native-form" },
      });
      await until(() =>
        host
          .snapshot()
          .desktopSurfaces.some((surface) => surface.slot === "dialog"),
      );
      await host.action({ action: "abort" });
      await until(() => !host.snapshot().busy);
      assert.equal(host.snapshot().statuses["native-form"], "cancelled");
      const pending = host.desktopUI.custom(function unknownFactory() {});
      await assert.rejects(pending, /桌面组件映射/);
      let disposed = false;
      host.desktopUI.registerAdapter({
        id: "lifecycle",
        matches: (source) => source === "lifecycle",
        create: () => ({
          view: () => ({ kind: "text", text: "Native header" }),
          handleAction: () => {},
          dispose: () => {
            disposed = true;
          },
        }),
      });
      await host.desktopUI.mount("lifecycle", "header", "header");
      await host.action({ action: "session.new" });
      assert.ok(disposed);
      assert.ok(
        host
          .snapshot()
          .desktopSurfaces.every((surface) => surface.slot === "editor"),
      );
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "model streaming and SDK module cancellation work through private actions",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      const events: DesktopEvent[] = [];
      host.on("event", (event) => events.push(event));
      const output = (await host.action({
        action: "models.request",
        args: {
          id: "stream",
          operation: "streamSimple",
          model: { provider: "desktop-test", id: "desktop-test" },
          context: {
            messages: [
              {
                role: "user",
                content: "Direct request",
                timestamp: Date.now(),
              },
            ],
          },
        },
      })) as { stopReason: string; content: unknown[] };
      assert.equal(output.stopReason, "stop");
      assert.ok(
        JSON.stringify(output.content).includes("SDK desktop verified."),
      );
      assert.ok(
        events.some(
          (event) =>
            event.type === "activity" && event.name === "sdk:model:stream",
        ),
      );
      assert.equal(
        host.session.messages.filter((message) => message.role === "user")
          .length,
        0,
      );
      const file = join(fixture.agentDir, "desktop", "cancellable.mjs");
      await writeFile(
        file,
        `export default ({ signal, emit }) => new Promise((resolve) => {
      emit("waiting"); signal.addEventListener("abort", () => resolve("cancelled"), { once: true });
    });`,
      );
      const operation = host.action({
        action: "sdk.run",
        args: { path: file, id: "cancel-me" },
      });
      await until(() =>
        events.some(
          (event) => event.type === "activity" && event.name === "sdk:waiting",
        ),
      );
      await host.action({ action: "sdk.cancel", args: { id: "cancel-me" } });
      assert.equal(await operation, "cancelled");
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "image, classifier and deferred model operations use the SDK provider runtime",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      const runtime = host.sdk.modelRuntime;
      type Provider = Parameters<typeof runtime.registerNativeProvider>[0];
      const original = runtime.getModel("desktop-test", "desktop-test")!;
      const base = runtime.getProvider("desktop-test")!;
      const chat = { ...original, provider: "desktop-modalities" };
      const image: Parameters<NonNullable<Provider["generateImages"]>>[0] = {
        ...chat,
        type: "image",
        id: "image",
        api: "fixture-images",
        output: ["image"],
      };
      const classifier: Parameters<NonNullable<Provider["classify"]>>[0] = {
        ...chat,
        type: "classifier",
        id: "classifier",
        api: "fixture-classifier",
      };
      let imageInput: unknown,
        classifierInput: unknown,
        cancelledHandle: unknown;
      runtime.registerNativeProvider({
        ...base,
        id: "desktop-modalities",
        name: "Desktop modalities",
        auth: {
          apiKey: {
            name: "Fixture",
            resolve: async () => ({
              auth: { apiKey: "test-only" },
              source: "fixture",
            }),
          },
        },
        getModels: () => [chat],
        getAllModels: () => [chat, image, classifier],
        generateImages: async (model, context, options) => {
          imageInput = context;
          assert.ok(options?.signal);
          return {
            api: model.api,
            provider: model.provider,
            model: model.id,
            output: [
              { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
            ],
            stopReason: "stop",
            timestamp: Date.now(),
          };
        },
        classify: async (model, context, options) => {
          classifierInput = context;
          assert.ok(options?.signal);
          return {
            api: model.api,
            provider: model.provider,
            model: model.id,
            answers: { valid: { type: "bool", probability: 0.95 } },
            stopReason: "stop",
            timestamp: Date.now(),
          };
        },
        fetchDeferred: () =>
          runtime.streamSimple(original, {
            messages: [
              {
                role: "user",
                content: "Deferred result",
                timestamp: Date.now(),
              },
            ],
          }),
        cancelDeferred: async (_, handle) => {
          cancelledHandle = handle;
        },
      });
      const images = (await host.action({
        action: "models.request",
        args: {
          id: "images",
          operation: "generateImages",
          model: { provider: "desktop-modalities", id: "image" },
          context: { input: [{ type: "text", text: "Product image" }] },
        },
      })) as { stopReason: string; output: unknown[] };
      assert.equal(images.stopReason, "stop");
      assert.equal(images.output.length, 1);
      assert.deepEqual(imageInput, {
        input: [{ type: "text", text: "Product image" }],
      });
      const context = {
        state: { task: "Review" },
        questions: {
          valid: {
            type: "bool",
            instructions: "Is valid?",
            criteria: { true: "Valid", false: "Invalid" },
          },
        },
      };
      const classification = (await host.action({
        action: "models.request",
        args: {
          id: "classify",
          operation: "classify",
          model: { provider: "desktop-modalities", id: "classifier" },
          context,
        },
      })) as { stopReason: string; answers: unknown };
      assert.equal(classification.stopReason, "stop");
      assert.deepEqual(classifierInput, context);
      const handle = {
        provider: "desktop-modalities",
        modelId: "desktop-test",
        api: chat.api,
        id: "deferred-id",
      };
      const deferred = (await host.action({
        action: "models.request",
        args: {
          id: "deferred",
          operation: "fetchDeferred",
          model: { provider: "desktop-modalities", id: "desktop-test" },
          handle,
        },
      })) as { stopReason: string };
      assert.equal(deferred.stopReason, "stop");
      await host.action({
        action: "models.request",
        args: {
          id: "cancel-deferred",
          operation: "cancelDeferred",
          model: { provider: "desktop-modalities", id: "desktop-test" },
          handle,
        },
      });
      assert.deepEqual(cancelledHandle, handle);
      const catalog = (await host.action({
        action: "models.catalog",
        args: { provider: "desktop-modalities" },
      })) as { id: string }[];
      assert.deepEqual(catalog.map((model) => model.id).sort(), [
        "classifier",
        "desktop-test",
        "image",
      ]);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "desktop abort cancels manual shell backends and preserves their results",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      let aborted = false;
      const running = host.sdk.session.executeBash(
        "remote-command",
        undefined,
        {
          operations: {
            exec: async (_, cwd, options) => {
              assert.equal(cwd, fixture.cwd);
              options.onData(Buffer.from("Remote output\n"));
              return new Promise((_, reject) =>
                options.signal!.addEventListener(
                  "abort",
                  () => {
                    aborted = true;
                    reject(new Error("aborted"));
                  },
                  { once: true },
                ),
              );
            },
          },
        },
      );
      await until(() => host.session.isBashRunning);
      assert.equal(host.snapshot().busy, true);
      await assert.rejects(host.action({ action: "session.new" }), /停止/);
      await host.action({ action: "abort" });
      const result = await running;
      assert.ok(aborted);
      assert.equal(result.cancelled, true);
      assert.equal(host.snapshot().bashRunning, false);
      await host.action({
        action: "bash.record",
        args: {
          command: "external-command",
          result: {
            output: "External output",
            exitCode: 0,
            cancelled: false,
            truncated: false,
          },
        },
      });
      assert.ok(
        host
          .snapshot()
          .messages.some((message) =>
            JSON.stringify(message.content).includes("External output"),
          ),
      );
      const ui = host.session.extensionRunner.getUIContext();
      ui.addAutocompleteProvider((previous) => ({
        ...previous,
        getSuggestions: async () => ({
          prefix: "native",
          items: [{ value: "native-completion", label: "Native completion" }],
        }),
        applyCompletion: () => ({
          lines: ["native-completion"],
          cursorLine: 0,
          cursorCol: 17,
        }),
      }));
      const suggestions = (await host.action({
        action: "autocomplete.suggest",
        args: { id: "complete", lines: ["native"], line: 0, column: 6 },
      })) as { items: { value: string }[] };
      assert.equal(suggestions.items[0].value, "native-completion");
      const completion = await host.action({
        action: "autocomplete.apply",
        args: {
          lines: ["native"],
          line: 0,
          column: 6,
          item: suggestions.items[0],
          prefix: "native",
        },
      });
      assert.deepEqual(completion, {
        lines: ["native-completion"],
        cursorLine: 0,
        cursorCol: 17,
      });
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);
