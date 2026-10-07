import test from "node:test";
import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import {
  DesktopUIRegistry,
  type DesktopRenderSource,
} from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import {
  componentField,
  loadComponentRuntime,
} from "../backend/component-runtime.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

function nodes(node: DesktopNode): DesktopNode[] {
  return [
    node,
    ...("children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : []
    ).flatMap(nodes),
  ];
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Transcript renderer did not settle");
    await new Promise((done) => setTimeout(done, 10));
  }
}

test("message and entry callbacks retain native receivers, exact options, raw values and original failure/empty rules", async (t) => {
  const fixture = await createFixture(),
    host = new DesktopHost(fixture.agentDir);
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const runtime = await loadComponentRuntime(),
    api = await loadTuiApi(),
    Text = Reflect.get(api, "Text");
  try {
    await host.initialize(fixture.cwd);
    for (const kind of ["message", "entry"] as const)
      for (const output of ["custom", "empty", "error"])
        await t.test(`${kind}/${output}`, async () => {
          const observed: {
            receiver: object;
            value: unknown;
            options: object;
          }[] = [];
          const renderer = function (
            this: object,
            value: unknown,
            options: object,
          ) {
            observed.push({ receiver: this, value, options });
            assert.equal(componentField(this, kind), value);
            if (output === "empty") return undefined;
            if (output === "error") throw new Error("Native reference error");
            return new Text("Native renderer value", 0, 0);
          };
          const value =
            kind === "message"
              ? {
                  role: "custom",
                  customType: "reference-message",
                  content: "**Original fallback**",
                  display: true,
                  timestamp: Date.now(),
                }
              : {
                  type: "custom",
                  customType: "reference-entry",
                  id: "entry",
                  parentId: null,
                  timestamp: new Date().toISOString(),
                  data: { raw: true },
                };
          const source: DesktopRenderSource = {
            kind,
            renderer,
            value,
            context: {
              expanded: false,
              isStreaming: false,
              isPartial: false,
              isError: false,
              argsComplete: true,
              executionStarted: false,
              cwd: fixture.cwd,
              outputPad: 0,
              codeBlockIndent: "    ",
            },
          };
          await registry.mount(
            source,
            kind === "message" ? "message" : "entry",
            "reference",
          );
          const receiver = observed[0].receiver;
          const Constructor =
            kind === "message"
              ? runtime.transcript.CustomMessageComponent
              : runtime.transcript.CustomEntryComponent;
          assert.ok(receiver instanceof Constructor);
          assert.equal(observed[0].value, value);
          assert.deepEqual(
            Object.keys(observed[0].options).sort(),
            kind === "message" ? ["expanded", "outputPad"] : ["expanded"],
          );
          assert.deepEqual(
            observed[0].options,
            kind === "message"
              ? { expanded: false, outputPad: 0 }
              : { expanded: false },
          );
          let view = registry.surfaces[0].view;
          if (output === "custom")
            assert.ok(JSON.stringify(view).includes("Native renderer value"));
          else if (kind === "message") {
            assert.ok(JSON.stringify(view).includes("[reference-message]"));
            assert.ok(nodes(view).some((node) => node.kind === "markdown"));
            assert.ok(!JSON.stringify(view).includes("Native reference error"));
          } else if (output === "empty")
            assert.deepEqual(
              nodes(view).filter((node) => node.kind === "text"),
              [],
            );
          else
            assert.ok(
              JSON.stringify(view).includes(
                "[reference-entry] renderer failed: Native reference error",
              ),
            );
          registry.reconcile([
            {
              id: "reference",
              source: {
                ...source,
                context: { ...source.context, expanded: true, outputPad: 1 },
              },
              slot: kind === "message" ? "message" : "entry",
              target: { messageId: "reference" },
            },
          ]);
          await until(
            () =>
              (observed.at(-1)?.options as { expanded: boolean } | undefined)
                ?.expanded === true,
          );
          assert.equal(observed.at(-1)!.receiver, receiver);
          registry.invalidate();
          view = registry.surfaces[0].view;
          assert.equal(observed.at(-1)!.receiver, receiver);
          assert.deepEqual(
            observed.at(-1)!.options,
            kind === "message"
              ? { expanded: true, outputPad: 1 }
              : { expanded: true },
          );
          registry.close("reference");
        });
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await fixture.close();
  }
});

