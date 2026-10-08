import { t, useLocale, getLocale } from "./i18n";
import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { GenerationStatus } from "./GenerationStatus";
import {
  groupTranscriptRows,
  replySummary,
  isProcessRow,
  type TranscriptRow,
  type ReplyRow,
  type ReplyGroup,
} from "./transcript-turns";
import { ImagePreview } from "./ImagePreview";
import { MarkdownImage } from "./MarkdownImage";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Copy,
  GitBranch,
  Check,
  ChevronDown,
  Brain,
  ArrowDown,
  FileCode2,
  UserRound,
  LoaderCircle,
  Wrench,
  FileText,
  Search,
  Terminal,
  Pencil,
  FolderOpen,
} from "lucide-react";
import type {
  ChatMessage,
  DesktopSnapshot,
  TranscriptMarkdown,
  ContentBlock,
} from "../shared/types";
import { IconButton } from "./ui";
import { CodeBlock } from "./CodeBlock";
import { PiLogo } from "./PiLogo";
import { DesktopLink } from "./DesktopLink";
import { desktopFileTarget } from "./FileNavigation";
import { StyledText } from "./StyledText";
import { ComponentMarkdown } from "./ComponentMarkdown";
import { desktopExternalLink } from "../shared/links";
import { DesktopSurfaceView } from "./DesktopExtensions";
import type { Run } from "./Workspace";
import type {
  DesktopNode,
  DesktopSurface,
  DesktopMarkdownText,
} from "../shared/desktop-ui";

function interactiveNode(node: DesktopNode): boolean {
  if (
    node.rendered?.control ||
    [
      "terminal",
      "button",
      "input",
      "textarea",
      "select",
      "toggle",
      "number",
      "slider",
      "tabs",
    ].includes(node.kind)
  )
    return true;
  if ("children" in node) return node.children.some(interactiveNode);
  if (node.kind === "region")
    return !node.nativeControls || interactiveNode(node.child);
  return false;
}

function toolStep(call: ContentBlock): string {
  const args =
    call.arguments && typeof call.arguments === "object"
      ? (call.arguments as Record<string, unknown>)
      : {};
  const labels: Record<string, string> = {
    read: t("读取"),
    write: t("写入"),
    edit: t("修改"),
    grep: t("搜索"),
    find: t("查找"),
    ls: t("列出"),
    bash: t("执行命令"),
    powershell: t("执行命令"),
  };
  const target = args.path ?? args.file_path ?? args.command ?? args.pattern;
  return `${labels[call.name ?? ""] ?? call.name ?? t("工具")}${typeof target === "string" ? ` · ${target.replace(/\s+/g, " ").slice(0, 140)}` : ""}`;
}

const toolIcons = {
  read: FileText,
  write: Pencil,
  edit: Pencil,
  grep: Search,
  find: Search,
  ls: FolderOpen,
  bash: Terminal,
  powershell: Terminal,
};

// Preserve link state while snapshots or unrelated messages update the transcript.
const markdownComponents: Components = {
  a: ({ href, children }) => <DesktopLink href={href}>{children}</DesktopLink>,
  img: ({ src, alt }) => typeof src === "string" ? <MarkdownImage src={src} alt={alt ?? ""} /> : null,
  pre: ({ children }) => {
    const code = Children.toArray(children).find((child) =>
      isValidElement(child),
    );
    if (!isValidElement<{ children?: ReactNode; className?: string }>(code))
      return <pre>{children}</pre>;
    return (
      <CodeBlock
        text={String(code.props.children ?? "").replace(/\n$/, "")}
        language={code.props.className?.replace(/^language-/, "")}
      >
        {children}
      </CodeBlock>
    );
  },
};

