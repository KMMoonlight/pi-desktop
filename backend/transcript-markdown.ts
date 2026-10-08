import {
  AssistantMessageComponent,
  type AgentSession,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type {
  ChatMessage,
  ContentBlock,
  TranscriptMarkdown,
} from "../shared/types.ts";
import {
  requiredComponentField,
  type loadComponentRuntime,
} from "./component-runtime.ts";
import { componentMarkdown } from "./component-markdown.ts";
import { componentText } from "./component-text.ts";

type Runtime = Awaited<ReturnType<typeof loadComponentRuntime>>;

export class TranscriptMarkdownRenderer {
  private session?: AgentSession;
  private sessionId?: string;
  private hideThinking?: boolean;
  private thinkingVisibility = new Map<string, boolean>();
  private previousStreaming?: ChatMessage;

  constructor(private runtime: Runtime) {}

  toolOutput(content: ContentBlock[]) {
    return content.map((block) => {
      if (block.type !== "image") return block;
      const dimensions =
        block.data && block.mimeType
          ? this.runtime.image.getImageDimensions(block.data, block.mimeType)
          : undefined;
      return {
        ...block,
        imageFallback: this.runtime.image.imageFallback(
          block.mimeType ?? "image/unknown",
          dimensions ?? undefined,
        ),
      };
    });
  }

  completionNotice(
    message: NonNullable<
      ConstructorParameters<typeof AssistantMessageComponent>[0]
    >,
  ) {
    if (!["length", "aborted", "error"].includes(message.stopReason ?? ""))
      return;
    // Keep Pi's stop-reason/tool-call policy and error styling in its original component.
    const component = new AssistantMessageComponent({
      ...message,
      content: message.content.filter((block) => block.type === "toolCall"),
    });
    const container = requiredComponentField(
      component,
      "contentContainer",
    ) as object;
    const children = requiredComponentField(container, "children") as object[];
    const notice = children.find((child) => "text" in child);
    if (notice)
      return componentText(
        String(requiredComponentField(notice, "text")),
        this.runtime.text,
      );
  }

  setThinkingVisible(message: ChatMessage, index: number, visible: boolean) {
    this.thinkingVisibility.set(`${message.id}:${index}`, visible);
  }

  resetThinking() {
    this.thinkingVisibility.clear();
    this.previousStreaming = undefined;
  }

  render(
    session: AgentSession,
    theme: Theme,
    messages: ChatMessage[],
    streaming: ChatMessage | undefined,
    width: number,
    availableWidths?: {
      text: number;
      thinking: number;
      user?: number;
      users?: Record<string, number>;
    },
  ) {
    const settings = session.settingsManager;
    const hideThinking = settings.getHideThinkingBlock();
    if (
      this.session !== session ||
      this.sessionId !== session.sessionId ||
      this.hideThinking !== hideThinking
    )
      this.resetThinking();
    this.session = session;
    this.sessionId = session.sessionId;
    this.hideThinking = hideThinking;
    // Completed replies collapse once; subsequent manual expansion remains intact.
    const previous = this.previousStreaming;
    if (previous && previous.timestamp !== streaming?.timestamp) {
      const completed = [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            message.timestamp === previous.timestamp,
        );
      if (completed)
        for (const key of this.thinkingVisibility.keys())
          if (key.startsWith(`${previous.id}:`))
            this.thinkingVisibility.set(
              `${completed.id}:${key.slice(previous.id.length + 1)}`,
              false,
            );
    }
    this.previousStreaming = streaming;
    const api = this.runtime.markdown;
    const transformers = [
      api.createMermaidMarkdownTransformer({
        getMode: () => settings.getMermaidRenderingMode(),
        theme,
      }),
      ...session.extensionRunner.getMarkdownTransformers(),
    ];
    const markdownTheme = {
      ...api.getMarkdownTheme(),
      codeBlockIndent: settings.getCodeBlockIndent(),
    };
    const liveThinking = new Set<string>();
    const render = (message: ChatMessage, isStreaming: boolean) => {
      if (message.role === "toolResult")
        message.content = this.toolOutput(message.content);
      if (message.role !== "user" && message.role !== "assistant") return;
      const presentations: TranscriptMarkdown[] = [];
      const add = (
        blockIndices: number[],
        source: string,
        thinking = false,
      ) => {
        const key = `${message.id}:${blockIndices[0]}`;
        if (thinking) liveThinking.add(key);
        const visible =
          !thinking ||
          (this.thinkingVisibility.get(key) ?? (isStreaming && !hideThinking));
        const componentWidth = availableWidths
          ? (message.role === "user"
              ? (availableWidths.users?.[message.id] ??
                availableWidths.user ??
                availableWidths.text)
              : availableWidths[thinking ? "thinking" : "text"]) +
            settings.getOutputPad() * 2
          : width;
        const component =
          visible && (message.role === "user" ? source : source.trim())
            ? new api.Markdown(
                source,
                settings.getOutputPad(),
                0,
                markdownTheme,
                thinking
                  ? {
                      color: (text: string) => theme.fg("thinkingText", text),
                      italic: true,
                    }
                  : message.role === "user"
                    ? {
                        color: (text: string) =>
                          theme.fg("userMessageText", text),
                      }
                    : undefined,
                {
                  ...(message.role === "user"
                    ? {
                        preserveOrderedListMarkers: true,
                        preserveBackslashEscapes: true,
                      }
                    : {}),
                  transform: api.createMarkdownTransform(
                    thinking
                      ? "assistant-thinking"
                      : (message.role as "user" | "assistant"),
                    message.role === "user" ? false : isStreaming,
                    transformers,
                  ),
                },
              )
            : undefined;
        const rendered = component
          ? componentMarkdown(component, componentWidth, this.runtime.text)
          : { text: source, blocks: [] };
        presentations.push({
          blockIndices,
          source: rendered.text,
          blocks: rendered.blocks,
          ...(thinking ? { visible } : {}),
        });
      };
      if (message.role === "user") {
        const indices = message.content.flatMap((block, index) =>
          block.type === "text" ? [index] : [],
        );
        if (indices.length)
          add(
            indices,
            indices
              .map((index) => message.content[index].text ?? "")
              .join("\n"),
          );
      } else {
        for (let index = 0; index < message.content.length; index++) {
          const block = message.content[index];
          if (block.type === "text") add([index], (block.text ?? "").trim());
          else if (block.type === "thinking") {
            const indices = [index];
            while (message.content[index + 1]?.type === "thinking")
              indices.push(++index);
            add(
              indices,
              indices
                .map((i) => (message.content[i].thinking ?? "").trim())
                .filter(Boolean)
                .join("\n\n"),
              true,
            );
          }
        }
      }
      message.markdown = presentations;
    };
    messages.forEach((message) => render(message, false));
    if (streaming) render(streaming, true);
    for (const key of this.thinkingVisibility.keys())
      if (!liveThinking.has(key)) this.thinkingVisibility.delete(key);
  }
}
