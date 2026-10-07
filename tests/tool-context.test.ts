import test from "node:test";
import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import type { DesktopRenderSource } from "../backend/desktop-ui.ts";
import type { ToolRenderPhase } from "../backend/renderers.ts";
import { createFixture } from "./fixture.ts";

type Context = DesktopRenderSource["context"];
type NativeContext = Parameters<
  NonNullable<
    NonNullable<
      ConstructorParameters<typeof ToolExecutionComponent>[4]
    >["renderCall"]
  >
>[2];
const pick = (context: ToolRenderPhase) => ({
  argsComplete: context.argsComplete,
  executionStarted: context.executionStarted,
  isPartial: context.isPartial,
  isError: context.isError,
});
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Tool context did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function setup() {
  const fixture = await createFixture({ toolContext: true });
  const host = new DesktopHost(fixture.agentDir);
  await host.initialize(fixture.cwd);
  const path = join(fixture.agentDir, "desktop", "tool-context-control.mjs");
  await cp(
    new URL("./fixtures/tool-context-control.mjs", import.meta.url),
    path,
  );
  const control = (args: Record<string, unknown>) =>
    host.action({ action: "sdk.run", args: { path, args } });
  const command = (name: string) =>
    host.action({ action: "prompt", args: { message: `/${name}` } });
  const current = (id: string, slot = "call") =>
    host.desktopUI.toolState(id)[`${slot}Context`] as Context | undefined;
  const api = await loadTuiApi();
  const tui = new api.TuiMainScreen(new api.ProcessTerminal());
  tui.requestRender = () => {};
  let originalContext: ToolRenderPhase | undefined;
  const definition: NonNullable<
    ConstructorParameters<typeof ToolExecutionComponent>[4]
  > = {
    renderCall(_args: unknown, _theme: unknown, context: NativeContext) {
      originalContext = context;
      return new api.Input();
    },
    renderResult(
      _result: unknown,
      _options: unknown,
      _theme: unknown,
      context: NativeContext,
    ) {
      originalContext = context;
      return new api.Input();
    },
  };
  const original = new ToolExecutionComponent(
    "context_tool",
    "reference",
    {},
    {},
    definition,
    tui as unknown as ConstructorParameters<typeof ToolExecutionComponent>[5],
    fixture.cwd,
  );
  const compare = (id: string, slot = "call") =>
    assert.deepEqual(pick(current(id, slot)!), pick(originalContext!));
  const start = async (mode: string) => {
    await control({ action: "arm" });
    const pending = host.action({
      action: "prompt",
      args: { message: `context-lifecycle-${mode}` },
    });
    pending.catch(() => {});
    await until(
      () =>
        !!host
          .snapshot()
          .streaming?.content.some((block) => block.type === "toolCall"),
    );
    const id = host
      .snapshot()
      .streaming!.content.find((block) => block.type === "toolCall")!.id!;
    await until(() => !!current(id));
    assert.ok(
      host.desktopUI.terminalRuntime.capture().application!.tools.get(id)
        ?.original instanceof ToolExecutionComponent,
    );
    compare(id);
    return { id, pending };
  };
  const close = async () => {
    await host.dispose();
    await fixture.close();
  };
  return {
    fixture,
    host,
    control,
    command,
    current,
    original,
    compare,
    start,
    close,
  };
}

