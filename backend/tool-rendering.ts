import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { DesktopRenderSource } from "./desktop-ui.ts";
import { callComponentMethod, type PiComponent } from "./component-runtime.ts";

export function defaultToolRenderer() {
  return undefined;
}

export function createToolFallback(
  source: DesktopRenderSource,
): PiComponent | undefined {
  // Reuse the pinned SDK's fallback methods without constructing its terminal shell.
  const receiver = Object.assign(
    Object.create(ToolExecutionComponent.prototype),
    {
      toolName: source.context.toolName,
      args: source.context.args ?? source.value,
      expanded:
        source.context.toolDefinitionAvailable === false
          ? true
          : source.context.expanded,
      showImages: source.context.showImages,
      result: source.kind === "toolResult" ? source.value : undefined,
    },
  );
  if (receiver.result && receiver.showImages) {
    receiver.result = {
      ...receiver.result,
      content: receiver.result.content.filter(
        (block: { type: string }) => block.type !== "image",
      ),
    };
  }
  const component = callComponentMethod(
    receiver,
    source.kind === "toolCall" ? "createCallFallback" : "createResultFallback",
  ) as PiComponent | undefined;
  if (source.context.toolDefinitionAvailable === false && component)
    callComponentMethod(
      component,
      "setText",
      callComponentMethod(
        receiver,
        source.kind === "toolCall" ? "formatToolExecution" : "getTextOutput",
      ),
    );
  return component;
}

export function createToolResultRegion(
  child: PiComponent,
  source: DesktopRenderSource,
  onExpanded: (expanded: boolean) => void,
) {
  const receiver = Object.assign(
    Object.create(ToolExecutionComponent.prototype),
    {
      expanded: source.context.expanded,
      result: source.context.hasResult ? {} : undefined,
      setExpanded(expanded: boolean) {
        this.expanded = expanded;
        onExpanded(expanded);
      },
    },
  );
  const region = callComponentMethod(
    receiver,
    "createResultRegion",
    child,
  ) as PiComponent;
  return {
    component: region,
    update(next: PiComponent, current: DesktopRenderSource) {
      Reflect.set(region, "child", next);
      receiver.expanded = current.context.expanded;
      receiver.result = current.context.hasResult ? {} : undefined;
    },
  };
}
