import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

export default function (pi) {
  let pending;
  let childDone;
  const flags = (context) =>
    `args=${context.argsComplete}; started=${context.executionStarted}; partial=${context.isPartial}; error=${context.isError}; tick=${context.state.tick ?? 0}`;
  pi.registerTool({
    name: "context_child",
    label: "Context child",
    description: "Nested context lifecycle fixture",
    parameters: Type.Object({}),
    async execute(id, _args, signal, _onUpdate, ctx) {
      ctx.ui.setStatus("context-child", id);
      await new Promise((resolve) => {
        childDone = resolve;
        signal?.addEventListener("abort", resolve, { once: true });
      });
      return { content: [{ type: "text", text: "Context nested result" }] };
    },
  });
  pi.registerTool({
    name: "context_tool",
    label: "Context tool",
    description: "Tool renderer lifecycle fixture",
    parameters: Type.Object({ value: Type.String(), mode: Type.String() }),
    prepareArguments(args) {
      return { ...args, prepared: true };
    },
    async execute(id, args, signal, onUpdate, ctx) {
      ctx.ui.setStatus("context-prepared", String(args.prepared));
      if (args.mode === "nested") await ctx.executeTool("context_child", {});
      ctx.ui.setStatus("context-execution", id);
      await new Promise((resolve, reject) => {
        const abort = () => reject(new Error("Context execution aborted"));
        pending = {
          update: () =>
            onUpdate?.({
              content: [{ type: "text", text: "Context partial" }],
              details: { stage: "partial" },
              structuredContent: { stage: "partial" },
            }),
          finish: () => {
            signal?.removeEventListener("abort", abort);
            if (args.mode === "error")
              reject(new Error("Context execution failed"));
            else resolve();
          },
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      }).finally(() => {
        pending = undefined;
      });
      return {
        content: [{ type: "text", text: "Context final" }],
        details: { stage: "final" },
      };
    },
    renderCall(args, theme, context) {
      const component = context.lastComponent ?? new Text("", 0, 0);
      context.state.callContext = context;
      context.state.callComponent = component;
      component.setText(
        theme.fg(
          "toolTitle",
          `Context call ${args.value ?? "missing"}: ${flags(context)}`,
        ),
      );
      return component;
    },
    renderResult(result, options, _theme, context) {
      const component = context.lastComponent ?? new Text("", 0, 0);
      context.state.resultContext = context;
      context.state.resultComponent = component;
      context.state.resultKeys = Object.keys(result).sort();
      context.state.optionKeys = Object.keys(options).sort();
      component.setText(
        `Context result ${result.content.map((block) => block.text ?? "").join(" ")}: ${flags(context)}`,
      );
      return component;
    },
  });
  pi.registerCommand("context-partial", {
    handler: async () => pending?.update(),
  });
  pi.registerCommand("context-finish", {
    handler: async () => pending?.finish(),
  });
  pi.registerCommand("context-child-finish", {
    handler: async () => childDone?.(),
  });
}
