import {
  createEditToolDefinition,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type {
  ChatMessage,
  ContentBlock,
  ToolPresentation,
} from "../shared/types.ts";
import type { DesktopUIRegistry, DesktopRenderSource } from "./desktop-ui.ts";
import { defaultToolRenderer } from "./tool-rendering.ts";

// Renderer identity keeps extension-provided edit tools on their own presentation.
const nativeEdit = createEditToolDefinition(".");

export interface ToolRenderPhase {
  argsComplete: boolean;
  executionStarted: boolean;
  isPartial: boolean;
  isError: boolean;
}

function defaultMessageRenderer() {
  return undefined;
}

export function describeTool(
  session: AgentSession,
  id: string,
  name: string,
  expanded: boolean,
  phase: Pick<ToolRenderPhase, "isPartial" | "isError">,
  hasResult: boolean,
): ToolPresentation {
  const definition = session.getToolDefinition(name);
  return {
    sessionId: session.sessionId,
    shell: definition ? (definition.renderShell ?? "default") : "generic",
    ...(name === "edit" &&
      definition?.renderCall === nativeEdit.renderCall &&
      definition?.renderResult === nativeEdit.renderResult
      ? { review: "edit" as const }
      : {}),
    expanded,
    state: phase.isPartial ? "pending" : phase.isError ? "error" : "success",
    hasResult,
  };
}

export function connectRenderers(
  session: AgentSession,
  desktop: DesktopUIRegistry,
  messages: ChatMessage[],
  streaming: ChatMessage | undefined,
  activeTools: {
    id: string;
    name: string;
    arguments: unknown;
    result?: unknown;
  }[],
  expanded: boolean,
  phases: ReadonlyMap<string, ToolRenderPhase> = new Map(),
  rawMessages: ReadonlyMap<
    string,
    AgentSession["messages"][number]
  > = new Map(),
  toolExpansions: ReadonlyMap<string, boolean> = new Map(),
) {
  const results = new Map(
    messages
      .filter((message) => message.role === "toolResult" && message.toolCallId)
      .map((message) => [message.toolCallId!, message]),
  );
  // Pi completes unfinished tool rows with an error when assistant generation stops.
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (
      message.role !== "assistant" ||
      !["aborted", "error"].includes(message.stopReason ?? "")
    )
      continue;
    const error =
      message.stopReason === "aborted"
        ? session.retryAttempt > 0
          ? `Aborted after ${session.retryAttempt} retry attempt${session.retryAttempt > 1 ? "s" : ""}`
          : "Operation aborted"
        : message.errorMessage || "Error";
    const interrupted = message.content.flatMap((block): ChatMessage[] => {
      if (block.type !== "toolCall" || !block.id || results.has(block.id))
        return [];
      const result: ChatMessage = {
        id: `render:interrupted:${block.id}`,
        role: "toolResult",
        toolCallId: block.id,
        toolName: block.name,
        content: [{ type: "text", text: error }],
        isError: true,
        timestamp: message.timestamp,
      };
      results.set(block.id, result);
      return [result];
    });
    messages.splice(index + 1, 0, ...interrupted);
  }
  const specs: Parameters<DesktopUIRegistry["reconcile"]>[0] = [];
  const calls = new Map<string, ContentBlock>();
  const context = {
    expanded,
    cwd: session.sessionManager.getCwd(),
    isStreaming: false,
    isPartial: false,
    isError: false,
    argsComplete: true,
    executionStarted: false,
    showImages: session.settingsManager.getShowImages(),
  };
  const toolPhase = (id: string): ToolRenderPhase => {
    const phase = phases.get(id);
    const result = results.get(id);
    return {
      argsComplete: phase?.argsComplete ?? false,
      executionStarted:
        phase?.executionStarted ?? activeTools.some((tool) => tool.id === id),
      isPartial: result ? false : (phase?.isPartial ?? true),
      isError: result ? result.isError === true : (phase?.isError ?? false),
    };
  };
  const toolExpanded = (id: string) => toolExpansions.get(id) ?? expanded;
  const hasResult = (id: string) =>
    results.has(id) ||
    activeTools.some((tool) => tool.id === id && tool.result !== undefined);
  const add = (
    id: string,
    source: DesktopRenderSource,
    slot: "message" | "tool" | "entry",
    target: (typeof specs)[number]["target"],
  ) => {
    specs.push({ id, source, slot, target });
    return desktop.canAdapt(source, slot) ? id : undefined;
  };
  const render = (message: ChatMessage, isStreaming: boolean) => {
    for (const block of message.content) {
      if (block.type === "toolCall" && block.id && block.name) {
        calls.set(block.id, block);
        const definition = session.getToolDefinition(block.name);
        block.toolRenderShell = definition?.renderShell;
        block.toolPresentation = describeTool(
          session,
          block.id,
          block.name,
          toolExpanded(block.id),
          toolPhase(block.id),
          hasResult(block.id),
        );
        const renderer = definition?.renderCall ?? defaultToolRenderer;
        block.desktopSurfaceId = add(
          `render:call:${block.id}`,
          {
            kind: "toolCall",
            renderer,
            value: block.arguments,
            context: {
              ...context,
              ...toolPhase(block.id),
              expanded: toolExpanded(block.id),
              hasResult: hasResult(block.id),
              toolDefinitionAvailable: definition !== undefined,
              state: desktop.toolState(block.id),
              isStreaming,
              toolCallId: block.id,
              toolName: block.name,
              args: block.arguments,
            },
          },
          "tool",
          {
            messageId: message.id,
            blockId: block.id,
            toolCallId: block.id,
            phase: "call",
          },
        );
      }
    }
    if (message.role === "custom" && message.customType) {
      const renderer =
        session.extensionRunner.getMessageRenderer(message.customType) ??
        defaultMessageRenderer;
      message.desktopSurfaceId = add(
        `render:message:${message.entryId ?? message.id}`,
        {
          kind: "message",
          renderer,
          value: rawMessages.get(message.id) ??
            session.messages.find(
              (raw) =>
                raw.role === "custom" &&
                raw.customType === message.customType &&
                raw.timestamp === message.timestamp,
            ) ?? {
              role: "custom",
              customType: message.customType,
              content: message.content,
              details: message.details,
              display: true,
              timestamp: message.timestamp,
            },
          context: {
            ...context,
            isStreaming,
            outputPad: session.settingsManager.getOutputPad(),
            codeBlockIndent: session.settingsManager.getCodeBlockIndent(),
          },
        },
        "message",
        { messageId: message.id },
      );
    }
    if (
      message.role === "toolResult" &&
      message.toolCallId &&
      message.toolName
    ) {
      const definition = session.getToolDefinition(message.toolName);
      message.toolRenderShell = definition?.renderShell;
      message.toolPresentation = describeTool(
        session,
        message.toolCallId,
        message.toolName,
        toolExpanded(message.toolCallId),
        toolPhase(message.toolCallId),
        true,
      );
      const renderer = definition?.renderResult ?? defaultToolRenderer;
      message.desktopSurfaceId = add(
        `render:result:${message.toolCallId}`,
        {
          kind: "toolResult",
          renderer,
          value: (() => {
            const raw = session.messages.find(
              (raw) =>
                raw.role === "toolResult" &&
                raw.toolCallId === message.toolCallId,
            );
            return raw?.role === "toolResult"
              ? { content: raw.content, details: raw.details }
              : { content: message.content, details: message.details };
          })(),
          context: {
            ...context,
            ...toolPhase(message.toolCallId),
            expanded: toolExpanded(message.toolCallId),
            hasResult: true,
            toolDefinitionAvailable: definition !== undefined,
            state: desktop.toolState(message.toolCallId),
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            args: calls.get(message.toolCallId)?.arguments,
          },
        },
        "tool",
        {
          messageId: message.id,
          toolCallId: message.toolCallId,
          phase: "result",
        },
      );
    }
  };
  messages.forEach((message) => render(message, false));
  if (streaming) render(streaming, true);
  for (const tool of activeTools) {
    const definition = session.getToolDefinition(tool.name);
    if (!calls.has(tool.id))
      add(
        `render:call:${tool.id}`,
        {
          kind: "toolCall",
          renderer: definition?.renderCall ?? defaultToolRenderer,
          value: tool.arguments,
          context: {
            ...context,
            ...toolPhase(tool.id),
            expanded: toolExpanded(tool.id),
            hasResult: hasResult(tool.id),
            toolDefinitionAvailable: definition !== undefined,
            state: desktop.toolState(tool.id),
            isStreaming: true,
            toolCallId: tool.id,
            toolName: tool.name,
            args: tool.arguments,
          },
        },
        "tool",
        { toolCallId: tool.id, phase: "call" },
      );
    const renderer = definition?.renderResult ?? defaultToolRenderer;
    if (tool.result)
      add(
        `render:result:${tool.id}`,
        {
          kind: "toolResult",
          renderer,
          value: {
            content: (tool.result as { content: unknown }).content,
            details: (tool.result as { details?: unknown }).details,
          },
          context: {
            ...context,
            ...toolPhase(tool.id),
            expanded: toolExpanded(tool.id),
            hasResult: true,
            toolDefinitionAvailable: definition !== undefined,
            state: desktop.toolState(tool.id),
            isStreaming: true,
            isPartial: true,
            toolCallId: tool.id,
            toolName: tool.name,
            args: calls.get(tool.id)?.arguments ?? tool.arguments,
          },
        },
        "tool",
        { toolCallId: tool.id, phase: "result" },
      );
  }
  const projection = session.sessionManager.buildSessionProjection().entries;
  for (let i = 0; i < projection.length; i++) {
    const entry = projection[i].sourceEntry;
    if (entry.type !== "custom") continue;
    const renderer = session.extensionRunner.getEntryRenderer(entry.customType);
    if (!renderer) continue;
    const desktopSurfaceId = add(
      `render:entry:${entry.id}`,
      { kind: "entry", renderer, value: entry, context },
      "entry",
      { entryId: entry.id },
    );
    if (!desktopSurfaceId) continue;
    const later = new Set(
      projection.slice(i + 1).map((item) => item.sourceEntry.id),
    );
    const index = messages.findIndex(
      (message) => message.entryId && later.has(message.entryId),
    );
    messages.splice(index < 0 ? messages.length : index, 0, {
      id: `entry-${entry.id}`,
      entryId: entry.id,
      role: "customEntry",
      content: [],
      customType: entry.customType,
      timestamp: Date.parse(entry.timestamp),
      desktopSurfaceId,
    });
  }
  const current = [...new Map(specs.map((spec) => [spec.id, spec])).values()];
  desktop.terminalRuntime.capture().application?.tools.prepare(current);
  desktop.reconcile(current);
}
