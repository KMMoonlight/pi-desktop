import { Box, Container, Input, Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

export default function (pi) {
  let failing = true;
  const contexts = new Map();
  for (const variant of [
    "default_failure",
    "self_failure",
    "self_missing",
    "self_control",
    "self_empty",
  ]) {
    const definition = {
      name: `shell_${variant}`,
      label: variant,
      description: "Generic tool shell fixture",
      parameters: Type.Object({ value: Type.String() }),
      renderShell: variant.startsWith("self") ? "self" : "default",
      async execute() {
        return {
          content: [{ type: "text", text: "Tool shell output" }],
          details: {},
        };
      },
    };
    if (variant !== "self_missing") {
      definition.renderCall = function (args, _theme, context) {
        contexts.set(context.toolCallId, context);
        context.state.callReceiver = this === undefined;
        context.state.callLast = !!context.lastComponent;
        if (variant.includes("failure") && failing)
          throw new Error("Shell call fixture failure");
        const result = context.lastComponent ?? new Text("", 0, 0);
        result.setText(
          variant === "self_empty"
            ? ""
            : `Shell call ${variant}: ${args.value}`,
        );
        return result;
      };
      definition.renderResult = function (_result, options, _theme, context) {
        context.state.resultReceiver = this === undefined;
        context.state.resultLast = !!context.lastComponent;
        if (variant.includes("failure") && failing)
          throw new Error("Shell result fixture failure");
        if (variant === "self_control") {
          if (context.lastComponent) return context.lastComponent;
          const container = new Container();
          const box = new Box(1, 1);
          box.addChild(new Text("Extension-owned frame", 0, 0));
          const input = new Input({ prompt: "Shell value" });
          input.setValue("Editable tool result");
          input.onSubmit = (value) => (context.state.submitted = value);
          box.addChild(input);
          container.addChild(box);
          return container;
        }
        const result = context.lastComponent ?? new Text("", 0, 0);
        result.setText(
          variant === "self_empty"
            ? ""
            : `Shell result ${variant}; partial=${options.isPartial}; expanded=${options.expanded}`,
        );
        return result;
      };
    }
    pi.registerTool(definition);
  }
  pi.registerCommand("shell-fail", {
    handler() {
      failing = true;
      for (const context of contexts.values()) context.invalidate();
    },
  });
  pi.registerCommand("shell-recover", {
    handler() {
      failing = false;
      for (const context of contexts.values()) context.invalidate();
    },
  });
}