for (const mode of ["success", "error", "nested", "abort"])
  test(`real streamed arguments, execution, partial/final result and row invalidation: ${mode}`, async () => {
    const {
      fixture,
      host,
      control,
      command,
      current,
      original,
      compare,
      start,
      close,
    } = await setup();
    try {
      const { id, pending } = await start(mode);
      const callInstance = host
        .snapshot()
        .desktopSurfaces.find(
          (surface) => surface.id === `render:call:${id}`,
        )!.instanceId;
      const raw = host.desktopUI.toolState(id).callComponent;
      const nativeRow = host.desktopUI.terminalRuntime
        .capture()
        .application!.tools.get(id)!.original!;
      await control({ action: "release" });
      if (mode === "nested") {
        await until(() => !!host.snapshot().statuses["context-child"]);
        assert.ok(
          !host
            .snapshot()
            .activeTools.some((tool) => tool.name === "context_child"),
        );
        await command("context-child-finish");
      }
      await until(() => !!host.snapshot().statuses["context-execution"]);
      assert.equal(host.snapshot().statuses["context-prepared"], "true");
      original.setArgsComplete();
      original.markExecutionStarted();
      await until(() => current(id)?.executionStarted === true);
      compare(id);
      assert.equal(host.desktopUI.toolState(id).callComponent, raw);
      assert.equal(
        host
          .snapshot()
          .desktopSurfaces.find(
            (surface) => surface.id === `render:call:${id}`,
          )!.instanceId,
        callInstance,
      );
      await command("context-partial");
      original.updateResult(
        {
          content: [{ type: "text", text: "Context partial" }],
          isError: false,
        },
        true,
      );
      await until(() => current(id, "result")?.isPartial === true);
      compare(id);
      compare(id, "result");
      const state = host.desktopUI.toolState(id);
      const resultComponent = state.resultComponent;
      assert.equal(current(id)!.state, current(id, "result")!.state);
      assert.equal(current(id)!.args, current(id, "result")!.args);
      assert.equal(
        (current(id)!.args as { prepared?: boolean }).prepared,
        undefined,
      );
      assert.deepEqual(state.optionKeys, ["expanded", "isPartial"]);
      assert.deepEqual(state.resultKeys, ["content", "details"]);
      for (const slot of ["call", "result"]) {
        const observation = await control({ action: "invalidate", id, slot });
        assert.equal(
          (observation as { synchronous: boolean }).synchronous,
          true,
        );
        await until(() =>
          host
            .snapshot()
            .desktopSurfaces.filter(
              (surface) => surface.target?.toolCallId === id,
            )
            .every((surface) => {
              const view =
                surface.view.kind === "region"
                  ? surface.view.child
                  : surface.view;
              return (
                view.kind === "text" && view.text.includes(`tick=${state.tick}`)
              );
            }),
        );
      }
      assert.equal(state.callComponent, raw);
      assert.equal(state.resultComponent, resultComponent);
      assert.equal(
        host.desktopUI.terminalRuntime.capture().application!.tools.get(id)!
          .original,
        nativeRow,
      );
      assert.equal(Reflect.get(nativeRow, "callRendererComponent"), raw);
      assert.equal(
        Reflect.get(nativeRow, "resultRendererComponent"),
        resultComponent,
      );
      if (mode === "success") {
        const previous = state.callContext;
        await control({ action: "theme", theme: "dark" });
        host.snapshot();
        assert.notEqual(state.callContext, previous);
        assert.equal(state.callComponent, raw);
      }
      await control({ action: "save", id });
      if (mode === "abort") await host.action({ action: "abort" });
      else await command("context-finish");
      await pending;
      await until(
        () =>
          !host.snapshot().busy && current(id, "result")?.isPartial === false,
      );
      original.updateResult({
        content: [{ type: "text", text: "final" }],
        isError: mode === "error" || mode === "abort",
      });
      compare(id);
      compare(id, "result");
      const sessionFile = host.session.sessionFile!;
      const persisted = await readFile(sessionFile, "utf8");
      assert.ok(!persisted.includes("render:interrupted:"));
      await host.action({ action: "session.new" });
      await host.action({
        action: "session.switch",
        args: { path: sessionFile },
      });
      await until(() => !!current(id, "result"));
      assert.deepEqual(pick(current(id)!), {
        argsComplete: false,
        executionStarted: false,
        isPartial: false,
        isError: mode === "error" || mode === "abort",
      });
      const restored = host.desktopUI.toolState(id);
      const component = restored.callComponent;
      await control({ action: "stale" });
      assert.equal(restored.callComponent, component);
      assert.equal(restored.tick, undefined);
      assert.equal(await readFile(sessionFile, "utf8"), persisted);
    } finally {
      await close();
    }
  });

test("generation cancellation completes the original partial tool row without mutating SDK messages", async () => {
  const { host, current, original, compare, start, close } = await setup();
  try {
    const { id, pending } = await start("abort-generation");
    await host.action({ action: "abort" });
    await pending;
    await until(() => !host.snapshot().busy && !!current(id, "result"));
    original.updateResult({
      content: [{ type: "text", text: "Operation aborted" }],
      isError: true,
    });
    compare(id);
    compare(id, "result");
    const snapshot = host.snapshot();
    assert.ok(
      snapshot.messages.some(
        (message) => message.toolCallId === id && message.isError,
      ),
    );
    assert.ok(
      !host.session.messages.some(
        (message) => message.role === "toolResult" && message.toolCallId === id,
      ),
    );
    assert.ok(
      !(await readFile(host.session.sessionFile!, "utf8")).includes(
        "render:interrupted:",
      ),
    );
  } finally {
    await close();
  }
});
