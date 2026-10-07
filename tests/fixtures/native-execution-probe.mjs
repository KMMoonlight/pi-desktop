const states = new WeakMap();
const children = (value) => Reflect.get(value, "children") ?? [];
export default async function (context, { action = "inspect" } = {}) {
  const { host, session, desktop, sdk } = context;
  const scope = desktop.terminalRuntime.capture();
  let state = states.get(host);
  if (!state || state.scope !== scope) states.set(host, (state = { scope }));
  if (action === "seed-tools") {
    const { default: seed } = await import("./tool-display-control.mjs");
    seed(context, { mode: "seed", expanded: false });
  }
  if (action === "bash-start") {
    const gate = new Promise((resolve) => {
      state.release = resolve;
    });
    state.execution = session.executeBash(
      "Native streamed command",
      undefined,
      {
        operations: {
          async exec(_command, _cwd, options) {
            options.onData(Buffer.from("Native streamed output\n"));
            state.entered = true;
            await Promise.race([
              gate,
              new Promise((resolve) =>
                options.signal?.addEventListener("abort", resolve, {
                  once: true,
                }),
              ),
            ]);
            return { exitCode: options.signal?.aborted ? 130 : 0 };
          },
        },
      },
    );
    void state.execution.catch(() => {});
    while (!state.entered)
      await new Promise((resolve) => setTimeout(resolve, 10));
    host.snapshot();
    const chat = children(children(scope.tui.children[0])[2]);
    state.live = chat.find(
      (value) => value instanceof sdk.BashExecutionComponent,
    );
  }
  if (action === "bash-finish") {
    state.release();
    await state.execution;
  }
  if (action === "notice") {
    session.extensionRunner
      .getUIContext()
      .notify("Native original notice", "warning");
  }
  host.snapshot();
  const chat = children(children(scope.tui.children[0])[2]);
  const tools = chat.filter(
    (value) => value instanceof sdk.ToolExecutionComponent,
  );
  const bash = chat.filter(
    (value) => value instanceof sdk.BashExecutionComponent,
  );
  return {
    toolCount: tools.length,
    toolShared: tools.every(
      (value) =>
        Reflect.get(value, "rendererState") ===
        desktop.toolState(Reflect.get(value, "toolCallId")),
    ),
    toolClass: tools.map((value) => value.constructor.name),
    bashCount: bash.length,
    bashSame: !!state.live && bash.includes(state.live),
    bashStatus: bash.map((value) => Reflect.get(value, "status")),
    bashOutput: bash.map((value) => value.getOutput()),
    stoppedLoaders: bash.every(
      (value) =>
        Reflect.get(Reflect.get(value, "loader"), "intervalId") === null,
    ),
    noticeClasses: chat
      .filter((value) => value.constructor.name === "ThemedText")
      .map((value) => value.constructor.name),
    noticeText: chat
      .filter((value) => value.constructor.name === "ThemedText")
      .map((value) => value.render(100).join("\n")),
  };
}