export function Markdown({ text }: { text: string }) {
  useLocale();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url, key) =>
        key === "href"
          ? (desktopExternalLink(url) ??
            (desktopFileTarget(url) ? url : defaultUrlTransform(url)))
          : defaultUrlTransform(url)
      }
      components={markdownComponents}
    >
      {text.replace(/\x1b\[[0-9;]*m/g, "")}
    </ReactMarkdown>
  );
}
function ThinkingBlock({
  text,
  expanded,
  streaming,
  label,
  presentation,
  onVisibility,
}: {
  text: string;
  expanded: boolean;
  streaming: boolean;
  label: DesktopMarkdownText;
  presentation?: TranscriptMarkdown;
  onVisibility: (visible: boolean) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(
    presentation?.visible ?? (streaming && expanded),
  );
  useEffect(
    () => setOpen(presentation?.visible ?? (streaming && expanded)),
    [expanded, streaming, presentation?.visible],
  );
  return (
    <details
      className="thinking-block desktop-markdown"
      open={open}
      onToggle={(event) => {
        const visible = event.currentTarget.open;
        setOpen(visible);
        if (presentation && visible !== presentation.visible)
          onVisibility(visible);
      }}
    >
      <summary>
        <Brain size={14} />
        {open ? t("思考过程") : <StyledText {...label} />}
        <ChevronDown size={14} />
      </summary>
      <div className="transcript-markdown-body">
        <span className="transcript-content-width" aria-hidden="true" />
        {presentation ? (
          <ComponentMarkdown blocks={presentation.blocks} />
        ) : (
          <Markdown text={text} />
        )}
      </div>
    </details>
  );
}

function ToolOutput({
  content,
  showImages,
  imageWidth,
}: {
  content: ContentBlock[];
  showImages: boolean;
  imageWidth: number;
}) {
  useLocale();
  return content.map((block, index) =>
    block.type === "image" ? (
      showImages && block.data && block.mimeType ? (
        <img
          key={index}
          className="tool-output-image"
          alt={block.imageFallback ?? t("工具输出")}
          src={`data:${block.mimeType};base64,${block.data}`}
          style={{ maxWidth: `min(100%, ${imageWidth}px)` }}
        />
      ) : (
        <pre key={index} className="tool-image-fallback">
          {block.imageFallback ?? "[image]"}
        </pre>
      )
    ) : (
      <pre key={index}>{block.text}</pre>
    ),
  );
}

function ToolExecution({
  sessionId,
  call,
  result,
  active,
  expanded,
  surfaces,
  run,
  showImages,
  imageWidth,
}: {
  sessionId: string;
  call: ContentBlock;
  result?: ChatMessage;
  active?: DesktopSnapshot["activeTools"][number];
  expanded: boolean;
  surfaces: DesktopSurface[];
  run: Run;
  showImages: boolean;
  imageWidth: number;
}) {
  useLocale();
  const callSurface = surfaces.find(
    (surface) =>
      surface.target?.toolCallId === call.id &&
      surface.target?.phase === "call",
  );
  const resultSurface = surfaces.find(
    (surface) =>
      surface.target?.toolCallId === call.id &&
      surface.target?.phase === "result",
  );
  const presentation =
    call.toolPresentation ??
    result?.toolPresentation ??
    active?.toolPresentation;
  const self =
    (presentation?.shell ??
      call.toolRenderShell ??
      result?.toolRenderShell ??
      active?.toolRenderShell) === "self";
  const state =
    presentation?.state ??
    (active || !result ? "pending" : result.isError ? "error" : "success");
  const output = result?.content ?? active?.output ?? [];
  const toolExpanded = presentation?.expanded ?? expanded;
  const interactive = [callSurface, resultSurface].some(
    (surface) => surface && interactiveNode(surface.view),
  );
  const detailsVisible =
    self || interactive || toolExpanded;
  const ToolIcon = toolIcons[call.name as keyof typeof toolIcons] ?? Wrench;
  if (call.desktopSurfaceId && !callSurface) return null;
  return (
    <div
      className={`${self ? "tool-self" : "tool-result"} tool-execution${state === "pending" ? " tool-running" : ""}${state === "error" ? " tool-error" : ""}${presentation?.shell === "generic" ? " tool-generic" : ""}`}
      data-tool-call-id={call.id}
      data-tool-state={state}
      data-tool-expanded={presentation?.expanded ?? expanded}
      data-tool-details-visible={detailsVisible}
      data-tool-interactive={interactive}
    >
      {!self && (
        <div className="tool-desktop-controls">
          <button
            aria-label={t("{value1} {value2} 输出", {
              value1: toolExpanded ? t("收起") : t("展开"),
              value2: call.name ?? t("工具"),
            })}
            aria-expanded={toolExpanded}
            onClick={() =>
              void run("transcript.tool", {
                sessionId,
                toolCallId: call.id,
                expanded: !toolExpanded,
              })
            }
          >
            <ToolIcon size={13} />
            <span className="tool-step-summary" title={toolStep(call)}>
              {toolStep(call)}
            </span>
            <ChevronDown
              size={13}
              className={`tool-chevron${toolExpanded ? " is-expanded" : ""}`}
            />
          </button>
          <span className={`tool-state-label ${state}`}>
            {state === "pending" ? (
              <LoaderCircle className="spin" size={12} />
            ) : null}
            {state === "pending"
              ? t("执行中")
              : state === "error"
                ? t("失败")
                : t("完成")}
          </span>
        </div>
      )}
      <div className="tool-body tool-content" hidden={!detailsVisible}>
        {callSurface ? (
          <DesktopSurfaceView surface={callSurface} run={run} />
        ) : !self && call.arguments !== undefined ? (
          <details className="tool-arguments" open={expanded || !!active}>
            <summary>
              <Wrench size={14} />
              <span>{call.name}</span>
              <ChevronDown size={13} />
            </summary>
            <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
          </details>
        ) : null}
        {resultSurface ? (
          <DesktopSurfaceView surface={resultSurface} run={run} />
        ) : (
          <ToolOutput
            content={
              showImages
                ? output.filter((block) => block.type !== "image")
                : output
            }
            showImages={false}
            imageWidth={imageWidth}
          />
        )}
      </div>
      {detailsVisible &&
        showImages &&
        output.some((block) => block.type === "image") && (
          <div className="tool-images">
            <ToolOutput
              content={output.filter((block) => block.type === "image")}
              showImages
              imageWidth={imageWidth}
            />
          </div>
        )}
    </div>
  );
}

function Message({
  message,
  embedded = false,
  part,
  streaming,
  onFork,
  showThinking,
  expanded,
  hiddenThinkingLabel,
  hiddenThinkingPresentation,
  surfaces,
  run,
  showImages,
  imageWidth,
}: {
  message: ChatMessage;
  embedded?: boolean;
  part?: "thinking" | "content";
  streaming: boolean;
  onFork: (id: string) => void;
  showThinking: boolean;
  expanded: boolean;
  hiddenThinkingLabel?: string;
  hiddenThinkingPresentation?: DesktopMarkdownText;
  surfaces: DesktopSurface[];
  run: Run;
  showImages: boolean;
  imageWidth: number;
}) {
  useLocale();
  const [copied, setCopied] = useState(false);
  const isTool = message.role === "toolResult";
  const custom = surfaces.find(
    (surface) => surface.id === message.desktopSurfaceId,
  );
  if (message.role === "customEntry")
    return custom ? <DesktopSurfaceView surface={custom} run={run} /> : null;
  if (isTool) {
    return null;
  }
  const plain = message.content.map((b) => b.text ?? "").join("\n");
  if (custom) return <DesktopSurfaceView surface={custom} run={run} />;
  const hasBody =
    message.role !== "assistant" ||
    message.completionNotice ||
    message.content.some(
      (block) =>
        block.type === "image" ||
        (block.type !== "toolCall" &&
          !!(block.text?.trim() || block.thinking?.trim())),
    );
  const body = (
    <>
      {message.content.map((block, index) => {
        if (part === "thinking" && block.type !== "thinking") return null;
        if (part === "content" && block.type === "thinking") return null;
        const presentation = message.markdown?.find((item) =>
          item.blockIndices.includes(index),
        );
        if (presentation && presentation.blockIndices[0] !== index) return null;
        if (
          block.type === "thinking" &&
          presentation &&
          !presentation.source.trim()
        )
          return null;
        return block.type === "thinking" ? (
          <ThinkingBlock
            key={index}
            expanded={showThinking}
            streaming={streaming}
            label={
              hiddenThinkingPresentation ?? {
                text: hiddenThinkingLabel ?? t("思考过程"),
              }
            }
            text={block.thinking ?? ""}
            presentation={presentation}
            onVisibility={(visible) =>
              void run("transcript.thinking", {
                messageId: message.id,
                blockIndex: index,
                visible,
              })
            }
          />
        ) : block.type === "toolCall" ? null : block.type === "image" ? (
          <ImagePreview
            key={index}
            className="message-image"
            alt={t("消息附件")}
            src={`data:${block.mimeType};base64,${block.data}`}
          />
        ) : (
          <div
            className={`markdown transcript-markdown-body${presentation ? " desktop-markdown" : ""}`}
            key={index}
          >
            <span className="transcript-content-width" aria-hidden="true" />
            {presentation ? (
              <ComponentMarkdown blocks={presentation.blocks} />
            ) : (
              <Markdown text={block.text ?? ""} />
            )}
          </div>
        );
      })}
      {part !== "thinking" &&
        (message.role === "assistant"
          ? message.completionNotice
          : message.errorMessage) && (
          <div className="inline-error" role="alert">
            {message.role === "assistant" ? (
              <StyledText {...message.completionNotice!} />
            ) : (
              message.errorMessage
            )}
          </div>
        )}
    </>
  );
  if (embedded) return hasBody ? body : null;
  const timestamp = (
    <time
      className="message-timestamp"
      dateTime={new Date(message.timestamp).toISOString()}
      aria-label={t("消息时间")}
    >
      {new Date(message.timestamp).toLocaleString(getLocale(), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })}
    </time>
  );
  return (
    <>
      {hasBody && (
        <article
          className={`message message-${message.role}`}
          data-message-id={message.id}
          aria-label={
            message.role === "user"
              ? t("用户消息")
              : message.role === "assistant"
                ? t("Pi 回复")
                : t("会话记录")
          }
        >
          <div className="message-avatar">
            {message.role === "user" ? (
              <UserRound size={16} />
            ) : message.role === "assistant" ? (
              <PiLogo size={16} />
            ) : (
              <FileCode2 size={16} />
            )}
          </div>
          {message.role === "assistant" && (
            <div className="message-heading flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
              <GenerationStatus message={message} />
            </div>
          )}
          <div className="message-body">{body}</div>
          <div className="message-meta">
            {timestamp}
            <div className="message-actions">
              <IconButton
                icon={copied ? Check : Copy}
                label={t("复制消息")}
                onClick={() => {
                  void navigator.clipboard.writeText(plain).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              />
              {message.role === "user" && message.entryId && (
                <IconButton
                  icon={GitBranch}
                  label={t("从此处分支")}
                  onClick={() => onFork(message.entryId!)}
                />
              )}
            </div>
          </div>
        </article>
      )}
    </>
  );
}
function AssistantReply({
  group,
  renderRow,
  running,
}: {
  group: ReplyGroup;
  renderRow: (
    row: TranscriptRow,
    embedded?: boolean,
    part?: "thinking" | "content",
  ) => ReactNode;
  running: boolean;
}) {
  useLocale();
  const [copied, setCopied] = useState(false);
  const summary = replySummary(group.rows);
  const text = group.rows
    .flatMap((row) =>
      row.kind === "message"
        ? row.message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
        : [],
    )
    .join("\n\n");
  const segments: {
    id: string;
    process: boolean;
    rows: { row: ReplyRow; part?: "thinking" | "content" }[];
  }[] = [];
  const addSegment = (
    row: ReplyRow,
    process: boolean,
    part?: "thinking" | "content",
  ) => {
    const previous = segments.at(-1);
    const id = `${row.kind === "message" ? row.message.id : `tool:${row.call.id}`}:${part ?? "all"}`;
    if (process && previous?.process) previous.rows.push({ row, part });
    else segments.push({ id, process, rows: [{ row, part }] });
  };
  for (const row of group.rows) {
    if (
      row.kind === "message" &&
      !isProcessRow(row) &&
      row.message.content.some((block) => block.type === "thinking")
    ) {
      addSegment(row, true, "thinking");
      addSegment(row, false, "content");
    } else addSegment(row, isProcessRow(row));
  }
  return (
    <article
      className="message message-assistant assistant-reply"
      data-message-id={group.id}
      aria-label={t("Pi 回复")}
    >
      {summary && (
        <div className="message-heading flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
          <GenerationStatus message={summary} />
        </div>
      )}
      <div className="message-body">
        {segments.map((segment) => {
          const tools = segment.rows.flatMap(({ row }) =>
            row.kind === "tool" ? [row] : [],
          );
          const contents = segment.rows.map(({ row, part }) => (
            <Fragment
              key={
                row.kind === "message" ? row.message.id : `tool:${row.call.id}`
              }
            >
              {renderRow(row, true, part)}
            </Fragment>
          ));
          return segment.process && tools.length > 0 ? (
            <ProcessSteps
              key={segment.id}
              count={tools.length}
              running={running}
            >
              {contents}
            </ProcessSteps>
          ) : (
            <Fragment key={segment.id}>{contents}</Fragment>
          );
        })}
      </div>
      {summary && !running && text.trim() && (
        <div className="message-meta">
          <time
            className="message-timestamp"
            dateTime={new Date(summary.timestamp).toISOString()}
            aria-label={t("消息时间")}
          >
            {new Date(summary.timestamp).toLocaleString(getLocale(), {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })}
          </time>
          <div className="message-actions">
            <IconButton
              icon={copied ? Check : Copy}
              label={t("复制消息")}
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            />
          </div>
        </div>
      )}
    </article>
  );
}

function ProcessSteps({
  count,
  running,
  children,
}: {
  count: number;
  running: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(running);
  useEffect(() => {
    if (!running) setOpen(false);
  }, [running]);
  return (
    <details
      className="process-group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {running ? (
          <LoaderCircle size={13} className="spin" />
        ) : (
          <Wrench size={13} />
        )}
        <span>{t("执行过程")}</span>
        <span className="process-count">
          {t("{value1} 次工具调用", { value1: count })}
        </span>
        <ChevronDown size={13} />
      </summary>
      <div className="process-steps">{children}</div>
    </details>
  );
}

export function Messages({
  sessionId,
  messages,
  conversationNotices = [],
  streaming,
  busy,
  showThinking,
  expanded,
  onFork,
  activeTools,
  extensionUI,
  surfaces,
  run,
  outputPad = 1,
  showImages = true,
  imageWidth = 480,
}: {
  sessionId: string;
  messages: ChatMessage[];
  conversationNotices?: NonNullable<DesktopSnapshot["conversationNotices"]>;
  streaming?: ChatMessage;
  busy: boolean;
  showThinking: boolean;
  expanded: boolean;
  onFork: (id: string) => void;
  activeTools: DesktopSnapshot["activeTools"];
  extensionUI: DesktopSnapshot["extensionUI"];
  surfaces: DesktopSurface[];
  run: Run;
  outputPad?: number;
  showImages?: boolean;
  imageWidth?: number;
}) {
  useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const toolEntries = {
    calls: new Set(
      messages
        .concat(streaming ?? [])
        .flatMap((message) =>
          message.content.flatMap((block) =>
            block.type === "toolCall" && block.id ? [block.id] : [],
          ),
        ),
    ),
    results: new Map(
      messages.flatMap((message) =>
        message.role === "toolResult" && message.toolCallId
          ? [[message.toolCallId, message] as const]
          : [],
      ),
    ),
    active: new Map(activeTools.map((tool) => [tool.id, tool])),
  };
  const rows: TranscriptRow[] = [];
  const renderedTools = new Set<string>();
  const addNotices = (afterMessageId?: string) => {
    for (const notice of conversationNotices)
      if (notice.afterMessageId === afterMessageId)
        rows.push({ kind: "notice", notice });
  };
  const addTool = (call: ContentBlock, result?: ChatMessage) => {
    if (!call.id || renderedTools.has(call.id)) return;
    renderedTools.add(call.id);
    rows.push({
      kind: "tool",
      call,
      result: result ?? toolEntries.results.get(call.id),
      active: toolEntries.active.get(call.id),
    });
  };
  addNotices();
  for (const message of messages.concat(streaming ?? [])) {
    if (message.role === "toolResult") {
      if (message.toolCallId && !toolEntries.calls.has(message.toolCallId))
        addTool(
          { type: "toolCall", id: message.toolCallId, name: message.toolName },
          message,
        );
      addNotices(message.id);
      continue;
    }
    rows.push({ kind: "message", message });
    for (const call of message.content)
      if (call.type === "toolCall") addTool(call);
    addNotices(message.id);
  }
  for (const tool of activeTools)
    addTool({
      type: "toolCall",
      id: tool.id,
      name: tool.name,
      arguments: tool.arguments,
    });
  const turns: { id: string; rows: typeof rows }[] = [];
  for (const row of rows) {
    if (
      !turns.length ||
      (row.kind === "message" && row.message.role === "user")
    )
      turns.push({
        id: row.kind === "message" ? row.message.id : `intro:${sessionId}`,
        rows: [],
      });
    turns[turns.length - 1].rows.push(row);
  }
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // Editor/completion snapshots also recreate the message arrays. Follow only
    // real content/viewport resizing, so those snapshots cannot move the reader.
    const observer = new ResizeObserver(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  const renderRow = (
    row: TranscriptRow,
    embedded = false,
    part?: "thinking" | "content",
  ): ReactNode =>
    row.kind === "notice" ? (
      <div
        className="conversation-notice"
        data-conversation-notice={row.notice.id}
        role="status"
      >
        <StyledText {...row.notice.presentation} />
      </div>
    ) : row.kind === "tool" ? (
      <ToolExecution
        sessionId={sessionId}
        call={row.call}
        result={row.result}
        active={row.active}
        expanded={expanded}
        surfaces={surfaces}
        run={run}
        showImages={showImages}
        imageWidth={imageWidth}
      />
    ) : (
      <Message
        message={row.message}
        embedded={embedded}
        part={part}
        streaming={row.message.id === streaming?.id}
        showThinking={showThinking}
        expanded={expanded}
        hiddenThinkingLabel={extensionUI.hiddenThinkingLabel}
        hiddenThinkingPresentation={
          extensionUI.textPresentation?.hiddenThinkingLabel
        }
        onFork={onFork}
        surfaces={surfaces}
        run={run}
        showImages={showImages}
        imageWidth={imageWidth}
      />
    );
  return (
    <div
      className="transcript-wrap"
      style={{ "--transcript-output-pad": outputPad } as CSSProperties}
    >
      <div
        className="transcript"
        ref={scroller}
        onScroll={() => {
          const el = scroller.current!;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          setAway(!follow.current);
        }}
      >
        <div className="transcript-inner">
          {turns.map((turn) => (
            <section className="conversation-turn" key={turn.id}>
              {groupTranscriptRows(turn.rows).map((row) =>
                row.kind === "reply" ? (
                  <AssistantReply
                    key={row.id}
                    group={row}
                    renderRow={renderRow}
                    running={busy && turn.id === turns.at(-1)?.id}
                  />
                ) : (
                  <Fragment
                    key={
                      row.kind === "notice"
                        ? row.notice.id
                        : row.kind === "tool"
                          ? `tool:${row.call.id}`
                          : row.message.id
                    }
                  >
                    {renderRow(row)}
                  </Fragment>
                ),
              )}
            </section>
          ))}
          {busy && extensionUI.workingVisible && (
            <div className="run-indicator">
              <WorkingIndicator
                options={extensionUI.workingIndicator}
                presentation={extensionUI.textPresentation?.workingFrames}
              />
              <StyledText
                {...(extensionUI.textPresentation?.statuses.working?.text
                  ? extensionUI.textPresentation.statuses.working
                  : { text: extensionUI.workingMessage || t("Pi 正在处理") })}
              />
            </div>
          )}
        </div>
      </div>
      {away && (
        <div className="scroll-bottom">
          <IconButton
            icon={ArrowDown}
            label={t("回到最新消息")}
            onClick={() => {
              follow.current = true;
              scroller.current?.scrollTo({
                top: scroller.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          />
        </div>
      )}
    </div>
  );
}

function WorkingIndicator({
  options,
  presentation,
}: {
  options?: DesktopSnapshot["extensionUI"]["workingIndicator"];
  presentation?: NonNullable<
    DesktopSnapshot["extensionUI"]["textPresentation"]
  >["workingFrames"];
}) {
  useLocale();
  const [frame, setFrame] = useState(0);
  const frames = options?.frames;
  const frameKey = JSON.stringify(frames);
  useEffect(() => {
    setFrame(0);
    if (!frames || frames.length < 2) return;
    const timer = setInterval(
      () => setFrame((value) => (value + 1) % frames.length),
      Math.max(16, options?.intervalMs || 100),
    );
    return () => clearInterval(timer);
  }, [frameKey, options?.intervalMs]);
  if (!frames) return <LoaderCircle size={14} className="spin" />;
  if (!frames.length) return null;
  const index = frame % frames.length;
  return (
    <span aria-hidden="true">
      <StyledText {...(presentation?.[index] ?? { text: frames[index] })} />
    </span>
  );
}