test("registered and default transcript renderers preserve visibility, persistence, settings, state and reload ownership", async () => {
  const fixture = await createFixture({ transcriptRenderers: true }),
    host = new DesktopHost(fixture.agentDir);
  const path = join(
    fixture.agentDir,
    "desktop",
    "transcript-renderer-control.mjs",
  );
  await cp(
    new URL("./fixtures/transcript-renderer-control.mjs", import.meta.url),
    path,
  );
  const run = (args: Record<string, unknown>) =>
    host.action({ action: "sdk.run", args: { path, args } });
  try {
    await host.initialize(fixture.cwd);
    await run({
      mode: "seed",
      outputPad: 0,
      image: (await readFile("src-tauri/icons/128x128.png")).toString("base64"),
    });
    await until(
      () =>
        host
          .snapshot()
          .desktopSurfaces.filter((surface) => surface.slot === "message")
          .length === 8,
    );
    let snapshot = host.snapshot();
    assert.ok(
      !snapshot.messages.some(
        (message) => message.customType === "hidden-message",
      ),
    );
    assert.ok(
      !snapshot.messages.some(
        (message) =>
          message.role === "customEntry" &&
          message.customType === "absent-entry",
      ),
    );
    assert.ok(
      JSON.stringify(snapshot.desktopSurfaces).includes("[absent-message]"),
    );
    assert.ok(
      JSON.stringify(snapshot.desktopSurfaces).includes(
        "[throwing-entry] renderer failed: Entry fixture failure",
      ),
    );
    for (const label of ["Collision first", "Collision second"])
      assert.ok(JSON.stringify(snapshot.desktopSurfaces).includes(label));
    const duplicate = snapshot.messages.filter(
      (message) => message.customType === "duplicate-message",
    );
    assert.equal(new Set(duplicate.map((message) => message.entryId)).size, 2);
    assert.equal(
      new Set(duplicate.map((message) => message.desktopSurfaceId)).size,
      2,
    );
    const saved = snapshot.sessionFile!,
      raw = structuredClone(host.session.messages),
      persisted = await readFile(saved, "utf8");
    await host.action({
      action: "prompt",
      args: { message: "/transcript-renderer-mode error" },
    });
    await run({ mode: "invalidate" });
    await until(() =>
      JSON.stringify(host.snapshot().desktopSurfaces).includes(
        "Reactive entry failure",
      ),
    );
    assert.ok(
      JSON.stringify(host.snapshot().desktopSurfaces).includes(
        "[receiver-message]",
      ),
    );
    assert.deepEqual(host.session.messages, raw);
    assert.equal(await readFile(saved, "utf8"), persisted);
    await host.action({
      action: "prompt",
      args: { message: "/transcript-renderer-mode custom" },
    });
    await run({ mode: "invalidate", expanded: true, outputPad: 1 });
    await until(() =>
      JSON.stringify(host.snapshot().desktopSurfaces).includes("pad=1"),
    );
    await host.action({
      action: "prompt",
      args: { message: "/transcript-renderer-observe" },
    });
    const state = JSON.parse(
      host.snapshot().statuses["transcript-renderer-observe"],
    );
    for (const [key, observation] of Object.entries(state.observations) as [
      string,
      {
        native: boolean;
        rawIdentity: boolean;
        options: { expanded: boolean };
        optionKeys: string[];
      },
    ][]) {
      assert.equal(observation.native, true);
      assert.equal(observation.rawIdentity, true);
      assert.equal(observation.options.expanded, true);
      assert.deepEqual(
        observation.optionKeys,
        key.endsWith("message") ? ["expanded", "outputPad"] : ["expanded"],
      );
    }
    assert.ok(
      state.components.some(
        (component: { disposed: number }) => component.disposed === 1,
      ),
    );
    const before = snapshot.desktopSurfaces.find(
      (surface) => surface.slot === "message",
    )!.instanceId;
    await host.action({ action: "resources.reload" });
    await until(() =>
      host
        .snapshot()
        .desktopSurfaces.some(
          (surface) =>
            surface.slot === "message" && surface.instanceId !== before,
        ),
    );
    await host.action({ action: "session.new" });
    await host.action({ action: "session.switch", args: { path: saved } });
    await until(() =>
      JSON.stringify(host.snapshot().desktopSurfaces).includes(
        "Message renderer",
      ),
    );
    assert.deepEqual(host.session.messages, raw);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
