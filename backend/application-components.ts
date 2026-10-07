import {
  AssistantMessageComponent,
  UserMessageComponent,
  FooterComponent,
  BashExecutionComponent,
  CompactionSummaryMessageComponent,
  BranchSummaryMessageComponent,
  SkillInvocationMessageComponent,
  parseSkillBlock,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { DesktopSdkContext } from "./sdk-access.ts";
import type { DesktopTui } from "./tui-api.ts";
import { NativeToolRows } from "./native-tool-rows.ts";
import { NativeBashRows } from "./native-bash-rows.ts";
import { ConversationNotices } from "./conversation-notices.ts";
import { ApplicationContent } from "./application-content.ts";
import type {
  FooterProvider,
  NativeStatusIndicator,
  PiComponent,
  loadComponentRuntime,
} from "./component-runtime.ts";

type Runtime = Awaited<ReturnType<typeof loadComponentRuntime>>;
type Message = AgentSession["messages"][number];
type MessageEntry = { id: string; component: PiComponent };
type CachedMessage = {
  signature: string;
  message: Message;
  components: PiComponent[];
  streaming: boolean;
};

/** Native application objects share the workspace lifetime of their TUI. */
export class ApplicationComponents {
  readonly tools: NativeToolRows;
  readonly conversationNotices: ConversationNotices;
  readonly content: ApplicationContent;
  bash: NativeBashRows;
  private notices: {
    after: number;
    anchor?: Message;
    level: "info" | "warning" | "error";
    message: string;
    entries: MessageEntry[];
    coalesce?: false;
  }[] = [];
  private noticeSequence = 0;
  readonly footerData: FooterProvider;
  readonly footer: FooterComponent;
  private messages = new Map<string, CachedMessage>();
  private streaming?: { id: string; entry: CachedMessage };
  private streamingMessage?: Extract<Message, { role: "assistant" }>;
  private status?: NativeStatusIndicator;
  private statusEditor?: PiComponent;
  private embedded = false;
  private idle?: PiComponent;
  private retry?: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    token: number;
  };
  private retryToken = 0;
  private compaction: "manual" | "threshold" | "overflow" = "manual";
  private compacting = false;
  private statusKey?: string;
  private workingMessage?: string;
  private workingOptions?: string;
  private hideThinking?: boolean;
  private hiddenLabel?: string;
  private padding?: number;
  private expanded?: boolean;
  private boundSession?: AgentSession;
  private autoCompact?: boolean;
  private cwd?: string;
  private transformers: ReturnType<
    AgentSession["extensionRunner"]["getMarkdownTransformers"]
  > = [];
  private markdownTheme: ReturnType<Runtime["markdown"]["getMarkdownTheme"]>;
  private mermaidMode?: string;
  private extensionTransformers: ReturnType<
    AgentSession["extensionRunner"]["getMarkdownTransformers"]
  > = [];
  private disposed = false;

  constructor(
    private tui: DesktopTui,
    private context: () => DesktopSdkContext,
    private runtime: Runtime,
  ) {
    const sdk = context();
    this.content = new ApplicationContent(context, runtime, tui);
    this.conversationNotices = new ConversationNotices(
      () => this.context().session,
      runtime,
    );
    this.tools = new NativeToolRows(tui, context);
    this.bash = new NativeBashRows(tui, () => tui.requestRender());
    this.footerData = new runtime.footer.FooterDataProvider(sdk.runtime.cwd);
    this.footerData.onBranchChange(() => tui.requestRender());
    this.footer = new FooterComponent(sdk.session, this.footerData);
    this.markdownTheme = {
      ...runtime.markdown.getMarkdownTheme(),
      codeBlockIndent: sdk.settingsManager.getCodeBlockIndent(),
    };
    this.syncFooter();
  }

  syncFooter() {
    if (this.disposed) return;
    const sdk = this.context();
    if (this.boundSession !== sdk.session) {
      this.boundSession = sdk.session;
      this.footer.setSession(sdk.session);
    }
    if (this.autoCompact !== sdk.session.autoCompactionEnabled) {
      this.autoCompact = sdk.session.autoCompactionEnabled;
      this.footer.setAutoCompactEnabled(this.autoCompact);
    }
    if (this.cwd !== sdk.runtime.cwd) {
      this.cwd = sdk.runtime.cwd;
      this.footerData.setCwd(this.cwd);
    }
    const statuses = sdk.host.extensionStatuses;
    for (const key of this.footerData.getExtensionStatuses().keys())
      if (!statuses.has(key))
        this.footerData.setExtensionStatus(key, undefined);
    for (const [key, text] of statuses)
      this.footerData.setExtensionStatus(key, text);
    this.footerData.setAvailableProviderCount(
      new Set(
        (sdk.session.scopedModels.length
          ? sdk.session.scopedModels.map(({ model }) => model)
          : sdk.session.modelRuntime.getAvailableSnapshot()
        ).map((model) => model.provider),
      ).size,
    );
  }
  async initialize() {
    await this.content.initialize();
  }

  event(event: AgentSessionEvent) {
    if (this.disposed) return;
    this.conversationNotices.event(event);
    if (
      (event.type === "message_start" ||
        event.type === "message_update" ||
        event.type === "message_end") &&
      event.message.role === "assistant"
    )
      this.streamingMessage = event.message;
    if (
      event.type === "auto_retry_start" ||
      event.type === "summarization_retry_scheduled"
    )
      this.retry = { ...event, token: ++this.retryToken };
    if (
      event.type === "auto_retry_end" ||
      event.type === "summarization_retry_finished"
    )
      this.retry = undefined;
    if (event.type === "compaction_start") {
      this.compaction = event.reason;
      this.compacting = true;
    }
    if (event.type === "compaction_end") this.compacting = false;
    if (event.type === "summarization_retry_attempt_start") {
      this.retry = undefined;
      this.compacting = event.source === "compaction";
      if (event.source === "compaction") this.compaction = event.reason;
    }
    if (event.type === "agent_settled") this.retry = undefined;
  }

  syncMessages(
    records: { id: string; message: Message }[],
    live?: { id: string },
    expanded = false,
    hiddenLabel = "Thinking...",
  ) {
    if (this.disposed) return [];
    const sdk = this.context();
    const pad = sdk.settingsManager.getOutputPad();
    const hide = sdk.settingsManager.getHideThinkingBlock();
    const mode = sdk.settingsManager.getMermaidRenderingMode();
    const extensions = sdk.session.extensionRunner.getMarkdownTransformers();
    const indent = sdk.settingsManager.getCodeBlockIndent();
    const markdownChanged =
      this.markdownTheme.codeBlockIndent !== indent ||
      this.mermaidMode !== mode ||
      this.extensionTransformers.length !== extensions.length ||
      extensions.some(
        (value, index) => this.extensionTransformers[index] !== value,
      );
    const nextTransformers = [
      this.runtime.markdown.createMermaidMarkdownTransformer({
        getMode: () => sdk.settingsManager.getMermaidRenderingMode(),
        theme: sdk.session.extensionRunner.getUIContext().theme,
      }),
      ...extensions,
    ];
    // Preserve the array used by original Markdown transform closures.
    this.transformers.splice(0, this.transformers.length, ...nextTransformers);
    this.markdownTheme.codeBlockIndent = indent;
    this.mermaidMode = mode;
    this.extensionTransformers = extensions.slice();
    if (markdownChanged) this.invalidate();
    const current = records.slice();
    if (live && this.streamingMessage)
      current.push({ id: live.id, message: this.streamingMessage });
    const entries: MessageEntry[] = [];
    const ids = new Set<string>();
    for (const { id, message } of current) {
      if (["system", "toolResult", "custom"].includes(message.role)) continue;
      ids.add(id);
      const isStreaming = id === live?.id;
      let entry = this.messages.get(id);
      if (
        !entry &&
        !isStreaming &&
        message.role === "assistant" &&
        this.streaming?.entry.message.timestamp === message.timestamp
      ) {
        entry = this.streaming.entry;
        this.messages.delete(this.streaming.id);
        this.messages.set(id, entry);
        this.streaming = undefined;
      }
      const signature = JSON.stringify(message);
      if (
        !entry ||
        entry.message.role !== message.role ||
        (entry.signature !== signature &&
          !(entry.components[0] instanceof AssistantMessageComponent))
      ) {
        entry = {
          signature,
          message,
          components: this.createMessage(message, expanded, hiddenLabel),
          streaming: isStreaming,
        };
        if (
          isStreaming &&
          message.role === "assistant" &&
          entry.components[0] instanceof AssistantMessageComponent
        )
          entry.components[0].updateContent(message, true);
        this.messages.set(id, entry);
      } else if (
        entry.components[0] instanceof AssistantMessageComponent &&
        (entry.signature !== signature || entry.streaming !== isStreaming)
      ) {
        if (message.role === "assistant")
          entry.components[0].updateContent(message, isStreaming);
        entry.signature = signature;
        entry.message = message;
        entry.streaming = isStreaming;
      }
      if (isStreaming) this.streaming = { id, entry };
      for (const [index, component] of entry.components.entries()) {
        if (component instanceof AssistantMessageComponent) {
          if (this.hideThinking !== hide) component.setHideThinkingBlock(hide);
          if (this.hiddenLabel !== hiddenLabel)
            component.setHiddenThinkingLabel(hiddenLabel);
        }
        if (
          this.padding !== pad &&
          (component instanceof AssistantMessageComponent ||
            component instanceof UserMessageComponent)
        )
          component.setOutputPad(pad);
        if (
          this.expanded !== expanded &&
          "setExpanded" in component &&
          typeof component.setExpanded === "function"
        )
          component.setExpanded(expanded);
        entries.push({ id: `${id}:${index}`, component });
      }
    }
    for (const id of this.messages.keys())
      if (!ids.has(id)) this.messages.delete(id);
    this.hideThinking = hide;
    this.hiddenLabel = hiddenLabel;
    this.padding = pad;
    if (this.expanded !== expanded) this.bash.setExpanded(expanded);
    this.expanded = expanded;
    return entries;
  }

  private createMessage(
    message: Message,
    expanded: boolean,
    hiddenLabel: string,
  ): PiComponent[] {
    const sdk = this.context(),
      settings = sdk.settingsManager;
    switch (message.role) {
      case "user": {
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
        if (!text) return [];
        const skill = parseSkillBlock(text);
        if (!skill)
          return [
            new UserMessageComponent(
              text,
              this.markdownTheme,
              settings.getOutputPad(),
              this.transformers,
            ),
          ];
        const component = new SkillInvocationMessageComponent(
          skill,
          this.markdownTheme,
        );
        component.setExpanded(expanded);
        return [
          component,
          ...(skill.userMessage
            ? [
                new UserMessageComponent(
                  skill.userMessage,
                  this.markdownTheme,
                  settings.getOutputPad(),
                  this.transformers,
                ),
              ]
            : []),
        ];
      }
      case "assistant":
        return [
          new AssistantMessageComponent(
            message,
            settings.getHideThinkingBlock(),
            this.markdownTheme,
            hiddenLabel,
            settings.getOutputPad(),
            this.transformers,
          ),
        ];
      case "compactionSummary": {
        const component = new CompactionSummaryMessageComponent(
          message,
          this.markdownTheme,
        );
        component.setExpanded(expanded);
        return [component];
      }
      case "branchSummary": {
        const component = new BranchSummaryMessageComponent(
          message,
          this.markdownTheme,
        );
        component.setExpanded(expanded);
        return [component];
      }
      case "bashExecution": {
        const live = this.bash.adopt(message);
        if (live) return [live];
        const component = new BashExecutionComponent(
          message.command,
          this.tui,
          message.excludeFromContext,
        );
        if (message.output) component.appendOutput(message.output);
        component.setComplete(
          message.exitCode,
          message.cancelled,
          message.truncated
            ? ({ truncated: true } as Parameters<
                BashExecutionComponent["setComplete"]
              >[2])
            : undefined,
          message.fullOutputPath,
        );
        component.setExpanded(expanded);
        return [component];
      }
      default:
        return [];
    }
  }

  syncStatus(
    editor: PiComponent | undefined,
    options: {
      visible: boolean;
      message?: string;
      indicator?: { frames?: string[]; intervalMs?: number };
    },
  ) {
    if (this.disposed) return [];
    const session = this.context().session;
    const kind = session.isIdle
      ? undefined
      : this.retry
        ? "retry"
        : session.isCompacting
          ? // Pi's public isCompacting includes tree navigation. Compaction
            // announces start/end; navigation's first attempt has no start event.
            this.compacting
            ? "compaction"
            : "branchSummary"
          : options.visible
            ? "working"
            : undefined;
    const key =
      kind === "retry"
        ? `${kind}:${this.retry!.token}`
        : kind === "compaction"
          ? `${kind}:${this.compaction}`
          : kind;
    if (key !== this.statusKey) {
      const cleared = this.status,
        embedded = this.embedded;
      this.detachEditor();
      cleared?.dispose();
      this.status = undefined;
      this.idle =
        cleared && !embedded && this.tui.getClearOnShrink()
          ? new this.runtime.status.IdleStatus()
          : undefined;
      this.statusKey = key;
      this.workingMessage = undefined;
      this.workingOptions = undefined;
      const api = this.runtime.status;
      if (kind === "working")
        this.status = new api.WorkingStatusIndicator(
          this.tui,
          options.message ?? "Working...",
          options.indicator,
        );
      if (kind === "retry")
        this.status = new api.RetryStatusIndicator(
          this.tui,
          this.retry!.attempt,
          this.retry!.maxAttempts,
          this.retry!.delayMs,
        );
      if (kind === "compaction")
        this.status = new api.CompactionStatusIndicator(
          this.tui,
          this.compaction,
        );
      if (kind === "branchSummary")
        this.status = new api.BranchSummaryStatusIndicator(this.tui);
      if (this.status) this.idle = undefined;
    }
    if (this.status?.kind === "working") {
      const message = options.message ?? "Working...",
        indicator = JSON.stringify(options.indicator);
      if (message !== this.workingMessage) {
        this.status.setMessage(message);
        this.workingMessage = message;
      }
      if (indicator !== this.workingOptions) {
        this.status.setIndicator(options.indicator);
        this.workingOptions = indicator;
      }
    }
    if (editor !== this.statusEditor) this.detachEditor();
    const setter = editor && Reflect.get(editor, "setWorkingStatusIndicator");
    const embeds =
      !!editor &&
      Reflect.get(editor, "embedWorkingStatus") === true &&
      typeof setter === "function";
    if (embeds && !this.embedded) {
      Reflect.apply(setter, editor, [this.status]);
      this.statusEditor = editor;
      this.embedded = true;
    }
    if (session.isIdle) this.compacting = false;
    return this.status && !this.embedded
      ? [{ id: "active", component: this.status }]
      : this.idle
        ? [{ id: "idle", component: this.idle }]
        : [];
  }

  private detachEditor() {
    if (this.statusEditor) {
      const setter = Reflect.get(
        this.statusEditor,
        "setWorkingStatusIndicator",
      );
      if (typeof setter === "function")
        Reflect.apply(setter, this.statusEditor, [undefined]);
    }
    this.statusEditor = undefined;
    this.embedded = false;
  }

  invalidate() {
    if (this.disposed) return;
    for (const entry of this.messages.values())
      for (const component of entry.components) component.invalidate();
    this.footer.invalidate();
    this.tools.invalidate();
    this.bash.invalidate();
    this.conversationNotices.invalidate();
    this.content.invalidate();
    for (const notice of this.notices)
      for (const entry of notice.entries) entry.component.invalidate();
  }

  /** Session content retires independently of the interactive footer and TUI. */
  resetSession() {
    if (this.disposed) return;
    this.detachEditor();
    this.status?.dispose();
    this.status = undefined;
    this.statusKey = undefined;
    this.idle = undefined;
    this.retry = undefined;
    this.compacting = false;
    this.compaction = "manual";
    this.workingMessage = undefined;
    this.workingOptions = undefined;
    this.messages.clear();
    this.streaming = undefined;
    this.streamingMessage = undefined;
    this.notices = [];
    this.conversationNotices.reset();
    this.content.resetSession();
    this.tools.dispose();
    // In-flight observers retain the retired owner; late chunks must never
    // enter the new session's rows even though the TUI itself stays alive.
    this.bash.dispose();
    this.bash = new NativeBashRows(this.tui, () => this.tui.requestRender());
    for (const key of this.footerData.getExtensionStatuses().keys())
      this.footerData.setExtensionStatus(key, undefined);
    this.footer.invalidate();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const cleanup of [
      () => this.detachEditor(),
      () => this.status?.dispose(),
      () => this.footer.dispose(),
      () => this.footerData.dispose(),
      () => this.tools.dispose(),
      () => this.bash.dispose(),
      () => this.conversationNotices.dispose(),
      () => this.content.dispose(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    this.status = undefined;
    this.messages.clear();
    this.streaming = undefined;
    this.streamingMessage = undefined;
    if (errors.length) throw errors[0];
  }

  notice(message: string, level: "info" | "warning" | "error") {
    if (this.disposed) return;
    const messages = this.context().session.messages;
    const previous = this.notices.at(-1);
    if (
      level === "info" &&
      previous?.level === "info" &&
      previous.coalesce !== false &&
      previous.after === messages.length &&
      previous.anchor === messages.at(-1)
    ) {
      previous.message = message;
      previous.entries.at(-1)!.component.invalidate();
      return;
    }
    const id = `native-notice:${++this.noticeSequence}`;
    const pad =
      level === "error" ? this.context().settingsManager.getOutputPad() : 1;
    const notice = {
      after: messages.length,
      anchor: messages.at(-1),
      message,
      level,
      entries: [] as MessageEntry[],
    };
    notice.entries.push(
      { id: `${id}:spacer`, component: new this.runtime.notice.Spacer(1) },
      {
        id,
        component: new this.runtime.notice.ThemedText(
          () => {
            const theme =
              this.context().session.extensionRunner.getUIContext().theme;
            return theme.fg(
              level === "info" ? "dim" : level,
              level === "error"
                ? `Error: ${notice.message}`
                : level === "warning"
                  ? `Warning: ${notice.message}`
                  : notice.message,
            );
          },
          pad,
          0,
        ),
      },
    );
    this.notices.push(notice);
  }
  managedToolStatus(
    status: { type: "info" | "warning"; message: string },
    beforeMessages = false,
  ) {
    if (this.disposed) return;
    const messages = this.context().session.messages;
    const id = `native-managed-tool:${++this.noticeSequence}`;
    this.notices.push({
      after: beforeMessages ? 0 : messages.length,
      anchor: beforeMessages ? undefined : messages.at(-1),
      level: status.type === "warning" ? "warning" : "info",
      message: status.message,
      coalesce: false,
      entries: this.content
        .managedStatus(status)
        .map((component, index) => ({ id: `${id}:${index}`, component })),
    });
  }
  appendNoticeComponents(components: PiComponent[], beforeMessages = false) {
    if (this.disposed || !components.length) return [];
    const messages = this.context().session.messages,
      id = `native-startup:${++this.noticeSequence}`;
    const entries = components.map((component, index) => ({
      id: `${id}:${index}`,
      component,
    }));
    this.notices.push({
      after: beforeMessages ? 0 : messages.length,
      anchor: beforeMessages ? undefined : messages.at(-1),
      level: "info",
      message: "",
      coalesce: false,
      entries,
    });
    return entries;
  }
  noticeEntries(after: number, anchor?: Message) {
    return this.notices
      .filter(
        (notice) =>
          notice.after === after &&
          (!notice.anchor ||
            JSON.stringify(notice.anchor) === JSON.stringify(anchor)),
      )
      .flatMap((notice) => notice.entries);
  }
}
