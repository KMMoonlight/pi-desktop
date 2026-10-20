import { t, useLocale, getLocale } from "./i18n";
import {
  Children,
  Fragment,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { GenerationStatus, ReplyGenerationStatus } from "./GenerationStatus";
import {
  groupTranscriptRows,
  currentReplyActivity,
  currentReplyTurn,
  replyHasLiveWork,
  replySummary,
  isProcessRow,
  type TranscriptRow,
  type ReplyRow,
  type ReplyGroup,
  type ReplyClock,
  type TranscriptTurn,
} from "./transcript-turns";
import { TranscriptNavigation } from "./TranscriptNavigation";
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
import { formatDuration } from "./format-duration";
import { CodeBlock } from "./CodeBlock";
import { EditReview } from "./EditReview";
import {
  sameTranscriptValue,
  transcriptSurfaces,
  transcriptExtensionUI,
} from "./transcript-equality";
import { PiLogo } from "./PiLogo";
import { PiLoading } from "./PiLoading";
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
  hidden,
  compact = false,
}: {
  text: string;
  expanded: boolean;
  streaming: boolean;
  label: DesktopMarkdownText;
  presentation?: TranscriptMarkdown;
  onVisibility: (visible: boolean) => void;
  hidden?: boolean;
  compact?: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState(
    !compact && (presentation?.visible ?? (streaming && expanded)),
  );
  const wasCompact = useRef(compact);
  useLayoutEffect(() => {
    // Live activity starts as one summary line. SDK visibility and subsequent
    // stream chunks must not override the reader's explicit expand/collapse.
    if (!compact) setOpen(presentation?.visible ?? (streaming && expanded));
    else if (!wasCompact.current) setOpen(false);
    wasCompact.current = compact;
  }, [compact, expanded, streaming, presentation?.visible]);
  return (
    <details
      className="thinking-block desktop-markdown"
      hidden={hidden}
      open={open}
    >
      <summary onClick={(event) => {
        event.preventDefault();
        const visible = !open;
        setOpen(visible);
        if (presentation && visible !== presentation.visible)
          onVisibility(visible);
      }}>
        <Brain size={14} />
        <span className="thinking-label">{open ? t("思考过程") : <StyledText {...label} />}</span>
        <ChevronDown size={14} />
      </summary>
      {open && <div className="transcript-markdown-body">
        <span className="transcript-content-width" aria-hidden="true" />
        {presentation ? (
          <ComponentMarkdown blocks={presentation.blocks} />
        ) : (
          <Markdown text={text} />
        )}
      </div>}
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

function ToolExecutionView({
  sessionId,
  call,
  result,
  active,
  expanded,
  surfaces,
  run,
  showImages,
  imageWidth,
  activity,
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
  activity?: ReplyActivityVisibility;
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
  const duration = formatDuration(presentation?.durationMs);
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
  if (presentation?.review === "edit")
    return (
      <EditReview
        call={call}
        result={result}
        surface={callSurface}
        state={state}
        expanded={toolExpanded}
        hidden={activity?.hidden}
      />
    );
  return (
    <div
      className={`${self ? "tool-self" : "tool-result"} tool-execution${state === "pending" ? " tool-running" : ""}${state === "error" ? " tool-error" : ""}${presentation?.shell === "generic" ? " tool-generic" : ""}`}
      data-tool-call-id={call.id}
      data-tool-state={state}
      data-tool-expanded={presentation?.expanded ?? expanded}
      data-tool-details-visible={detailsVisible}
      data-tool-interactive={interactive}
      hidden={activity?.hidden}
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
          {duration !== undefined && (
            <span className="tool-duration">{duration}</span>
          )}
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
        {(detailsVisible || !presentation?.builtin) && <>
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
        </>}
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

const ToolExecution = memo(ToolExecutionView, (previous, next) => {
  const { surfaces: oldSurfaces, ...oldProps } = previous;
  const { surfaces: newSurfaces, ...newProps } = next;
  return sameTranscriptValue(oldProps, newProps) &&
    sameTranscriptValue(
      oldSurfaces.filter(surface => surface.target?.toolCallId === previous.call.id),
      newSurfaces.filter(surface => surface.target?.toolCallId === next.call.id),
    );
});

function MessageView({
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
  activity,
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
  activity?: ReplyActivityVisibility;
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
            hidden={activity && (activity.hidden || index !== activity.thinkingBlockIndex)}
            compact={activity !== undefined}
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
          className={`message message-${message.role}${message.preparing ? " message-preparing" : ""}`}
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
            {message.preparing && <span role="status">{t("正在准备发送…")}</span>}
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
const Message = memo(MessageView, (previous, next) => {
  const { surfaces: oldSurfaces, ...oldProps } = previous;
  const { surfaces: newSurfaces, ...newProps } = next;
  return sameTranscriptValue(oldProps, newProps) &&
    sameTranscriptValue(
      oldSurfaces.find(surface => surface.id === previous.message.desktopSurfaceId),
      newSurfaces.find(surface => surface.id === next.message.desktopSurfaceId),
    );
});

type ReplyActivityVisibility = { hidden: boolean; thinkingBlockIndex?: number };

function AssistantReply({
  group,
  renderRow,
  running,
  interactiveTools,
  clock,
}: {
  group: ReplyGroup;
  renderRow: (
    row: TranscriptRow,
    embedded?: boolean,
    part?: "thinking" | "content",
    activity?: ReplyActivityVisibility,
  ) => ReactNode;
  running: boolean;
  interactiveTools: ReadonlySet<string>;
  clock: ReplyClock;
}) {
  useLocale();
  const [copied, setCopied] = useState(false);
  const summary = replySummary(group.rows);
  const activity = running ? currentReplyActivity(group.rows) : undefined;
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
      {summary && !running && (
        <div className="message-heading flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
          <ReplyGenerationStatus rows={group.rows} running={running} clock={clock} />
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
              {renderRow(row, true, part, running ? {
                hidden: row !== activity?.row,
                thinkingBlockIndex: row === activity?.row ? activity.thinkingBlockIndex : undefined,
              } : undefined)}
            </Fragment>
          ));
          return segment.process && tools.length > 0 ? (
            <ProcessSteps
              key={segment.id}
              count={tools.length}
              running={running}
              hidden={running && !segment.rows.some(({ row }) => row === activity?.row)}
              keepMounted={tools.some(tool => !tool.call.toolPresentation?.builtin || interactiveTools.has(tool.call.id ?? ""))}
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
  keepMounted,
  hidden,
}: {
  count: number;
  running: boolean;
  children: ReactNode;
  keepMounted: boolean;
  hidden: boolean;
}) {
  const [open, setOpen] = useState(running);
  useEffect(() => {
    if (!running) setOpen(false);
  }, [running]);
  return (
    <details
      className="process-group"
      data-running={running}
      hidden={hidden}
      open={running || open}
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
      <div className="process-steps">{(open || keepMounted) && children}</div>
    </details>
  );
}

function MessagesView({
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
  // Retain the last displayed live time when the footer moves into a completed
  // reply header, even if termination produced no final tool-result record.
  const replyClocks = useMemo(() => new Map<string, ReplyClock>(), [sessionId]);
  const replyClock = (group: ReplyGroup) => {
    // History branches can reuse positional message IDs in the same session.
    const first = group.rows.find((row) => row.kind === "message");
    const id = `${group.id}:${first?.message.timestamp ?? ""}`;
    let clock = replyClocks.get(id);
    if (!clock) {
      clock = {};
      replyClocks.set(id, clock);
    }
    return clock;
  };
  const follow = useRef(true);
  const scrollSize = useRef({ height: 0, viewport: 0, top: 0 });
  const [away, setAway] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<string>();
  const [navigation, setNavigation] = useState<{ sessionId: string; turnId: string }>();
  const resumeFollowing = useCallback(() => {
    follow.current = true;
    setAway(false);
    const element = scroller.current;
    if (!element) return;
    // A smooth scroll's intermediate events can disable following before it
    // reaches the bottom, especially when new chunks move the destination.
    element.scrollTop = element.scrollHeight;
    scrollSize.current = {
      height: element.scrollHeight,
      viewport: element.clientHeight,
      top: element.scrollTop,
    };
  }, []);
  const latestUserId = messages
    .filter(message => message.role === "user")
    .at(-1)?.id;
  useLayoutEffect(() => {
    setNavigation(undefined);
    resumeFollowing();
  }, [sessionId, latestUserId, resumeFollowing]);
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
  // Closed passive tool histories need no DOM. Keep interactive extension
  // controls mounted so focus, terminal state and callbacks remain intact.
  const interactiveTools = new Set(surfaces.flatMap(surface =>
    surface.target?.toolCallId && interactiveNode(surface.view)
      ? [surface.target.toolCallId]
      : [],
  ));
  const interactiveSurfaces = new Set(surfaces.filter(surface =>
    interactiveNode(surface.view)).map(surface => surface.id));
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
  const turns: TranscriptTurn[] = [];
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
  const firstTurnId = turns[0]?.id;
  const runningTurn = currentReplyTurn(turns);
  const latestReply = groupTranscriptRows(runningTurn?.rows ?? [])
    .filter(group => group.kind === "reply").at(-1);
  const latestHasLiveWork = latestReply
    ? replyHasLiveWork(latestReply.rows, streaming?.id)
    : false;
  const currentReply = latestReply && (latestHasLiveWork || busy && !replyClock(latestReply).finished)
    ? latestReply
    : undefined;
  useEffect(() => {
    const scroll = (event: Event) => {
      const request = (event as CustomEvent<{ sessionId: string; position: string }>).detail;
      const element = scroller.current;
      if (!element || request?.sessionId !== sessionId) return;
      if (request.position === "bottom") {
        setNavigation(undefined);
        resumeFollowing();
      } else if (request.position === "top") {
        follow.current = false;
        setAway(element.scrollHeight > element.clientHeight);
        setNavigation(firstTurnId ? { sessionId, turnId: firstTurnId } : undefined);
        element.scrollTop = 0;
        scrollSize.current = { height: element.scrollHeight, viewport: element.clientHeight, top: 0 };
      }
    };
    window.addEventListener("pi:transcript-scroll", scroll);
    return () => window.removeEventListener("pi:transcript-scroll", scroll);
  }, [sessionId, firstTurnId, resumeFollowing]);
  useLayoutEffect(() => {
    if (!navigation || navigation.sessionId !== sessionId || !scroller.current) return;
    const element = scroller.current;
    const target = [...element.querySelectorAll<HTMLElement>("[data-turn-id]")]
      .find(turn => turn.dataset.turnId === navigation.turnId);
    if (!target) return;
    element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 24;
    scrollSize.current = { height: element.scrollHeight, viewport: element.clientHeight, top: element.scrollTop };
  }, [navigation, sessionId]);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // Editor/completion snapshots also recreate the message arrays. Follow only
    // real content/viewport resizing, so those snapshots cannot move the reader.
    const observer = new ResizeObserver(() => {
      if (
        follow.current ||
        element.scrollHeight - element.clientHeight - element.scrollTop < 100
      ) {
        resumeFollowing();
        return;
      }
      scrollSize.current = {
        height: element.scrollHeight,
        viewport: element.clientHeight,
        top: element.scrollTop,
      };
    });
    observer.observe(element);
    // Collapsing/replacing process output can clamp scrollTop and restore the
    // same box size within one frame. Positioned output can also grow only the
    // scrollable overflow. Neither guarantees a ResizeObserver notification.
    // Restore the bottom before those layout-generated scroll events arrive.
    const mutations = new MutationObserver(() => {
      if (follow.current) resumeFollowing();
    });
    if (element.firstElementChild) {
      observer.observe(element.firstElementChild);
      mutations.observe(element.firstElementChild, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["open", "style", "class", "src", "hidden"],
      });
    }
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [resumeFollowing]);
  const renderRow = (
    row: TranscriptRow,
    embedded = false,
    part?: "thinking" | "content",
    activity?: ReplyActivityVisibility,
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
        activity={activity}
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
        activity={activity}
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
        data-follow-output={!away}
        onScroll={() => {
          const el = scroller.current!;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          // Reaching the bottom is authoritative even if scrollHeight changed
          // without a ResizeObserver delivery (for example positioned output).
          if (nearBottom) {
            follow.current = true;
            setAway(false);
            scrollSize.current = {
              height: el.scrollHeight,
              viewport: el.clientHeight,
              top: el.scrollTop,
            };
            return;
          }
          // Resizing can emit scroll before ResizeObserver runs. It is not a
          // reader scrolling away, so keep the prior follow state until resize.
          const previous = scrollSize.current;
          const resized = el.scrollHeight !== previous.height ||
            el.clientHeight !== previous.viewport;
          const clamped = previous.top > el.scrollHeight - el.clientHeight &&
            el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
          if (resized && (el.scrollTop >= previous.top || clamped)) {
            // A collapse can move the viewport upward before replacement
            // content grows again. That movement must not cancel following.
            if (follow.current) resumeFollowing();
            return;
          }
          // A reader can scroll up while a fast editor resize is still awaiting
          // its observer. An upward move away from the clamp is user intent.
          previous.height = el.scrollHeight;
          previous.viewport = el.clientHeight;
          previous.top = el.scrollTop;
          follow.current = false;
          setAway(true);
        }}
      >
        <div className="transcript-inner">
          {messages.length > 100 && turns.length > 1 && expandedHistory !== sessionId && (
            <button type="button" onClick={() => setExpandedHistory(sessionId)}>
              {t("显示全部历史消息")}
            </button>
          )}
          {turns.map((turn, index) => (
            <HistoryTurn key={`${sessionId}:${turn.id}`}
              id={turn.id}
              eager={messages.length <= 100 || index >= turns.length - 3 || expandedHistory === sessionId ||
                (navigation?.sessionId === sessionId && navigation.turnId === turn.id) ||
                turn.rows.some(row => row.kind === "tool"
                  ? interactiveTools.has(row.call.id ?? "")
                  : row.kind === "message" && [row.message.desktopSurfaceId,
                    ...row.message.content.map(block => block.desktopSurfaceId)]
                    .some(id => id !== undefined && interactiveSurfaces.has(id)))}
              render={() => {
                const groups = groupTranscriptRows(turn.rows);
                return groups.map((row) =>
                  row.kind === "reply" ? (
                    <AssistantReply
                      key={row.id}
                      group={row}
                      renderRow={renderRow}
                      running={turn.id === runningTurn?.id && row.id === currentReply?.id}
                      interactiveTools={interactiveTools}
                      clock={replyClock(row)}
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
                );
              }}
            />
          ))}
          {(busy || currentReply) && (extensionUI.workingVisible || currentReply) && (
            <div className="run-indicator">
              {extensionUI.workingVisible && <>
                <WorkingIndicator
                  options={extensionUI.workingIndicator}
                  presentation={extensionUI.textPresentation?.workingFrames}
                />
                <StyledText
                  {...(extensionUI.textPresentation?.statuses.working?.text
                    ? extensionUI.textPresentation.statuses.working
                    : { text: extensionUI.workingMessage || t("Pi 正在处理") })}
                />
              </>}
              {currentReply && <ReplyGenerationStatus rows={currentReply.rows} running activeWork={latestHasLiveWork} showTokens={false} clock={replyClock(currentReply)} />}
            </div>
          )}
        </div>
      </div>
      <TranscriptNavigation key={sessionId} turns={turns} scroller={scroller}
        onNavigate={turnId => {
          follow.current = false;
          setAway(true);
          setNavigation({ sessionId, turnId });
        }} />
      {away && (
        <div className="scroll-bottom">
          <IconButton
            icon={ArrowDown}
            label={t("回到最新消息")}
            onClick={resumeFollowing}
          />
        </div>
      )}
    </div>
  );
}

/** Mount passive history when it approaches the scroll viewport. Once visited,
 * retain it so selection, expanded output and extension state are not lost. */
function HistoryTurn({ id, eager, render }: { id: string; eager: boolean; render: () => ReactNode }) {
  const element = useRef<HTMLElement>(null);
  const [visited, setVisited] = useState(eager);
  const visible = eager || visited;
  useEffect(() => {
    if (eager && !visited) { setVisited(true); return; }
    if (visible || !element.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisited(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisited(true);
        observer.disconnect();
      }
    }, { root: element.current.closest(".transcript"), rootMargin: "600px" });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [eager, visible, visited]);
  return <section ref={element} className="conversation-turn"
    data-turn-id={id}
    style={visible ? undefined : { minHeight: 600 }}
    aria-busy={!visible}>
    {visible ? render() : null}
  </section>;
}

export const Messages = memo(MessagesView, (previous, next) => {
  const { surfaces: oldSurfaces, extensionUI: oldUI, ...oldProps } = previous;
  const { surfaces: newSurfaces, extensionUI: newUI, ...newProps } = next;
  return (
    sameTranscriptValue(oldProps, newProps) &&
    sameTranscriptValue(transcriptExtensionUI(oldUI), transcriptExtensionUI(newUI)) &&
    sameTranscriptValue(transcriptSurfaces(oldSurfaces), transcriptSurfaces(newSurfaces))
  );
});

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
  if (!frames) return <PiLoading />;
  if (!frames.length) return null;
  const index = frame % frames.length;
  return (
    <span aria-hidden="true">
      <StyledText {...(presentation?.[index] ?? { text: frames[index] })} />
    </span>
  );
}
