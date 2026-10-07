import test from "node:test";
import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import {
  componentField,
  callComponentMethod,
  loadComponentRuntime,
} from "../backend/component-runtime.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopNode, DesktopSurface } from "../shared/desktop-ui.ts";

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
    if (Date.now() > deadline) throw new Error("Tool display did not settle");
    await new Promise((done) => setTimeout(done, 10));
  }
}
function region(surface: DesktopSurface) {
  assert.equal(surface.view.kind, "region");
  return surface.view as Extract<DesktopNode, { kind: "region" }>;
}

test("tool rows retain per-call expansion, native click policy, global no-op semantics and original persisted messages", async (t) => {
  const fixture = await createFixture({ toolDisplay: true });
  const host = new DesktopHost(fixture.agentDir);
  const path = join(fixture.agentDir, "desktop", "tool-display-control.mjs");
  await cp(
    new URL("./fixtures/tool-display-control.mjs", import.meta.url),
    path,
  );
  const run = (args: Record<string, unknown>) =>
    host.action({ action: "sdk.run", args: { path, args } });
  const api = await loadTuiApi();
  const keys = (await loadComponentRuntime()).keys.KeybindingsManager.create(
    fixture.agentDir,
  );
  const surface = (id: string, phase = "result") =>
    host
      .snapshot()
      .desktopSurfaces.find((item) => item.id === `render:${phase}:${id}`)!;
  const expanded = (id: string) =>
    host
      .snapshot()
      .messages.flatMap((message) => message.content)
      .find((block) => block.id === id)!.toolPresentation!.expanded;
  const click = async (
    item: DesktopSurface,
    button: "left" | "right" = "left",
    nativeLink = false,
  ) => {
    const send = (type: "press" | "release") =>
      host.action({
        action: "desktop.mouse",
        args: {
          id: item.id,
          instanceId: item.instanceId,
          action: region(item).action,
          event: {
            pointerId: 1,
            type,
            button,
            nativeLink,
            x: 1,
            y: 0,
            screenX: 0,
            screenY: 0,
            width: 120,
            height: 30,
            shift: false,
            alt: false,
            ctrl: false,
          },
        },
      });
    await send("press");
    return send("release");
  };
  try {
    await host.initialize(fixture.cwd);
    await run({ mode: "seed", expanded: false });
    await until(
      () =>
        host.snapshot().desktopSurfaces.filter((item) => item.slot === "tool")
          .length === 10,
    );
    const saved = host.session.sessionFile!,
      persisted = await readFile(saved, "utf8"),
      raw = structuredClone(host.session.messages);
    for (const variant of ["fallback", "unknown"])
      await t.test(`native ${variant} call/result composition`, async () => {
        const id = `display-${variant}`;
        const originalCall = host.session.messages
          .flatMap((message) =>
            message.role === "assistant" ? message.content : [],
          )
          .find((block) => block.type === "toolCall" && block.id === id)!;
        assert.ok(originalCall.type === "toolCall");
        const originalResult = host.session.messages.find(
          (message) =>
            message.role === "toolResult" && message.toolCallId === id,
        )!;
        const previousKeys = api.getKeybindings();
        api.setKeybindings(keys);
        try {
          const native = new ToolExecutionComponent(
            `display_${variant}`,
            id,
            originalCall.arguments,
            { showImages: true },
            host.session.getToolDefinition(`display_${variant}`),
            { requestRender() {} } as ConstructorParameters<
              typeof ToolExecutionComponent
            >[5],
            fixture.cwd,
          );
          native.updateResult(
            originalResult as Parameters<typeof native.updateResult>[0],
          );
          const contentBox = componentField(native, "contentBox");
          assert.ok(contentBox && typeof contentBox === "object");
          const expected =
            variant === "unknown"
              ? (callComponentMethod(native, "formatToolExecution") as string)
              : (
                  componentField(contentBox, "children") as {
                    render(width: number): string[];
                  }[]
                )
                  .flatMap((child) => child.render(120))
                  .map((line) => line.trimEnd())
                  .join("\n");
          const actual = [
            text(surface(id, "call").view),
            text(surface(id).view),
          ]
            .filter(Boolean)
            .join("\n");
          assert.equal(actual, api.stripTerminalSequences(expected));
        } finally {
          api.setKeybindings(previousKeys);
        }
      });
    assert.ok(text(surface("display-fallback").view).includes("4 more lines"));
    assert.ok(text(surface("display-unknown").view).includes("line 14"));
    await click(surface("display-fallback"), "right");
    assert.equal(expanded("display-fallback"), false);
    await click(surface("display-fallback"));
    await until(() =>
      text(surface("display-fallback").view).includes("line 14"),
    );
    assert.equal(expanded("display-fallback"), true);
    assert.equal(expanded("display-custom"), false);
    assert.equal(
      host.session.extensionRunner.getUIContext().getToolsExpanded(),
      false,
    );
    await run({ expanded: false });
    assert.equal(expanded("display-fallback"), true);
    await click(surface("display-custom", "call"), "left", true);
    assert.equal(expanded("display-custom"), false);
    await click(surface("display-custom", "call"));
    const observed = (await run({
      mode: "state",
      ids: ["display-custom"],
    })) as Record<
      string,
      {
        callExpanded: boolean;
        resultExpanded: boolean;
        callReceiver: boolean;
        resultReceiver: boolean;
      }
    >;
    assert.deepEqual(observed["display-custom"], {
      callExpanded: true,
      resultExpanded: true,
      callReceiver: true,
      resultReceiver: true,
      consumed: 0,
      submitted: undefined,
      disposed: 0,
    });
    assert.deepEqual(host.session.messages, raw);
    assert.equal(await readFile(saved, "utf8"), persisted);
    assert.ok(!persisted.includes("toolPresentation"));
    await run({ expanded: true });
    for (const variant of ["fallback", "custom", "control", "self", "unknown"])
      assert.equal(expanded(`display-${variant}`), true);
    await click(surface("display-custom"));
    assert.equal(expanded("display-custom"), false);
    await run({ expanded: true });
    assert.equal(expanded("display-custom"), false);
    await run({ mode: "append" });
    await until(() => !!surface("display-later"));
    assert.equal(expanded("display-later"), true);
    await host.action({ action: "theme.set", args: { theme: "dark" } });
    assert.equal(expanded("display-custom"), false);
    const old = surface("display-custom");
    await host.action({ action: "resources.reload" });
    await until(() => surface("display-custom")?.instanceId !== old.instanceId);
    assert.equal(expanded("display-custom"), true);
    await click(old);
    assert.equal(expanded("display-custom"), true);
    await host.action({ action: "session.new" });
    await host.action({ action: "session.switch", args: { path: saved } });
    await until(() => !!surface("display-fallback"));
    assert.equal(expanded("display-fallback"), true);
    await run({ mode: "pending" });
    await until(() => !!surface("display-partial", "call"));
    await click(surface("display-partial", "call"));
    assert.equal(
      host.snapshot().activeTools[0].toolPresentation!.expanded,
      true,
    );
    await run({ mode: "partial" });
    await until(() => !!surface("display-partial"));
    await click(surface("display-partial"));
    assert.equal(
      host.snapshot().activeTools[0].toolPresentation!.expanded,
      false,
    );
    await run({ mode: "complete", error: true });
    await until(() =>
      host
        .snapshot()
        .messages.some((message) => message.toolCallId === "display-partial"),
    );
    assert.equal(expanded("display-partial"), false);
    const metadata = host
      .snapshot()
      .messages.find(
        (message) => message.toolCallId === "display-partial",
      )!.toolPresentation!;
    assert.equal(metadata.state, "error");
    assert.equal(metadata.hasResult, true);
    await host.action({
      action: "transcript.tool",
      args: {
        toolCallId: "display-partial",
        sessionId: "retired",
        expanded: true,
      },
    });
    assert.equal(expanded("display-partial"), false);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
