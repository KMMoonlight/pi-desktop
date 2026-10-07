import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

export default function (pi) {
  pi.registerTool({
    name: "policy_rendered",
    label: "Policy rendered",
    description: "Transcript policy fixture",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: "Policy output" }],
        details: {},
      };
    },
    renderCall(_args, _theme, context) {
      const component = context.lastComponent ?? new Text("", 0, 0);
      component.setText(`Policy call images: ${context.showImages}`);
      return component;
    },
    renderResult(_result, options, _theme, context) {
      const component = context.lastComponent ?? new Text("", 0, 0);
      component.setText(
        `Policy result images: ${context.showImages}; partial: ${options.isPartial}`,
      );
      return component;
    },
  });
}
