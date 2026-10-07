import test from "node:test";
import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import {
  DesktopUIRegistry,
  type DesktopRenderSource,
} from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import {
  callComponentMethod,
  loadComponentRuntime,
} from "../backend/component-runtime.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import { createFixture } from "./fixture.ts";

function text(node: DesktopNode): string {
  if (node.kind === "text") return node.text;
  return (
    "children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : []
  )
    .map(text)
    .filter(Boolean)
    .join("\n");
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Tool shell did not settle");
    await new Promise((done) => setTimeout(done, 10));
  }
}

test("tool failures use original fallbacks, reset lastComponent and recover with a bare receiver", async (t) => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text");
  const keys = (await loadComponentRuntime()).keys.KeybindingsManager.create(
    fixture.agentDir,
  );
  const tui = new api.TuiMainScreen(new api.ProcessTerminal());
  tui.requestRender = () => {};
  const output = Array.from(
    { length: 14 },
    (_, i) => `\u001b[31mline ${i + 1}\u001b[0m\r`,
  ).join("\n");
  try {
    await host.initialize(fixture.cwd);
    for (const kind of ["toolCall", "toolResult"] as const)
      for (const failure of ["throw", "invalid"])
        await t.test(`${kind}/${failure}`, async () => {
          let mode = "ok",
            last: unknown,
            receiver: unknown;
          const renderer = function (this: unknown, ...values: unknown[]) {
            receiver = this;
            const context = values.at(-1) as { lastComponent: unknown };
            last = context.lastComponent;
            if (mode === "throw") throw new Error("expected renderer failure");
            if (mode === "invalid") return undefined;
            return (
              context.lastComponent ?? new Text("Recovered component", 0, 0)
            );
          };
          const source: DesktopRenderSource = {
            kind,
            renderer,
            value:
              kind === "toolCall"
                ? { value: "one\ntwo", long: "x".repeat(180) }
                : { content: [{ type: "text", text: output }] },
            context: {
              expanded: false,
              isStreaming: false,
              isPartial: false,
              isError: true,
              argsComplete: true,
              executionStarted: true,
              toolName: "fallback_tool",
              toolCallId: "differential",
              cwd: fixture.cwd,
              args: { value: "one\ntwo", long: "x".repeat(180) },
              showImages: false,
            },
          };
          await registry.mount(source, "tool", "test");
          assert.equal(receiver, undefined);
          assert.equal(last, undefined);
          registry.reconcile([
            {
              id: "test",
              source: {
                ...source,
                context: { ...source.context, isPartial: true },
              },
              slot: "tool",
              target: { toolCallId: "differential" },
            },
          ]);
          await until(() => last !== undefined);
          mode = failure;
          registry.invalidate();
          const fallback = registry.surfaces.find(
            (surface) => surface.id === "test",
          )!;
          const previousKeys = api.getKeybindings();
          api.setKeybindings(keys);
          try {
            const reference = new ToolExecutionComponent(
              "fallback_tool",
              "reference",
              source.context.args,
              { showImages: false },
              {},
              tui as unknown as ConstructorParameters<
                typeof ToolExecutionComponent
              >[5],
              fixture.cwd,
            );
            Reflect.set(
              reference,
              "result",
              kind === "toolResult" ? source.value : undefined,
            );
            const original = callComponentMethod(
              reference,
              kind === "toolCall"
                ? "createCallFallback"
                : "createResultFallback",
            ) as { render(width: number): string[] };
            assert.equal(
              text(fallback.view),
              original
                .render(120)
                .map((line) => api.stripTerminalSequences(line).trimEnd())
                .join("\n"),
            );
          } finally {
            api.setKeybindings(previousKeys);
          }
          if (kind === "toolResult") {
            assert.ok(text(fallback.view).includes("4 more lines"));
            assert.ok(!text(fallback.view).includes("line 11"));
          }
          mode = "ok";
          registry.invalidate();
          assert.equal(
            text(
              registry.surfaces.find((surface) => surface.id === "test")!.view,
            ),
            "Recovered component",
          );
          assert.equal(last, undefined);
          assert.equal(receiver, undefined);
          registry.close("test");
        });
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await fixture.close();
  }
});

test("defined tools without callbacks use shared fallback policy with shell metadata and persisted originals", async () => {
  const fixture = await createFixture({ toolShell: true });
  const host = new DesktopHost(fixture.agentDir);
  const path = join(fixture.agentDir, "desktop", "tool-shell-control.mjs");
  await cp(new URL("./fixtures/tool-shell-control.mjs", import.meta.url), path);
  const run = (args: Record<string, unknown>) =>
    host.action({ action: "sdk.run", args: { path, args } });
  try {
    await host.initialize(fixture.cwd);
    await run({ mode: "seed" });
    await until(
      () =>
        host
          .snapshot()
          .desktopSurfaces.filter((surface) =>
            surface.target?.toolCallId?.startsWith("shell-"),
          ).length === 10,
    );
    let snapshot = host.snapshot();
    const missing = snapshot.desktopSurfaces.find(
      (surface) => surface.id === "render:result:shell-self_missing",
    )!;
    assert.ok(text(missing.view).includes("4 more lines"));
    assert.equal(
      snapshot.messages.find(
        (message) => message.toolCallId === "shell-self_missing",
      )?.toolRenderShell,
      "self",
    );
    const saved = snapshot.sessionFile!;
    const before = await readFile(saved, "utf8");
    assert.ok(!before.includes("toolRenderShell"));
    await run({ expanded: true });
    await until(() =>
      text(
        host
          .snapshot()
          .desktopSurfaces.find((surface) => surface.id === missing.id)!.view,
      ).includes("line 14"),
    );
    await host.action({
      action: "prompt",
      args: { message: "/shell-recover" },
    });
    await until(() =>
      JSON.stringify(host.snapshot().desktopSurfaces).includes(
        "Shell result self_failure",
      ),
    );
    const state = host.desktopUI.toolState("shell-self_failure");
    assert.equal(state.callReceiver, true);
    assert.equal(state.resultReceiver, true);
    assert.equal(state.callLast, false);
    assert.equal(state.resultLast, false);
    await run({ mode: "partial" });
    snapshot = host.snapshot();
    assert.equal(snapshot.activeTools[0].toolRenderShell, "self");
    await run({ mode: "clearPartial" });
    await host.action({ action: "resources.reload" });
    await until(() =>
      text(
        host
          .snapshot()
          .desktopSurfaces.find((surface) => surface.id === missing.id)!.view,
      ).includes("line 14"),
    );
    await host.action({ action: "session.new" });
    await host.action({ action: "session.switch", args: { path: saved } });
    await until(
      () =>
        !!host
          .snapshot()
          .desktopSurfaces.find((surface) => surface.id === missing.id),
    );
    assert.equal(
      host
        .snapshot()
        .messages.find((message) => message.toolCallId === "shell-self_missing")
        ?.content[0].text?.split("\n").length,
      14,
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
