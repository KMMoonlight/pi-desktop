import { Container, Input, MouseRegion, Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

export default function (pi) {
  for (const variant of ["fallback", "custom", "control", "self"]) {
    const name = `display_${variant}`;
    const definition = {
      name,
      label: name,
      description: "Tool display fixture",
      parameters: Type.Object({ value: Type.String() }),
      execute: async () => ({
        content: [{ type: "text", text: "Display execution" }],
      }),
      ...(variant === "self" ? { renderShell: "self" } : {}),
    };
    if (variant !== "fallback") {
      definition.renderCall = function (_args, _theme, ctx) {
        ctx.state.callExpanded = ctx.expanded;
        ctx.state.callReceiver = this === undefined;
        const component = ctx.lastComponent ?? new Text("", 0, 0);
        component.setText(
          `${name} call; expanded=${ctx.expanded}` +
            (variant === "custom"
              ? "\n\x1b]8;;https://example.invalid/pi-tool\x1b\\Display reference\x1b]8;;\x1b\\"
              : ""),
        );
        return component;
      };
      definition.renderResult = function (_result, options, _theme, ctx) {
        ctx.state.resultExpanded = options.expanded;
        ctx.state.resultReceiver = this === undefined;
        if (!ctx.lastComponent) {
          const container = new Container();
          const label = new Text("", 0, 0);
          container.addChild(label);
          container.fixtureLabel = label;
          if (variant === "control" || variant === "self") {
            const input = new Input({ prompt: `${name} input` });
            input.setValue("Display original input");
            input.onSubmit = (value) => (ctx.state.submitted = value);
            container.addChild(input);
            container.addChild(
              new MouseRegion(
                new Text(`${name} consumed click`, 0, 0),
                (event) => {
                  if (event.type !== "click") return undefined;
                  ctx.state.consumed = (ctx.state.consumed ?? 0) + 1;
                  return { handled: true };
                },
              ),
            );
          }
          ctx.state.disposed = 0;
          container.dispose = () => {
            ctx.state.disposed++;
          };
          ctx.state.component = container;
          ctx.lastComponent = container;
        }
        ctx.lastComponent.fixtureLabel.setText(
          `${name} result; expanded=${options.expanded}; partial=${options.isPartial}`,
        );
        return ctx.lastComponent;
      };
    }
    pi.registerTool(definition);
  }
}
