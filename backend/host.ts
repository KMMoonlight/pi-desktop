import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  desktopSessionHistory,
  persistDesktopSession,
  resumeDesktopSession,
  rememberDesktopSession,
  forgetDesktopSession,
} from "./session-history.ts";
import { GlobalSettings, globalSettingsActions } from "./global-settings.ts";
import { listSystemFonts } from "./system-fonts.ts";
import { browseDirectories, createDirectory } from "./folders.ts";
import { GenerationTracker, recordedGeneration } from "./generation-metrics.ts";
import { SessionTitleGenerator } from "./session-title.ts";
import {
  sdkContext,
  type DesktopSdkOperation,
  type DesktopRuntimeFactory,
} from "./sdk-access.ts";
import { runModelOperation } from "./model-operations.ts";
import { dialogInput } from "./dialog-input.ts";
import { createDialogTextCommands } from "./dialog-editor.ts";
import { runExternalEditor } from "./external-editor.ts";
import { DefaultEditorSource } from "./default-editor.ts";
import { clipboardImage, systemClipboard } from "./clipboard.ts";
import {
  parseTerminalEffect,
  type TerminalEffect,
} from "../shared/terminal-effect.ts";
import type { NativeClipboard } from "./tui-api.ts";
import type { DesktopKeybindings } from "./tui-api.ts";
import { DesktopUIRegistry } from "./desktop-ui.ts";
import { registerOfficialDesktopAdapters } from "./official-extensions.ts";
import { registerComponentMappings } from "./component-mapping.ts";
import { loadComponentRuntime } from "./component-runtime.ts";
import { componentText } from "./component-text.ts";
import { watchThemeFile } from "./theme-watcher.ts";
import { bindSessionReload } from "./session-reload.ts";
import { bindSessionPrompt } from "./session-prompt.ts";
import { bindSessionBash } from "./session-bash.ts";
import { bindRuntimeCallbacks } from "./runtime-callbacks.ts";
import {
  RuntimeLifecycle,
  bindRuntimeTransitions,
} from "./runtime-lifecycle.ts";
import { AuthorizationScopes } from "./authorization-scopes.ts";
import { desktopMcpOptions } from "./mcp-options.ts";
import { resolveProjectTrusted } from "./project-trust.ts";
import {
  connectRenderers,
  describeTool,
  type ToolRenderPhase,
} from "./renderers.ts";
import { TranscriptMarkdownRenderer } from "./transcript-markdown.ts";
import { loadTuiApi } from "./tui-api.ts";
import { TerminalQueries } from "./terminal-queries.ts";
import { ManagedTools, type ManagedToolStatus } from "./managed-tools.ts";
import { StartupPolicies, startupPolicyNames } from "./startup-policies.ts";
import type { StartupPolicyName } from "../shared/types.ts";
import {
  DesktopStartup,
  startupOptions,
  type DesktopStartupOptions,
} from "./startup.ts";
import { encodeDesktopKey } from "../shared/keyboard.ts";
import { errorMessage } from "../shared/errors.ts";
import type {
  DesktopKeyEvent,
  DesktopSelection,
  DesktopInputResult,
} from "../shared/desktop-ui.ts";
import {
  createDesktopAutocompleteFactory,
  type DesktopAutocompleteProvider,
} from "./autocomplete.ts";
import {
  AgentSession,
  AgentSessionRuntime,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  SessionManager,
  SettingsManager,
  DefaultPackageManager,
  createCodemodeExtension,
  createToolSearchExtension,
  createMcpExtension,
  getAgentDir,
  getPackageDir,
  VERSION,
  ModelRuntime,
  ProjectTrustStore,
  hasTrustRequiringProjectResources,
  type Theme,
  type ExtensionUIContext,
  type AgentSessionEvent,
  type CreateAgentSessionRuntimeFactory,
  type ProjectTrustContext,
} from "@earendil-works/pi-coding-agent";
import type {
  ActionRequest,
  ChatMessage,
  ContentBlock,
  DesktopEvent,
  DesktopSnapshot,
  DialogRequest,
  RecordValue,
  TreeItem,
} from "../shared/types.ts";
import {
  gitChanges,
  listFiles,
  previewFile,
  resolveFileLink,
} from "./files.ts";

export function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function required(value: unknown, label: string): string {
  const result = text(value).trim();
  if (!result) throw new Error(`${label}不能为空`);
  return result;
}
export function messageView(
  value: unknown,
  id: string,
  entryId?: string,
): ChatMessage {
  const m = record(value);
  const raw =
    typeof m.content === "string"
      ? [{ type: "text", text: m.content }]
      : Array.isArray(m.content)
        ? m.content
        : [];
  const content: ContentBlock[] = raw.map((item) => {
    const b = record(item);
    return {
      type: text(b.type),
      text: typeof b.text === "string" ? b.text : undefined,
      thinking: typeof b.thinking === "string" ? b.thinking : undefined,
      name: typeof b.name === "string" ? b.name : undefined,
      id: typeof b.id === "string" ? b.id : undefined,
      arguments: b.arguments,
      data: typeof b.data === "string" ? b.data : undefined,
      mimeType: typeof b.mimeType === "string" ? b.mimeType : undefined,
    };
  });
  if (m.role === "bashExecution")
    content.push({
      type: "text",
      text: `$ ${text(m.command)}\n${text(m.output)}`,
    });
  if (m.role === "compactionSummary" || m.role === "branchSummary")
    content.push({ type: "text", text: text(m.summary) });
  return {
    id,
    entryId,
    role: text(m.role),
    content,
    timestamp: Number(m.timestamp) || Date.now(),
    toolName: typeof m.toolName === "string" ? m.toolName : undefined,
    toolCallId: typeof m.toolCallId === "string" ? m.toolCallId : undefined,
    isError: m.isError === true,
    errorMessage:
      typeof m.errorMessage === "string" ? m.errorMessage : undefined,
    stopReason: typeof m.stopReason === "string" ? m.stopReason : undefined,
    details: m.details,
    outputTokens: typeof record(m.usage).output === "number" ? record(m.usage).output as number : undefined,
    customType: typeof m.customType === "string" ? m.customType : undefined,
  };
}

export class DesktopHost extends EventEmitter {
  private generation = new GenerationTracker();
  private sessionTitles = new SessionTitleGenerator();
  private readonly backendId = randomUUID();
  private snapshotRevision = 0;
  readonly terminalQueries = new TerminalQueries((event) =>
    this.emitEvent(event),
  );
  runtime?: AgentSessionRuntime;
  readonly agentDir: string;
  private unsubscribe?: () => void;
  private restoreSessionReload?: () => void;
  private restoreSessionPrompt?: () => void;
  private restoreSessionBash?: () => void;
  private refreshTimer?: NodeJS.Timeout;
  private dialogs = new Map<
    string,
    {
      request: DialogRequest;
      sessionBound: boolean;
      resolve: (value: unknown) => void;
      timer?: NodeJS.Timeout;
      commands?: ReturnType<typeof createDialogTextCommands>;
    }
  >();
  private statuses: Record<string, string> = {};
  private dialogEditors = new Map<
    string,
    {
      controller: AbortController;
      pending: Promise<{ text?: string; cancelled?: boolean }>;
    }
  >();
  private widgets: Record<string, string[]> = {};
  private componentTextApi?: Awaited<
    ReturnType<typeof loadComponentRuntime>
  >["text"];
  private streaming?: ChatMessage;
  private transcriptMarkdown?: TranscriptMarkdownRenderer;
  private editorText = "";
  private editorRevision = 0;
  private editorDrafts = new Map<string, string>();
  private boundSessionId?: string;
  private workspaceDraft?: SessionManager;
  private sessionLifetime = new AbortController();
  private readonly authorizations = new AuthorizationScopes(
    (event) => this.emitEvent(event),
    (error) => this.notice(errorMessage(error), "error"),
  );
  private clipboardOverride?: NativeClipboard;
  private externalEditor?: {
    id: string;
    controller: AbortController;
    pending: Promise<{ applied: boolean; cancelled: boolean }>;
  };
  private externalEditorResult?: {
    id: string;
    text: string;
    sessionId: string;
  };
  private editorSelection?: DesktopSelection;
  private expanded = false;
  private toolExpansions = new Map<string, boolean>();
  private turnToolCalls = new Set<string>();
  private authAbort?: AbortController;
  private authId?: string;
  private changing = false;
  private shuttingDown = false;
  private disposal?: Promise<void>;
  private runtimeLifecycle = new RuntimeLifecycle();
  private restoreRuntimeTransitions = new Map<
    AgentSessionRuntime,
    () => void
  >();
  private hostLifetime = new AbortController();
  readonly managedTools: ManagedTools;
  readonly startup = new DesktopStartup(this);
  readonly startupPolicies = new StartupPolicies(this);
  private launchOptions?: DesktopStartupOptions;
  private pendingManagedStatuses: ManagedToolStatus[] = [];
  private restoreRuntimeCallbacks = new WeakMap<
    AgentSessionRuntime,
    () => void
  >();
  private runtimeDisposals = new WeakMap<AgentSessionRuntime, Promise<void>>();
  private inflightPrompts = 0;
  private activeTools: DesktopSnapshot["activeTools"] = [];
  private recentWorkspaces: string[] = [];
  private globalSettings?: GlobalSettings;
  private projectTrustByCwd = new Map<string, boolean>();
  private theme?: Theme;
  private readonly themeProxies = new WeakSet<Theme>();
  private sdkOperations = new Map<string, AbortController>();
  private runtimeFactory?: DesktopRuntimeFactory;
  private workingVisible = true;
  private workingMessage?: string;
  private footerStatuses = new Map<string, string>();
  private hiddenThinkingLabel?: string;
  private workingIndicator?: { frames?: string[]; intervalMs?: number };
  private windowTitle = "Pi Desktop";
  private windowProgressOwners = new Set<object>();
  private readonly terminalWindowOwner = {};
  readonly desktopUI: DesktopUIRegistry = new DesktopUIRegistry(
    () => this.sdk,
    () => this.refreshSoon(),
  );
  private readonly convertOfficialExtensions?: ReturnType<
    typeof registerOfficialDesktopAdapters
  >;
  private editorFactory?: Parameters<
    ExtensionUIContext["setEditorComponent"]
  >[0];
  private headerFactory?: Parameters<ExtensionUIContext["setHeader"]>[0];
  private footerFactory?: Parameters<ExtensionUIContext["setFooter"]>[0];
  private readonly defaultEditorSource = new DefaultEditorSource();
  private editorMount?: Promise<void>;
  private editorMountRevision = 0;
  private widgetPlacements: Record<string, "aboveEditor" | "belowEditor"> = {};
  private autocomplete?: DesktopAutocompleteProvider;
  private autocompleteBase?: () => DesktopAutocompleteProvider;
  private autocompleteWrappers: Parameters<
    ExtensionUIContext["addAutocompleteProvider"]
  >[0][] = [];
  private renderWidth = 120;
  private transcriptLayout?: {
    sessionId: string;
    text: number;
    thinking: number;
    user?: number;
    users?: Record<string, number>;
  };
  private toolResults = new Map<string, unknown>();
  private toolRenderPhases = new Map<string, ToolRenderPhase>();
  private inputListeners = new Set<{
    handler: Parameters<ExtensionUIContext["onTerminalInput"]>[0];
    unsubscribe(): void;
  }>();
  rebindTerminalInputListeners() {
    for (const subscription of this.inputListeners) {
      subscription.unsubscribe();
      subscription.unsubscribe = this.desktopUI.terminalInput
        .capture()
        .add(subscription.handler);
    }
  }
  private clearInputListeners() {
    for (const subscription of this.inputListeners) subscription.unsubscribe();
    this.inputListeners.clear();
  }
  private keybindings: Parameters<
    AgentSession["extensionRunner"]["getShortcuts"]
  >[0] = {};
  private desktopTheme?: DesktopSnapshot["extensionUI"]["theme"];
  private refreshTheme?: () => Theme;
  private invocationTheme?: ReturnType<
    Awaited<ReturnType<typeof loadComponentRuntime>>["theme"]["createSelection"]
  >;
  private desktopAppearance: "light" | "dark" = "light";
  private desktopAppearanceListeners = new Set<
    (scheme: "light" | "dark") => void
  >();
  private dialogKeys?: { source: object; manager: DesktopKeybindings };
  private appearanceChanged?: () => void;
  private stopThemeWatch?: () => void;

  constructor(
    agentDir = getAgentDir(),
    options: {
      runtimeFactory?: DesktopRuntimeFactory;
      clipboard?: NativeClipboard;
      legacyExampleAdapters?: boolean;
      startup?: DesktopStartupOptions;
    } = {},
  ) {
    super();
    this.agentDir = agentDir;
    this.runtimeFactory = options.runtimeFactory;
    this.launchOptions = options.startup;
    this.managedTools = new ManagedTools(this.hostLifetime.signal, (status) => {
      const application = this.desktopUI.terminalRuntime.capture().application;
      if (application) application.managedToolStatus(status);
      else this.pendingManagedStatuses.push(status);
      this.emitEvent({
        type: "activity",
        name: "managed_tool_status",
        data: status,
      });
      if (application) this.publish();
    });
    this.clipboardOverride = options.clipboard;
    if (options.legacyExampleAdapters)
      this.convertOfficialExtensions = registerOfficialDesktopAdapters(
        this.desktopUI,
      );
    this.desktopUI.registerAdapter({
      id: "pi:default-editor",
      matches: (source, slot) =>
        slot === "editor" && source === this.defaultEditorSource,
      create: (context) => this.defaultEditorSource.create(context),
    });
    registerComponentMappings(this.desktopUI);
  }
  get sdk() {
    return sdkContext(this);
  }
  get extensionStatuses() {
    return new Map(this.footerStatuses);
  }
  get autocompleteProvider() {
    return this.autocomplete;
  }
  get sessionSignal() {
    return this.sessionLifetime.signal;
  }
  setClipboard(clipboard?: NativeClipboard) {
    this.clipboardOverride = clipboard;
  }
  async withSdk<T>(
    operation: DesktopSdkOperation<T>,
    args: RecordValue = {},
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.disposal) throw new Error("Pi 已关闭");
    const lifetime = AbortSignal.any([
      this.hostLifetime.signal,
      ...(signal ? [signal] : []),
    ]);
    lifetime.throwIfAborted();
    try {
      return await this.runtimeLifecycle.track(() =>
        operation(sdkContext(this, lifetime), args),
      );
    } finally {
      this.publish();
    }
  }
  private async sdkOperation<T>(
    id: string,
    operation: (signal: AbortSignal) => Promise<T>,
    joinShutdown = true,
  ): Promise<T> {
    if (this.disposal) throw new Error("Pi 已关闭");
    if (this.sdkOperations.has(id))
      throw new Error("SDK operation ID is already in use");
    const controller = new AbortController();
    this.sdkOperations.set(id, controller);
    try {
      const signal = AbortSignal.any([
        controller.signal,
        this.hostLifetime.signal,
      ]);
      signal.throwIfAborted();
      const invoke = () => operation(signal);
      return await (joinShutdown
        ? this.runtimeLifecycle.track(invoke)
        : invoke());
    } finally {
      this.sdkOperations.delete(id);
      this.publish();
    }
  }
  get session(): AgentSession {
    if (!this.runtime) throw new Error("工作区尚未初始化");
    return this.runtime.session;
  }
  emitEvent(event: DesktopEvent) {
    this.emit("event", event);
  }
  onDesktopAppearanceChange(listener: (scheme: "light" | "dark") => void) {
    this.desktopAppearanceListeners.add(listener);
    return () => {
      this.desktopAppearanceListeners.delete(listener);
    };
  }
  private updateDesktopAppearance(scheme: "light" | "dark") {
    if (scheme === this.desktopAppearance) return;
    this.desktopAppearance = scheme;
    this.appearanceChanged?.();
    for (const listener of [...this.desktopAppearanceListeners]) {
      try {
        listener(scheme);
      } catch (error) {
        this.notice(errorMessage(error), "error");
      }
    }
  }
  setWindowTitle(title: string) {
    if (title === this.windowTitle) return;
    this.windowTitle = title;
    this.emitEvent({ type: "activity", name: "title", data: title });
    this.refreshSoon();
  }
  setWindowProgress(owner: object, active: boolean) {
    const previous = this.windowProgressOwners.size > 0;
    if (active) this.windowProgressOwners.add(owner);
    else this.windowProgressOwners.delete(owner);
    const progress = this.windowProgressOwners.size > 0;
    if (previous === progress) return;
    this.emitEvent({ type: "activity", name: "progress", data: progress });
    this.refreshSoon();
  }
  async applyTerminalEffect(
    effect: TerminalEffect,
    owner = this.terminalWindowOwner,
  ) {
    if (this.disposal) throw new Error("Pi 已关闭");
    if (effect.type === "title") this.setWindowTitle(effect.title);
    else if (effect.type === "progress")
      this.setWindowProgress(owner, effect.active);
    else {
      const clipboard = this.clipboardOverride ?? (await systemClipboard());
      if (!clipboard?.setText)
        throw new Error("System clipboard is unavailable");
      await clipboard.setText(effect.text);
    }
  }
  notice(message: string, level: "info" | "warning" | "error" = "info", desktopCopy = false) {
    this.desktopUI.terminalRuntime
      .capture()
      .application?.notice(message, level);
    this.emitEvent({
      type: "notice",
      message,
      level,
      desktopCopy,
      ...(this.componentTextApi
        ? { presentation: componentText(message, this.componentTextApi) }
        : {}),
    });
  }
  get pendingDialogs(): DialogRequest[] {
    return [...this.dialogs.values()].map((d) => d.request);
  }
  async ask(
    request: Omit<DialogRequest, "id">,
    signal?: AbortSignal,
    lifetime = this.sessionLifetime.signal,
  ): Promise<unknown> {
    const operationSignal =
      lifetime === this.sessionLifetime.signal
        ? this.authorizations.signal
        : undefined;
    signal = AbortSignal.any([
      lifetime,
      ...(signal ? [signal] : []),
      ...(operationSignal ? [operationSignal] : []),
    ]);
    if (signal?.aborted) return undefined;
    const id = randomUUID();
    const cancel = () => this.answer(id, undefined);
    return new Promise((resolveValue) => {
      // Pi's dialog countdown rounds positive timeouts up to whole seconds.
      const expiresAt =
        request.timeout !== undefined &&
        request.timeout > 0 &&
        Number.isFinite(request.timeout)
          ? Date.now() + Math.ceil(request.timeout / 1000) * 1000
          : undefined;
      const data: DialogRequest = {
        ...request,
        id,
        ...(this.componentTextApi
          ? {
              presentation: {
                title: componentText(request.title, this.componentTextApi),
                ...(request.message !== undefined
                  ? {
                      message: componentText(
                        request.message,
                        this.componentTextApi,
                      ),
                    }
                  : {}),
                ...(request.placeholder !== undefined
                  ? {
                      placeholder: componentText(
                        request.placeholder,
                        this.componentTextApi,
                      ),
                    }
                  : {}),
                ...(request.options
                  ? {
                      options: request.options.map((option) => ({
                        label: componentText(
                          typeof option === "string" ? option : option.label,
                          this.componentTextApi!,
                        ),
                        ...(typeof option !== "string" &&
                        option.description !== undefined
                          ? {
                              description: componentText(
                                option.description,
                                this.componentTextApi!,
                              ),
                            }
                          : {}),
                      })),
                    }
                  : {}),
              },
            }
          : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      };
      const timer =
        expiresAt !== undefined
          ? setInterval(() => {
              if (Date.now() >= expiresAt) this.answer(id, undefined);
            }, 1000)
          : undefined;
      this.dialogs.set(id, {
        request: data,
        sessionBound: lifetime === this.sessionLifetime.signal,
        resolve: resolveValue,
        timer,
      });
      signal?.addEventListener("abort", cancel, { once: true });
      this.emitEvent({ type: "dialog", data });
    }).finally(() => signal?.removeEventListener("abort", cancel));
  }
  answer(id: string, value: unknown) {
    const pending = this.dialogs.get(id);
    if (!pending) return;
    this.dialogEditors.get(id)?.controller.abort();
    clearTimeout(pending.timer);
    this.dialogs.delete(id);
    pending.resolve(
      pending.request.kind === "editor" && typeof value === "string"
        ? value.trim()
        : value,
    );
    this.emitEvent({ type: "dialog_closed", id });
  }
  private async handleDialogInput(
    a: RecordValue,
    data: string,
    initial: string,
    tui: Awaited<ReturnType<typeof loadTuiApi>>,
    toggleTools?: () => void,
  ): Promise<
    (DesktopInputResult & { keyId?: string; changed?: boolean }) | undefined
  > {
    const id = required(a.dialogId, "Dialog ID");
    const pending = this.dialogs.get(id);
    if (!pending) return { consume: true };
    if (this.dialogKeys?.source !== this.keybindings) {
      const runtime = await loadComponentRuntime();
      this.dialogKeys = {
        source: this.keybindings,
        manager: runtime.keys.KeybindingsManager.create(this.agentDir),
      };
    }
    if (this.dialogs.get(id) !== pending) return { consume: true };
    let commands:
      Awaited<ReturnType<typeof createDialogTextCommands>> | undefined;
    if (
      (pending.request.kind === "editor" || pending.request.kind === "input") &&
      a.dialogTarget === "text" &&
      a.controlReadOnly !== true
    ) {
      pending.commands ??= createDialogTextCommands(
        this.keybindings,
        pending.request.kind,
      );
      commands = await pending.commands;
      if (this.dialogs.get(id) !== pending) return { consume: true };
    }
    const result = dialogInput(
      pending.request,
      data,
      this.dialogKeys!.manager,
      {
        kind: text(a.dialogTarget),
        index: typeof a.dialogIndex === "number" ? a.dialogIndex : undefined,
        text: typeof a.controlText === "string" ? a.controlText : undefined,
      },
    );
    if (result) {
      if (result.toggleTools) toggleTools?.();
      if (result.answer) this.answer(id, result.value);
      return {
        consume: true,
        dialogFocus: result.focus,
        ...(result.external ? { dialogExternal: true } : {}),
      };
    }
    if (
      (pending.request.kind === "editor" || pending.request.kind === "input") &&
      a.dialogTarget === "text"
    ) {
      if (a.controlReadOnly === true) return { consume: true };
      const value = typeof a.controlText === "string" ? a.controlText : "";
      const selection = (a.selection as DesktopSelection | undefined) ?? {
        start: value.length,
        end: value.length,
      };
      const edit = commands!.handle(
        data,
        value,
        selection,
        a.editorLayout as
          import("../shared/desktop-ui.ts").DesktopEditorLayout | undefined,
      );
      if (edit) {
        if (edit.answer !== undefined) this.answer(id, edit.answer);
        const { answer: _answer, ...transaction } = edit;
        const next = edit.data ?? data;
        return {
          ...transaction,
          data: next,
          keyId: tui.parseKey(next),
          changed: next !== initial,
        };
      }
    }
    return undefined;
  }
  private idle() {
    if (
      !this.session.isIdle ||
      this.session.isBashRunning ||
      this.inflightPrompts ||
      this.authAbort
    )
      throw new Error("请先停止当前任务");
  }
  private rememberEditorText(next: string) {
    if (next !== this.editorText) this.editorRevision++;
    this.editorText = next;
  }
  private saveEditorDraft() {
    if (this.boundSessionId)
      this.editorDrafts.set(
        this.boundSessionId,
        this.desktopUI.getEditorText() ?? this.editorText,
      );
  }
  private async loadKeybindings(current = () => true) {
    try {
      const keybindings = JSON.parse(
        await readFile(join(this.agentDir, "keybindings.json"), "utf8"),
      );
      if (current()) this.keybindings = keybindings;
    } catch (error) {
      if (!current()) return;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.notice(errorMessage(error), "warning");
      this.keybindings = {};
    }
  }
  private async reloadResources() {
    await this.session.reload();
  }
  setThemeSetting(setting: string | undefined) {
    if (!this.invocationTheme || !this.refreshTheme)
      throw new Error("Interactive application has not been initialized");
    this.invocationTheme.currentThemeSetting = setting;
    this.refreshTheme();
    this.publish();
  }
  private async prepareReload() {
    const session = this.session;
    this.saveEditorDraft();
    this.sessionLifetime.abort();
    this.sessionLifetime = new AbortController();
    const lifetime = this.sessionLifetime;
    const current = () =>
      !lifetime.signal.aborted &&
      this.sessionLifetime === lifetime &&
      this.runtime?.session === session;
    this.externalEditor?.controller.abort();
    this.rememberEditorText(this.desktopUI.getEditorText() ?? this.editorText);
    this.toolRenderPhases.clear();
    this.toolExpansions.clear();
    this.desktopUI.resetExtensionSurfaces();
    this.autocompleteWrappers = [];
    this.clearInputListeners();
    this.statuses = {};
    this.footerStatuses.clear();
    this.workingMessage = undefined;
    this.widgets = {};
    this.widgetPlacements = {};
    this.workingVisible = true;
    this.hiddenThinkingLabel = undefined;
    this.workingIndicator = undefined;
    this.editorFactory = undefined;
    this.headerFactory = undefined;
    this.footerFactory = undefined;
    this.editorMountRevision++;
    await this.loadKeybindings(current);
    if (!current()) return;
    await this.refreshAutocomplete(current);
    if (!current()) return;
    this.refreshTheme?.();
    await this.desktopUI.mount(this.defaultEditorSource, "editor", "editor");
    this.applyInteractiveSettings();
    if (current()) this.desktopUI.setEditorText(this.editorText);
  }
  private async pasteClipboard() {
    const session = this.session;
    const ui = session.extensionRunner.getUIContext();
    const initial = ui.getEditorText();
    const version = this.desktopUI.editorVersion;
    const revision = this.editorRevision;
    const selection = this.desktopUI.getEditorSelection();
    const current = () =>
      this.runtime?.session === session &&
      !this.sessionLifetime.signal.aborted &&
      this.desktopUI.editorVersion === version &&
      this.editorRevision === revision &&
      ui.getEditorText() === initial &&
      JSON.stringify(this.desktopUI.getEditorSelection()) ===
        JSON.stringify(selection);
    const clipboard = this.clipboardOverride ?? (await systemClipboard());
    if (!clipboard) throw new Error("System clipboard is unavailable");
    const paths = await clipboard.getFilePaths?.();
    if (paths?.length) {
      if (paths.some((path) => /\p{Cc}/u.test(path)))
        throw new Error("Clipboard file path contains control characters");
      if (!current()) return { cancelled: true };
      const start = selection?.start ?? initial.length;
      const end = selection?.end ?? start;
      const cursorText = this.desktopUI.getEditorRawText() ?? initial;
      const isBash = initial.trimStart().startsWith("!");
      const content = isBash
        ? paths.map((path) => `'${path.replaceAll("'", "'\\''")}'`).join(" ")
        : paths.join("\n");
      const before = cursorText[start - 1];
      const after = cursorText[end];
      ui.pasteToEditor(
        `${before && !/\s/.test(before) ? " " : ""}${content}${after && !/\s/.test(after) ? " " : ""}`,
      );
      return { kind: "files", count: paths.length };
    }
    const bytes = await clipboard.getImage();
    if (bytes?.length) {
      const image = await clipboardImage(bytes);
      if (!current()) return { cancelled: true };
      this.emitEvent({
        type: "activity",
        name: "desktop_clipboard_image",
        data: { ...image, sessionId: session.sessionId },
      });
      return { kind: "image", ...image };
    }
    const content = await clipboard.getText();
    if (!current()) return { cancelled: true };
    if (content) ui.pasteToEditor(content);
    if (content === undefined && bytes === undefined && paths === undefined)
      throw new Error("System clipboard is unavailable");
    return { kind: content ? "text" : "empty" };
  }
  private async selectModel(persist: boolean) {
    const session = this.session;
    const signal = this.sessionLifetime.signal;
    const available = session.modelRuntime.getAvailableSnapshot();
    const scoped = session.scopedModels;
    const models = scoped.length
      ? scoped
          .map(({ model }) => model)
          .filter((model) =>
            available.some(
              (item) =>
                item.provider === model.provider && item.id === model.id,
            ),
          )
      : [...available];
    const options = models.map((model) => `${model.provider}/${model.id}`);
    if (!options.length) {
      this.notice("没有可用模型", "warning", true);
      return { cancelled: true };
    }
    const choice = await this.ask(
      { kind: "select", title: "选择模型", desktopTitle: true, options },
      signal,
    );
    if (signal.aborted || this.runtime?.session !== session)
      return { cancelled: true };
    const model = models[options.indexOf(text(choice))];
    if (!model) return { cancelled: true };
    const result = await this.action({
      action: "model.set",
      args: { provider: model.provider, id: model.id, persist },
    });
    this.notice(`已选择模型 ${model.provider}/${model.id}`, "info", true);
    return result;
  }
  private async selectSession(kind: string, args: RecordValue) {
    if (!["tree", "fork", "resume"].includes(kind))
      throw new Error("Unknown session selector");
    const session = this.session;
    const signal = this.sessionLifetime.signal;
    const current = () => !signal.aborted && this.runtime?.session === session;
    const choices =
      kind === "resume"
        ? (
            (await this.perform({
              action: "sessions.list",
              args: { all: args.all === true },
            })) as Awaited<ReturnType<typeof SessionManager.list>>
          ).map((item) => ({
            id: item.path,
            label: item.name ?? item.firstMessage ?? item.id,
          }))
        : kind === "fork"
          ? session
              .getUserMessagesForForking()
              .map((item) => ({ id: item.entryId, label: item.text }))
          : this.snapshot().tree.map((item) => ({
              id: item.id,
              label: `${item.label ?? item.role ?? item.type}: ${item.text}`,
            }));
    if (!current()) return { cancelled: true };
    if (!choices.length) {
      this.notice("没有可选择的会话记录", "info", true);
      return { cancelled: true };
    }
    const options = choices.map(
      (item, index) =>
        `${index + 1}. ${item.label.replace(/\s+/g, " ").slice(0, 160)}`,
    );
    const answer = await this.ask(
      {
        kind: "select",
        desktopTitle: true,
        title:
          kind === "resume"
            ? "恢复会话"
            : kind === "fork"
              ? "分叉会话"
              : "会话树",
        options,
      },
      signal,
    );
    if (!current()) return { cancelled: true };
    const choice = choices[options.indexOf(text(answer))];
    if (!choice) return { cancelled: true };
    if (kind !== "tree")
      return this.action({
        action: kind === "resume" ? "session.switch" : "session.fork",
        args: kind === "resume" ? { path: choice.id } : { id: choice.id },
      });
    if (choice.id === session.sessionManager.getLeafId())
      return { cancelled: false };
    let summarize = args.summarize === true;
    let instructions = text(args.instructions) || undefined;
    if (
      args.summarize === undefined &&
      !session.settingsManager.getBranchSummarySkipPrompt()
    ) {
      const summary = await this.ask(
        {
          kind: "select",
          title: "总结当前分支",
          desktopTitle: true,
          desktopOptions: true,
          options: ["不总结", "总结", "使用自定义指令总结"],
        },
        signal,
      );
      if (!current() || summary === undefined) return { cancelled: true };
      summarize = summary !== "不总结";
      if (summary === "使用自定义指令总结") {
        const result = await this.ask(
          { kind: "editor", title: "总结指令", desktopTitle: true },
          signal,
        );
        if (!current() || result === undefined) return { cancelled: true };
        instructions = text(result);
      }
    }
    if (session.isStreaming) {
      await this.perform({ action: "queue.restore", args: { abort: true } });
      await session.waitForIdle();
    }
    if (!current()) return { cancelled: true };
    return this.action({
      action: "session.navigate",
      args: { id: choice.id, summarize, instructions },
    });
  }
  private editDialogExternally(id: string, initial: string) {
    const dialog = this.dialogs.get(id);
    if (!dialog) return Promise.resolve({ cancelled: true });
    if (dialog.request.kind !== "editor")
      throw new Error("该对话框不是多行编辑器");
    const existing = this.dialogEditors.get(id);
    if (existing) return existing.pending;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      this.sessionLifetime.signal,
    ]);
    const runtime = this.runtime!;
    const pending = (async () => {
      try {
        const text = await runExternalEditor(
          runtime.services.settingsManager.getExternalEditorCommand(),
          initial,
          runtime.cwd,
          signal,
        );
        if (signal.aborted || this.dialogs.get(id) !== dialog)
          return { cancelled: true };
        return { text };
      } catch (error) {
        if (signal.aborted) return { cancelled: true };
        throw error;
      } finally {
        if (this.dialogEditors.get(id)?.controller === controller)
          this.dialogEditors.delete(id);
      }
    })();
    this.dialogEditors.set(id, { controller, pending });
    return pending;
  }
  private editExternally(id: string) {
    if (this.externalEditor) throw new Error("外部编辑器已经打开");
    const session = this.session;
    const ui = session.extensionRunner.getUIContext();
    const initial = ui.getEditorText();
    const version = this.editorRevision;
    const componentVersion = this.desktopUI.editorVersion;
    const controller = new AbortController();
    const pending = (async () => {
      try {
        const text = await runExternalEditor(
          this.runtime!.services.settingsManager.getExternalEditorCommand(),
          initial,
          this.runtime!.cwd,
          controller.signal,
        );
        if (controller.signal.aborted)
          return { applied: false, cancelled: true };
        this.externalEditorResult = { id, text, sessionId: session.sessionId };
        if (
          this.session !== session ||
          this.editorRevision !== version ||
          this.desktopUI.editorVersion !== componentVersion ||
          ui.getEditorText() !== initial
        ) {
          this.notice("草稿已更新，外部编辑器结果未覆盖当前输入", "warning", true);
          return { applied: false, cancelled: false };
        }
        ui.setEditorText(text);
        return { applied: true, cancelled: false };
      } catch (error) {
        if (controller.signal.aborted)
          return { applied: false, cancelled: true };
        throw error;
      } finally {
        if (this.externalEditor?.controller === controller)
          this.externalEditor = undefined;
      }
    })();
    this.externalEditor = { id, controller, pending };
    return pending;
  }
  private refreshSoon() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.publish();
    }, 45);
  }
  publish() {
    this.startupPolicies.observeModel();
    this.authorizations.refreshPresentations();
    if (this.runtime)
      this.emitEvent({ type: "snapshot", data: this.snapshot() });
  }
  private initialProjectTrust(cwd: string): boolean {
    return (
      this.projectTrustByCwd.get(cwd) ??
      (!hasTrustRequiringProjectResources(cwd) ||
        new ProjectTrustStore(this.agentDir).get(cwd) === true)
    );
  }
  private projectTrustContext(cwd: string): ProjectTrustContext {
    // Replacement has already retired the old session's prompt/authorization scope.
    const ask = (request: Omit<DialogRequest, "id">, signal?: AbortSignal) =>
      this.ask(request, signal, this.hostLifetime.signal);
    return {
      cwd,
      mode: "tui",
      hasUI: true,
      ui: {
        select: async (title, options, opts) => {
          const value = await ask(
            { kind: "select", title, options, timeout: opts?.timeout },
            opts?.signal,
          );
          return typeof value === "string" ? value : undefined;
        },
        confirm: async (title, message, opts) =>
          (await ask(
            { kind: "confirm", title, message, timeout: opts?.timeout },
            opts?.signal,
          )) === true,
        input: async (title, placeholder, opts) => {
          const value = await ask(
            { kind: "input", title, placeholder, timeout: opts?.timeout },
            opts?.signal,
          );
          return typeof value === "string" ? value : undefined;
        },
        notify: (message, level) => this.notice(message, level),
      },
    };
  }
  private defaultFactory: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    sessionManager,
    sessionStartEvent,
    projectTrustContext,
  }) => {
    const settingsManager = SettingsManager.create(cwd, this.agentDir, {
      projectTrusted: this.initialProjectTrust(cwd),
    });
    const trustDiagnostics: { type: "warning"; message: string }[] = [];
    const shouldResolveTrust =
      !this.projectTrustByCwd.has(cwd) &&
      hasTrustRequiringProjectResources(cwd);
    if (shouldResolveTrust)
      await this.loadKeybindings(() => !this.hostLifetime.signal.aborted);
    const services = await createAgentSessionServices({
      cwd,
      agentDir: this.agentDir,
      settingsManager,
      resourceLoaderReloadOptions: shouldResolveTrust
        ? {
            resolveProjectTrust: async ({ extensionsResult }) => {
              const trusted = await resolveProjectTrusted({
                cwd,
                trustStore: new ProjectTrustStore(this.agentDir),
                defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
                extensionsResult,
                projectTrustContext:
                  projectTrustContext ?? this.projectTrustContext(cwd),
                onExtensionError: (message) =>
                  trustDiagnostics.push({ type: "warning", message }),
              });
              this.hostLifetime.signal.throwIfAborted();
              this.projectTrustByCwd.set(cwd, trusted);
              return trusted;
            },
          }
        : undefined,
      resourceLoaderOptions: {
        extensionsOverride: this.convertOfficialExtensions,
        additionalThemePaths: ["light", "dark"].map((name) =>
          join(
            getPackageDir(),
            "dist",
            "modes",
            "interactive",
            "theme",
            `${name}.json`,
          ),
        ),
        extensionFactories: [
          {
            name: "codemode",
            factory: createCodemodeExtension({ mode: "on" }),
            builtin: true,
            replaceable: true,
          },
          {
            name: "tool_search",
            factory: createToolSearchExtension(),
            builtin: true,
            replaceable: true,
          },
          {
            name: "mcp",
            factory: createMcpExtension(
              await desktopMcpOptions(
                this.agentDir,
                (url) => this.authorizations.open(url),
                () => this.authorizations.completion(),
              ),
            ),
            builtin: true,
            replaceable: true,
          },
        ],
      },
    });
    services.diagnostics.unshift(...trustDiagnostics);
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
  private factory: CreateAgentSessionRuntimeFactory = async (options) => {
    if (!this.runtimeLifecycle.canCompleteConstruction())
      throw new DOMException("Hosted runtime is closed", "AbortError");
    const result = await this.createRuntime(options);
    if (!this.runtimeLifecycle.canCompleteConstruction()) {
      await new AgentSessionRuntime(
        result.session,
        result.services,
        this.factory,
      ).dispose();
      throw new DOMException("Hosted runtime is closed", "AbortError");
    }
    return result;
  };
  private createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
    if (!this.runtimeFactory) {
      const path = join(this.agentDir, "desktop", "runtime.mjs");
      try {
        await stat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return this.defaultFactory(options);
      }
      const module = await import(pathToFileURL(path).href);
      if (typeof module.configureDesktop === "function")
        await module.configureDesktop(this.sdk);
      if (typeof module.createRuntime === "function")
        this.runtimeFactory = module.createRuntime;
      else this.runtimeFactory = (next, fallback) => fallback(next);
    }
    return this.runtimeFactory!(options, this.defaultFactory, this.sdk.sdk);
  };
  async initialize(cwdInput: string, options?: DesktopStartupOptions) {
    if (this.disposal) throw new Error("Pi 已关闭");
    if (this.runtime?.cwd === resolve(cwdInput)) return this.snapshot();
    if (this.changing) throw new Error("工作区正在切换，请稍后重试");
    this.changing = true;
    try {
      await this.runtimeLifecycle.track(() =>
        this.initializeWorkspace(cwdInput, options ?? this.launchOptions ?? {}),
      );
      this.launchOptions = undefined;
    } finally {
      this.changing = false;
      this.publish();
    }
    return this.snapshot();
  }
  private async initializeWorkspace(
    cwdInput: string,
    options: DesktopStartupOptions,
    newSession = false,
  ) {
    const cwd = resolve(cwdInput);
    if (!(await stat(cwd)).isDirectory()) throw new Error("工作区不是文件夹");
    const componentRuntime = await loadComponentRuntime();
    this.componentTextApi = componentRuntime.text;
    this.transcriptMarkdown = new TranscriptMarkdownRenderer(componentRuntime);
    if (this.disposal) throw new Error("Pi 已关闭");
    await this.closeWorkspaceRuntime();
    // The old renderer uses its original launch settings throughout teardown.
    this.startup.configuration = { ...options };
    this.invocationTheme = undefined;
    this.unsubscribe?.();
    this.streaming = undefined;
    this.statuses = {};
    this.footerStatuses.clear();
    this.workingMessage = undefined;
    this.widgets = {};
    this.workingVisible = true;
    this.hiddenThinkingLabel = undefined;
    this.workingIndicator = undefined;
    this.activeTools = [];
    this.toolResults.clear();
    this.toolRenderPhases.clear();
    this.toolExpansions.clear();
    const settings = SettingsManager.create(cwd, this.agentDir, {
      projectTrusted: this.initialProjectTrust(cwd),
    });
    if (this.disposal) throw new Error("Pi 已关闭");
    // Inherited-stdio extensions use process.cwd(), as they do in Pi's CLI.
    // Only the isolated PTY worker may change the process-wide directory.
    if (
      process.env.PI_DESKTOP_PTY === "1" &&
      process.argv.includes("--sdk-worker")
    )
      process.chdir(cwd);
    const sessionDir = join(
      this.agentDir,
      "sessions",
      `--${cwd.replace(/^[/\\]/, "").replace(/[:\\/]/g, "-")}--`,
    );
    const directory = settings.getSessionDir() ?? sessionDir;
    const restored = newSession
      ? undefined
      : await resumeDesktopSession(this.agentDir, cwd, directory);
    const sessionManager = restored ?? SessionManager.create(cwd, directory);
    // Pi's editor needs a backing manager. Keep the initial blank workspace
    // unsaved and out of history until the user actually starts a conversation.
    this.workspaceDraft = !newSession && !restored ? sessionManager : undefined;
    this.runtime = await createAgentSessionRuntime(this.factory, {
      cwd,
      agentDir: this.agentDir,
      sessionManager,
    });
    if (this.disposal) throw new Error("Pi 已关闭");
    const runtime = this.runtime;
    this.restoreRuntimeTransitions.set(
      runtime,
      bindRuntimeTransitions(
        runtime,
        this.runtimeLifecycle,
        () =>
          this.runtime === runtime &&
          !this.disposal &&
          !this.runtimeDisposals.has(runtime),
      ),
    );
    this.restoreRuntimeCallbacks.set(
      runtime,
      bindRuntimeCallbacks(runtime, {
        current: () => this.runtime === runtime,
        rebind: () => this.bind(),
        beforeInvalidate: () => {
          this.restoreSessionReload?.();
          this.restoreSessionPrompt?.();
          this.restoreSessionBash?.();
          this.stopThemeWatch?.();
          this.appearanceChanged = undefined;
          this.saveEditorDraft();
          this.sessionLifetime.abort();
          this.externalEditor?.controller.abort();
          this.desktopUI.resetExtensionSurfaces();
        },
      }),
    );
    await this.managedTools.prepare();
    if (this.disposal) throw new Error("Pi 已关闭");
    await this.bind();
    await this.rememberWorkspace(cwd);
    this.publish();
    await this.startup.run(options);
    return this.snapshot();
  }
  private async closeWorkspaceRuntime() {
    const previous = this.runtime;
    if (!previous) return;
    this.idle();
    this.saveEditorDraft();
    this.sessionTitles.cancel();
    this.restoreSessionReload?.();
    this.restoreSessionPrompt?.();
    this.restoreSessionBash?.();
    this.stopThemeWatch?.();
    this.appearanceChanged = undefined;
    this.sessionLifetime.abort();
    this.externalEditor?.controller.abort();
    await this.disposeRuntime(previous);
    this.unsubscribe?.();
    this.clearInputListeners();
    this.desktopUI.clearSurfaces();
    this.restoreRuntimeTransitions.get(previous)?.();
    this.restoreRuntimeTransitions.delete(previous);
    if (this.runtime === previous) this.runtime = undefined;
    this.workspaceDraft = undefined;
  }
  private async readWorkspacePreferences() {
    let preferences: RecordValue = {};
    try {
      preferences = record(
        JSON.parse(await readFile(join(this.agentDir, "desktop.json"), "utf8")),
      );
      this.recentWorkspaces = Array.isArray(preferences.selectedWorkspaces)
        ? preferences.selectedWorkspaces.filter(
            (p): p is string => typeof p === "string",
          )
        : [];
    } catch {
      /* First launch has no desktop preferences. */
      this.recentWorkspaces = [];
    }
    return preferences;
  }
  private async rememberWorkspace(cwd: string, remove = false) {
    const preferences = await this.readWorkspacePreferences();
    const same = (value: string) => process.platform === "win32"
      ? resolve(value).toLowerCase() === cwd.toLowerCase()
      : resolve(value) === cwd;
    const remaining = this.recentWorkspaces.filter((p) => !same(p));
    this.recentWorkspaces = remove ? remaining : [cwd, ...remaining].slice(0, 12);
    await mkdir(this.agentDir, { recursive: true });
    await writeFile(
      join(this.agentDir, "desktop.json"),
      JSON.stringify({ ...preferences, workspaces: this.recentWorkspaces, selectedWorkspaces: this.recentWorkspaces }, null, 2),
    );
  }
  private async bind() {
    if (this.disposal) return;
    if (this.session.sessionManager !== this.workspaceDraft) {
      this.workspaceDraft = undefined;
      persistDesktopSession(this.session.sessionManager);
    }
    this.sessionTitles.cancel();
    this.restoreSessionReload?.();
    this.restoreSessionPrompt?.();
    this.restoreSessionBash?.();
    this.editorMountRevision++;
    if (this.boundSessionId === this.session.sessionId) this.saveEditorDraft();
    this.sessionLifetime.abort();
    this.sessionLifetime = new AbortController();
    this.boundSessionId = this.session.sessionId;
    this.rememberEditorText(this.editorDrafts.get(this.boundSessionId) ?? "");
    this.externalEditor?.controller.abort();
    this.editorRevision++;
    this.unsubscribe?.();
    this.streaming = undefined;
    this.activeTools = [];
    this.toolResults.clear();
    this.toolRenderPhases.clear();
    this.toolExpansions.clear();
    this.clearInputListeners();
    await this.loadKeybindings();
    if (this.disposal) return;
    this.statuses = {};
    this.footerStatuses.clear();
    this.workingMessage = undefined;
    this.widgets = {};
    this.widgetPlacements = {};
    this.editorFactory = undefined;
    this.headerFactory = undefined;
    this.footerFactory = undefined;
    this.workingVisible = true;
    this.hiddenThinkingLabel = undefined;
    this.workingIndicator = undefined;
    const session = this.session;
    this.unsubscribe = session.subscribe((event) => this.onSessionEvent(event));
    this.autocompleteWrappers = [];
    const uiContext = await this.ui();
    if (this.disposal) return;
    await this.desktopUI.mount(this.defaultEditorSource, "editor", "editor");
    const application = this.desktopUI.terminalRuntime.capture().application!;
    for (const status of this.pendingManagedStatuses.splice(0))
      application.managedToolStatus(status, true);
    this.applyInteractiveSettings();
    this.desktopUI.setEditorText(this.editorText);
    this.restoreSessionPrompt = bindSessionPrompt(session, (operation) =>
      this.authorizations.run(this.sessionLifetime.signal, operation),
    );
    this.restoreSessionBash = bindSessionBash(
      session,
      () => this.desktopUI.terminalRuntime.capture().application?.bash,
      () =>
        this.runtime?.session === session &&
        !this.sessionLifetime.signal.aborted,
      (error) =>
        this.notice(`Bash command failed: ${errorMessage(error)}`, "error"),
    );
    this.restoreSessionReload = bindSessionReload(session, {
      current: () => this.runtime?.session === session,
      beforeSessionStart: () => this.prepareReload(),
      afterReload: async () => {
        await this.editorMount;
        const application =
          this.desktopUI.terminalRuntime.capture().application!;
        const trust = application.content.saveImplicitTrustAfterReload();
        application.appendNoticeComponents(trust.warnings);
        if (trust.saved)
          this.notice(
            "Reloaded keybindings, extensions, skills, prompts, themes, and context files; saved project trust",
          );
      },
    });
    await session.bindExtensions({
      uiContext,
      // Pi has no desktop mode; "tui" enables the interactive APIs converted by this host.
      mode: "tui",
      commandContextActions: {
        waitForIdle: () => this.session.waitForIdle(),
        newSession: (options) => this.runtime!.newSession(options),
        switchSession: (path, options) =>
          this.runtime!.switchSession(path, options),
        fork: async (id, options) => {
          const result = await this.runtime!.fork(id, options);
          return { ...result, text: result.selectedText };
        },
        navigateTree: (id, options) => this.session.navigateTree(id, options),
        reload: () => this.reloadResources(),
      },
      shutdownHandler: () => {
        if (this.shuttingDown || this.runtime?.session !== session) return;
        this.shuttingDown = true;
        void this.dispose().then(
          () => this.emitEvent({ type: "shutdown" }),
          (error) => {
            this.notice(errorMessage(error), "error");
            this.emitEvent({ type: "shutdown", exitCode: 1 });
          },
        );
      },
      abortHandler: () => {
        void this.session.abort();
      },
      onError: (error) => this.notice(error.error, "error"),
    });
    await this.editorMount;
    if (!this.disposal && this.runtime?.session === session)
      rememberDesktopSession(this.agentDir, session.sessionManager);
    this.sessionTitles.update(session, this.sessionLifetime.signal);
  }
  private onSessionEvent(event: AgentSessionEvent) {
    if (event.type === "session_info_changed") this.sessionTitles.cancel();
    this.generation.observe(event, this.session.sessionId);
    if (event.type === "agent_start") this.turnToolCalls.clear();
    this.desktopUI.terminalRuntime.capture().application?.event(event);
    this.emitEvent({ type: "sdk_event", data: event });
    const phase = (id: string) => {
      let current = this.toolRenderPhases.get(id);
      if (!current) {
        current = {
          argsComplete: false,
          executionStarted: false,
          isPartial: true,
          isError: false,
        };
        this.toolRenderPhases.set(id, current);
      }
      return current;
    };
    if (event.type === "tool_execution_start" && !event.parentToolCallId) {
      this.turnToolCalls.add(event.toolCallId);
      phase(event.toolCallId).executionStarted = true;
      this.activeTools.push({
        id: event.toolCallId,
        name: event.toolName,
        arguments: event.args,
      });
    }
    if (event.type === "tool_execution_update" && !event.parentToolCallId) {
      Object.assign(phase(event.toolCallId), {
        isPartial: true,
        isError: false,
      });
      this.toolResults.set(event.toolCallId, event.partialResult);
      const tool = this.activeTools.find((t) => t.id === event.toolCallId);
      if (tool)
        tool.output = messageView(
          { content: event.partialResult.content },
          "progress",
        ).content;
    }
    if (event.type === "tool_execution_end" && !event.parentToolCallId) {
      Object.assign(phase(event.toolCallId), {
        isPartial: false,
        isError: event.isError,
      });
      this.toolResults.delete(event.toolCallId);
      this.activeTools = this.activeTools.filter(
        (t) => t.id !== event.toolCallId,
      );
    }
    if (
      event.type === "message_start" &&
      record(event.message).role === "assistant"
    )
      this.streaming = messageView(event.message, "streaming");
    if (event.type === "message_update" && this.streaming) {
      this.streaming = messageView(event.message, "streaming");
      for (const block of this.streaming.content)
        if (block.type === "toolCall" && block.id) phase(block.id);
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      this.startupPolicies.maybeBug(event.message);
      for (const block of event.message.content) {
        if (block.type !== "toolCall") continue;
        const current = phase(block.id);
        if (["aborted", "error"].includes(event.message.stopReason)) {
          if (current.isPartial)
            Object.assign(current, { isPartial: false, isError: true });
        } else current.argsComplete = true;
      }
      this.streaming = undefined;
    }
    if (event.type === "agent_settled") {
      for (const id of this.turnToolCalls) this.toolExpansions.set(id, false);
      this.turnToolCalls.clear();
      this.streaming = undefined;
      this.activeTools = [];
      this.sessionTitles.update(this.session, this.sessionLifetime.signal);
    }
    if (event.type === "auto_retry_start")
      this.notice(
        `重试 ${event.attempt}/${event.maxAttempts}：${event.errorMessage}`,
        "warning",
        true,
      );
    this.emitEvent({
      type: "activity",
      name: event.type,
      data: [
        "tool_execution_start",
        "tool_execution_update",
        "tool_execution_end",
        "bash_execution_update",
      ].includes(event.type)
        ? event
        : undefined,
    });
    this.refreshSoon();
  }
  private async refreshAutocomplete(current = () => true) {
    const base = await createDesktopAutocompleteFactory(
      () => [
        ...this.session.extensionRunner
          .getRegisteredCommands()
          .map((command) => ({ ...command, name: command.invocationName })),
        ...this.session.resourceLoader.getPrompts().prompts,
        ...this.session.resourceLoader.getSkills().skills.map((skill) => ({
          name: `skill:${skill.name}`,
          description: skill.description,
        })),
      ],
      this.runtime!.cwd,
      this.managedTools.fdPath,
    );
    if (current()) {
      this.autocompleteBase = base;
      this.setupAutocomplete();
    }
  }
  private setupAutocomplete() {
    if (!this.autocompleteBase) return;
    let provider = this.autocompleteBase();
    const triggers: string[] = [];
    for (const wrapper of this.autocompleteWrappers) {
      provider = wrapper(provider);
      triggers.push(...(provider.triggerCharacters ?? []));
    }
    if (triggers.length) provider.triggerCharacters = [...new Set(triggers)];
    this.autocomplete = provider;
    this.desktopUI.setEditorAutocompleteProvider(provider);
    this.defaultEditorSource.setAutocompleteProvider(
      this.desktopUI.terminalRuntime.capture(),
      provider,
    );
  }
  private applyInteractiveSettings() {
    const scope = this.desktopUI.terminalRuntime.capture();
    scope.applySettings(true);
    this.defaultEditorSource.applySettings(scope, this.sdk);
  }
  private async ui(): Promise<ExtensionUIContext> {
    const session = this.session;
    const host = this;
    const tui = await loadTuiApi();
    this.desktopUI.terminalInput.initialize(tui);
    this.desktopUI.terminalInput.setInterceptor((data) => {
      if (this.runtime?.session !== session || tui.isKeyRelease(data))
        return false;
      const shortcuts = session.extensionRunner.getShortcuts(this.keybindings);
      const shortcut = [...shortcuts].find(([key]) =>
        tui.matchesKey(data, key),
      )?.[1];
      if (!shortcut) return false;
      void Promise.resolve()
        .then(() => shortcut.handler(session.extensionRunner.createContext()))
        .catch((error) => this.notice(errorMessage(error), "error"));
      return true;
    });
    await this.refreshAutocomplete();
    const themeAPI = (await loadComponentRuntime()).theme;
    const invocationTheme = (this.invocationTheme ??= themeAPI.createSelection(
      () => this.session.settingsManager,
      this.startup.configuration.initialThemeSetting,
    ));
    this.stopThemeWatch?.();
    themeAPI.setTerminalColors({});
    themeAPI.setTerminalColorScheme(this.desktopAppearance);
    let selection: string | undefined;
    let followsSystem = false;
    const themeCache = new Map<string, { resource: Theme; theme: Theme }>();
    const builtinNames = new Set(["system", "light", "dark"]);
    const builtinThemes = themeAPI
      .getAvailableThemesWithPaths()
      .filter((theme) => builtinNames.has(theme.name));
    const getTheme = (name: string) => {
      const resource =
        name !== "system"
          ? this.session.resourceLoader
              .getThemes()
              .themes.find((theme) => theme.name === name)
          : undefined;
      if (!resource)
        return builtinNames.has(name)
          ? themeAPI.getThemeByName(name)
          : undefined;
      let theme =
        themeCache.get(name)?.resource === resource
          ? themeCache.get(name)!.theme
          : resource;
      if (resource.sourcePath) {
        try {
          theme = themeAPI.loadThemeFromPath(resource.sourcePath);
        } catch {
          // Preserve the last valid resource while an editor rewrites its file.
        }
      }
      themeCache.set(name, { resource, theme });
      return theme;
    };
    const applyTheme = (theme: Theme) => {
      this.theme = theme;
      themeAPI.setThemeInstance(theme);
      this.desktopTheme = {
        name: theme.name,
        appearance: theme.appearance,
        followsSystem,
        colors: Object.fromEntries(
          Object.entries(theme.colors).map(([token, color]) => [
            token,
            tui.colorToHex(color),
          ]),
        ),
      };
      this.desktopUI.invalidate();
      this.desktopUI.terminalRuntime.capture().application?.invalidate();
    };
    const publishTheme = () => {
      this.emitEvent({
        type: "activity",
        name: "extension_theme",
        data: this.desktopTheme,
      });
      this.publish();
    };
    const applyNamedTheme = (name: string, theme: Theme) => {
      this.stopThemeWatch?.();
      applyTheme(theme);
      if (!builtinNames.has(name) && theme.sourcePath) {
        const path = theme.sourcePath;
        this.stopThemeWatch = watchThemeFile(
          path,
          () => themeAPI.loadThemeFromPath(path),
          (updated) => {
            const resource = this.session.resourceLoader
              .getThemes()
              .themes.find((item) => item.name === name);
            if (resource) themeCache.set(name, { resource, theme: updated });
            applyTheme(updated);
            publishTheme();
          },
        );
      }
    };
    this.refreshTheme = () => {
      themeAPI.setTerminalColors({});
      themeAPI.setTerminalColorScheme(this.desktopAppearance);
      themeCache.clear();
      selection = invocationTheme.getThemeSetting();
      const name =
        themeAPI.resolveThemeSetting(selection, this.desktopAppearance) ??
        "system";
      followsSystem =
        !!themeAPI.parseAutoThemeSetting(selection) || name === "system";
      const theme = getTheme(name) ?? getTheme("system");
      if (!theme) throw new Error("Pi built-in themes are unavailable");
      invocationTheme.activeThemeName = theme.name ?? "system";
      applyNamedTheme(name, theme);
      if (theme.name !== name && selection !== undefined)
        this.notice(
          `Failed to load theme "${name}": Theme does not exist: ${name}\nFell back to the system theme.`,
          "error",
        );
      return theme;
    };
    this.appearanceChanged = () => {
      if (!followsSystem) return;
      themeAPI.setTerminalColors({});
      themeAPI.setTerminalColorScheme(this.desktopAppearance);
      const name =
        themeAPI.resolveThemeSetting(selection, this.desktopAppearance) ??
        "system";
      applyNamedTheme(name, getTheme(name) ?? getTheme("system")!);
      publishTheme();
    };
    const themeProxy = new Proxy(this.refreshTheme(), {
      get: (_, key) => {
        const value = Reflect.get(host.theme!, key, host.theme!);
        return typeof value === "function" ? value.bind(host.theme) : value;
      },
    });
    this.themeProxies.add(themeProxy);
    return {
      select: async (title, options, opts) => {
        const v = await this.ask(
          {
            kind: "select",
            title,
            options,
            timeout: opts?.timeout,
          },
          opts?.signal,
        );
        return typeof v === "string" && options.includes(v) ? v : undefined;
      },
      confirm: async (title, message, opts) =>
        (await this.ask(
          {
            kind: "confirm",
            title,
            message,
            timeout: opts?.timeout,
          },
          opts?.signal,
        )) === true,
      input: async (title, placeholder, opts) => {
        const v = await this.ask(
          {
            kind: "input",
            title,
            placeholder,
            timeout: opts?.timeout,
          },
          opts?.signal,
        );
        return typeof v === "string" ? v : undefined;
      },
      editor: async (title, prefill) => {
        const v = await this.ask({ kind: "editor", title, prefill });
        return typeof v === "string" ? v : undefined;
      },
      notify: (message, type) => this.notice(message, type),
      setStatus: (key, value) => {
        if (value === undefined) {
          delete this.statuses[key];
          this.footerStatuses.delete(key);
        } else {
          this.statuses[key] = value;
          this.footerStatuses.set(key, value);
        }
        this.publish();
      },
      setWidget: (key, content, options) => {
        const id = `widget:${key}`;
        this.desktopUI.close(id);
        delete this.widgets[key];
        this.widgetPlacements[key] = options?.placement ?? "aboveEditor";
        this.desktopUI.terminalRuntime
          .capture()
          .application?.content.setWidget(
            key,
            Array.isArray(content) ? content : undefined,
            this.widgetPlacements[key],
            typeof content === "function",
          );
        if (Array.isArray(content)) this.widgets[key] = content.slice();
        else if (content)
          void this.desktopUI
            .mount(content, this.widgetPlacements[key], id)
            .catch((error) => this.notice(errorMessage(error), "error"));
        else delete this.widgetPlacements[key];
        this.publish();
      },
      setTitle: (title) => this.setWindowTitle(title),
      setEditorText: (text) => {
        this.rememberEditorText(text);
        this.editorSelection = { start: text.length, end: text.length };
        this.desktopUI.setEditorText(text);
        this.emitEvent({
          type: "editor",
          text,
          selection: this.editorSelection,
        });
      },
      pasteToEditor: (text) => {
        if (this.desktopUI.pasteEditorText(text)) {
          this.rememberEditorText(this.desktopUI.getEditorText()!);
          this.editorSelection = this.desktopUI.getEditorSelection();
        } else {
          const current = this.desktopUI.getEditorText() ?? this.editorText;
          const start = Math.min(
            current.length,
            Math.max(0, this.editorSelection?.start ?? current.length),
          );
          const end = Math.min(
            current.length,
            Math.max(start, this.editorSelection?.end ?? start),
          );
          this.rememberEditorText(
            current.slice(0, start) + text + current.slice(end),
          );
          this.editorSelection = {
            start: start + text.length,
            end: start + text.length,
          };
          this.desktopUI.setEditorText(this.editorText);
        }
        this.emitEvent({
          type: "editor",
          text: this.editorText,
          selection: this.editorSelection,
        });
      },
      getEditorText: () => this.desktopUI.getEditorText() ?? this.editorText,
      custom: (factory, options) => {
        const id = randomUUID();
        return this.authorizations.run(
          this.sessionLifetime.signal,
          (scope) =>
            this.desktopUI.custom(factory, options, scope.signal, {
              id,
              beforeClose: () => this.authorizations.cancel(scope),
            }),
          () => this.desktopUI.cancelInput(id),
          (url) => this.desktopUI.presentsLink(id, url),
        );
      },
      onTerminalInput: (handler) => {
        const subscription = {
          handler,
          unsubscribe: this.desktopUI.terminalInput.capture().add(handler),
        };
        this.inputListeners.add(subscription);
        this.refreshSoon();
        return () => {
          this.inputListeners.delete(subscription);
          subscription.unsubscribe();
          this.refreshSoon();
        };
      },
      setWorkingMessage: (message) => {
        this.workingMessage = message;
        this.statuses.working = message ?? "";
        this.publish();
      },
      setWorkingVisible: (visible) => {
        this.workingVisible = visible;
        this.publish();
      },
      setWorkingIndicator: (options) => {
        this.workingIndicator = options;
        this.publish();
      },
      setHiddenThinkingLabel: (label) => {
        this.hiddenThinkingLabel = label;
        this.publish();
      },
      setFooter: (factory) => {
        this.footerFactory = factory;
        this.desktopUI.close("footer");
        if (factory)
          void this.desktopUI
            .mount(factory, "footer", "footer")
            .catch((error) => this.notice(errorMessage(error), "error"));
      },
      setHeader: (factory) => {
        this.headerFactory = factory;
        this.desktopUI.close("header");
        if (factory)
          void this.desktopUI
            .mount(factory, "header", "header")
            .catch((error) => this.notice(errorMessage(error), "error"));
      },
      addAutocompleteProvider: (factory) => {
        this.autocompleteWrappers.push(factory);
        this.setupAutocomplete();
      },
      setEditorComponent: (factory) => {
        const mountRevision = ++this.editorMountRevision;
        this.rememberEditorText(
          this.desktopUI.getEditorText() ?? this.editorText,
        );
        this.desktopUI.close("editor");
        this.editorFactory = factory;
        this.editorMount = this.desktopUI
          .mount(factory ?? this.defaultEditorSource, "editor", "editor")
          .then(() => {
            if (
              this.runtime?.session === session &&
              this.editorMountRevision === mountRevision
            )
              this.desktopUI.setEditorText(this.editorText);
          })
          .catch((error) => this.notice(errorMessage(error), "error"));
      },
      getEditorComponent: () => this.editorFactory,
      theme: themeProxy,
      getAllThemes: () => {
        const themes = new Map(
          builtinThemes.map((theme) => [theme.name, theme]),
        );
        for (const theme of this.session.resourceLoader.getThemes().themes)
          if (theme.name && !themes.has(theme.name))
            themes.set(theme.name, {
              name: theme.name,
              path: theme.sourcePath,
            });
        return [...themes.values()].sort((a, b) =>
          a.name === "system"
            ? -1
            : b.name === "system"
              ? 1
              : a.name.localeCompare(b.name),
        );
      },
      getTheme,
      setTheme: (value) => {
        if (value === "system") {
          themeAPI.setTerminalColors({});
          themeAPI.setTerminalColorScheme(this.desktopAppearance);
        }
        const selected =
          typeof value === "string"
            ? getTheme(value)
            : this.themeProxies.has(value)
              ? this.theme!
              : value;
        const theme = selected ?? getTheme("system")!;
        selection = typeof value === "string" ? value : undefined;
        followsSystem = value === "system";
        this.stopThemeWatch?.();
        if (typeof value === "string" && selected)
          applyNamedTheme(value, theme);
        else applyTheme(theme);
        if (!selected) {
          publishTheme();
          return { success: false, error: `Theme does not exist: ${value}` };
        }
        invocationTheme.activeThemeName =
          typeof value === "string" ? value : "<in-memory>";
        if (typeof value === "string")
          invocationTheme.currentThemeSetting = value;
        if (
          typeof value === "string" &&
          this.session.settingsManager.getTheme() !== value
        )
          this.session.settingsManager.setTheme(value);
        publishTheme();
        return { success: true };
      },
      getToolsExpanded: () => this.expanded,
      setToolsExpanded: (expanded) => {
        if (expanded === this.expanded) return;
        this.expanded = expanded;
        this.toolExpansions.clear();
        this.emitEvent({
          type: "activity",
          name: "tools_expanded",
          data: expanded,
        });
        this.publish();
      },
    };
  }
  setToolExpanded(id: string, expanded: boolean) {
    if ((this.toolExpansions.get(id) ?? this.expanded) === expanded) return;
    this.toolExpansions.set(id, expanded);
    this.publish();
  }
  snapshot(): DesktopSnapshot {
    const revision = ++this.snapshotRevision;
    const session = this.session;
    if (
      this.workspaceDraft === session.sessionManager &&
      session.sessionFile &&
      existsSync(session.sessionFile)
    ) {
      this.workspaceDraft = undefined;
      rememberDesktopSession(this.agentDir, session.sessionManager);
    }
    const services = this.runtime!.services;
    const models = services.modelRuntime.getModels();
    const available = new Set(
      services.modelRuntime
        .getAvailableSnapshot()
        .map((m) => `${m.provider}/${m.id}`),
    );
    const modelView = (m: (typeof models)[number]) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow,
      reasoning: m.reasoning,
      available: available.has(`${m.provider}/${m.id}`),
    });
    const entries = session.sessionManager.getEntries();
    const completedAt = new Map(entries.map((entry) => [entry.id, entry.timestamp]));
    const projection = session.sessionManager.buildSessionProjection();
    const ids = new Map<string, string[]>();
    for (const entry of projection.entries)
      for (const message of entry.messages) {
        const key = JSON.stringify(message);
        const matches = ids.get(key) ?? [];
        matches.push(entry.sourceEntry.id);
        ids.set(key, matches);
      }
    const rendererMessages = new Map<
      string,
      AgentSession["messages"][number]
    >();
    const currentMessages = session.messages
      .filter(
        (m) =>
          record(m).role !== "system" &&
          !(record(m).role === "custom" && record(m).display === false),
      )
      .map((m, index) => {
        const view = messageView(
          m,
          `${session.sessionId}-${index}`,
          ids.get(JSON.stringify(m))?.shift(),
        );
        if (m.role === "assistant")
          view.completionNotice = this.transcriptMarkdown?.completionNotice(m);
        if (m.role === "assistant")
          view.generation = this.generation.get(session.sessionId, m.timestamp)
            ?? recordedGeneration(m.timestamp, completedAt.get(view.entryId ?? ""), view.outputTokens);
        rendererMessages.set(view.id, m);
        return view;
      });
    const notices =
      this.desktopUI.terminalRuntime.capture().application?.conversationNotices;
    const messages =
      notices?.order(currentMessages, projection) ?? currentMessages;
    const streaming = this.streaming
      ? structuredClone(this.streaming)
      : undefined;
    if (streaming) streaming.generation = this.generation.get(session.sessionId, streaming.timestamp);
    connectRenderers(
      session,
      this.desktopUI,
      messages,
      streaming,
      this.activeTools.map((tool) => ({
        ...tool,
        result: this.toolResults.get(tool.id),
      })),
      this.expanded,
      this.toolRenderPhases,
      rendererMessages,
      this.toolExpansions,
    );
    const visibleCalls = new Set(
      messages
        .concat(streaming ?? [])
        .flatMap((message) =>
          message.content.flatMap((block) =>
            block.type === "toolCall" && block.id ? [block.id] : [],
          ),
        ),
    );
    this.activeTools.forEach((tool) => visibleCalls.add(tool.id));
    for (const id of this.toolRenderPhases.keys())
      if (!visibleCalls.has(id)) this.toolRenderPhases.delete(id);
    for (const id of this.toolExpansions.keys())
      if (!visibleCalls.has(id)) this.toolExpansions.delete(id);
    if (this.theme)
      this.transcriptMarkdown?.render(
        session,
        this.theme,
        messages,
        streaming,
        this.renderWidth,
        this.transcriptLayout?.sessionId === session.sessionId
          ? this.transcriptLayout
          : undefined,
      );
    const tree: TreeItem[] = entries.map((e) => ({
      id: e.id,
      parentId: e.parentId,
      type: e.type,
      timestamp: e.timestamp,
      role: e.type === "message" ? text(record(e.message).role) : undefined,
      label: session.sessionManager.getLabel(e.id),
      text:
        e.type === "message"
          ? messageView(e.message, e.id)
              .content.map((b) => b.text ?? b.thinking ?? b.name ?? "")
              .join(" ")
              .slice(0, 140)
          : e.type === "compaction" || e.type === "branch_summary"
            ? e.summary.slice(0, 140)
            : e.type,
    }));
    const loader = session.resourceLoader;
    const extensions = loader.getExtensions();
    const resources = [
      ...extensions.extensions.map((e) => ({
        kind: "extension",
        name: e.path.split(/[\\/]/).pop() ?? e.path,
        path: e.path,
      })),
      ...loader.getSkills().skills.map((s) => ({
        kind: "skill",
        name: s.name,
        path: s.filePath,
        description: s.description,
      })),
      ...loader.getPrompts().prompts.map((p) => ({
        kind: "prompt",
        name: p.name,
        path: p.filePath,
        description: p.description,
      })),
      ...loader.getAgentsFiles().agentsFiles.map((a) => ({
        kind: "context",
        name: a.path.split(/[\\/]/).pop() ?? a.path,
        path: a.path,
      })),
    ];
    const nativeRuntime = this.desktopUI.terminalRuntime.capture();
    const application = nativeRuntime.application;
    application?.syncFooter();
    application?.conversationNotices.sync(
      messages.flatMap((message) => {
        const original = rendererMessages.get(message.id);
        return original
          ? [{ id: message.id, entryId: message.entryId, message: original }]
          : [];
      }),
      projection,
    );
    const nativeMessageIds = new Map<string, string>();
    const nativeEntryOccurrences = new Map<string, number>();
    const nativeMessages =
      application?.syncMessages(
        messages
          .filter((message) => !message.desktopSurfaceId)
          .flatMap((message) => {
            const original = rendererMessages.get(message.id);
            if (!original) return [];
            const occurrence =
              nativeEntryOccurrences.get(message.entryId ?? "") ?? 0;
            if (message.entryId)
              nativeEntryOccurrences.set(message.entryId, occurrence + 1);
            const id = message.entryId
              ? `${message.entryId}:${occurrence}`
              : message.id;
            nativeMessageIds.set(message.id, id);
            return [{ id, message: original }];
          }),
        streaming,
        this.expanded,
        this.hiddenThinkingLabel,
      ) ?? [];
    const orderedNativeMessages = messages
      .concat(streaming ?? [])
      .flatMap((message) => {
        const id = nativeMessageIds.get(message.id) ?? message.id;
        const components = nativeMessages.filter((entry) =>
          entry.id.startsWith(`${id}:`),
        );
        const surfaceIds = [
          message.desktopSurfaceId,
          ...message.content.map((block) => block.desktopSurfaceId),
        ];
        for (const surfaceId of surfaceIds) {
          const toolId = surfaceId?.startsWith("render:call:")
            ? surfaceId.slice("render:call:".length)
            : surfaceId?.startsWith("render:result:")
              ? surfaceId.slice("render:result:".length)
              : undefined;
          const row = toolId && application?.tools.get(toolId)?.original;
          if (row) {
            if (surfaceId!.startsWith("render:call:"))
              components.push({ id: `native-tool:${toolId}`, component: row });
            continue;
          }
          const component =
            surfaceId && this.desktopUI.nativeComponent(surfaceId);
          if (surfaceId && component)
            components.push({ id: surfaceId, component });
        }
        const original = rendererMessages.get(message.id);
        if (original)
          components.push(
            ...(application?.conversationNotices.entries(message.id) ?? []),
            ...(application?.noticeEntries(
              session.messages.indexOf(original) + 1,
              original,
            ) ?? []),
          );
        return components;
      });
    nativeRuntime.updateApplication({
      header:
        application?.content.headerEntries(
          this.headerFactory
            ? this.desktopUI.nativeComponent("header")
            : undefined,
          this.expanded,
        ) ?? [],
      resources: application?.content.resourceEntries(this.expanded) ?? [],
      message: [
        ...(application?.noticeEntries(0) ?? []),
        ...(application?.conversationNotices.entries() ?? []),
        ...orderedNativeMessages,
        ...this.activeTools.flatMap((tool) => {
          const component = application?.tools.get(tool.id)?.original;
          return component &&
            !orderedNativeMessages.some(
              (entry) => entry.component === component,
            )
            ? [{ id: `native-tool:${tool.id}`, component }]
            : [];
        }),
        ...(application?.bash.entries(false) ?? []),
      ],
      pending: [
        ...(application?.bash.entries(true) ?? []),
        ...(application?.content.pendingEntries() ?? []),
      ],
      status:
        application?.syncStatus(this.desktopUI.nativeComponent("editor"), {
          visible: this.workingVisible,
          message: this.workingMessage,
          indicator: this.workingIndicator,
        }) ?? [],
      aboveEditor: application?.content.widgetEntries("aboveEditor") ?? [],
      belowEditor: application?.content.widgetEntries("belowEditor") ?? [],
      footer: this.footerFactory
        ? []
        : application
          ? [{ id: "default", component: application.footer }]
          : [],
    });
    const stats = session.getSessionStats();
    return {
      backendId: this.backendId,
      revision,
      version: VERSION,
      managedTools: this.managedTools.snapshot(),
      startup: this.startup.snapshot(),
      startupPolicies: this.startupPolicies.snapshot(),
      cwd: this.runtime!.cwd,
      agentDir: this.agentDir,
      sessionId: session.sessionId,
      sessionFile:
        this.workspaceDraft === session.sessionManager
          ? undefined
          : session.sessionFile,
      sessionName: session.sessionName,
      running: !session.isIdle || session.isBashRunning || this.inflightPrompts > 0,
      busy:
        !session.isIdle ||
        session.isBashRunning ||
        this.inflightPrompts > 0 ||
        this.changing,
      changing: this.changing,
      compacting: session.isCompacting,
      retrying: session.isRetrying,
      model: session.model ? modelView(session.model) : undefined,
      thinking: session.thinkingLevel,
      thinkingLevels: session.getAvailableThinkingLevels(),
      models: models.map(modelView),
      conversationNotices: application?.conversationNotices.presentation(
        this.renderWidth,
      ),
      messages,
      streaming,
      activeTools: this.activeTools.map((tool) => ({
        ...tool,
        toolRenderShell: session.getToolDefinition(tool.name)?.renderShell,
        toolPresentation: describeTool(
          session,
          tool.id,
          tool.name,
          this.toolExpansions.get(tool.id) ?? this.expanded,
          {
            isPartial: true,
            isError: this.toolRenderPhases.get(tool.id)?.isError ?? false,
          },
          this.toolResults.has(tool.id),
        ),
        output:
          tool.output && this.transcriptMarkdown
            ? this.transcriptMarkdown.toolOutput(tool.output)
            : tool.output,
      })),
      tools: session.getAllTools().map((t) => ({
        name: t.name,
        description: t.description,
        active: session.getActiveToolNames().includes(t.name),
        exposure: t.exposure ?? "direct",
        parameters: t.parameters,
      })),
      resources,
      diagnostics: [
        ...extensions.errors.map((e) => `${e.path}: ${e.error}`),
        ...loader.getSkills().diagnostics.map((d) => d.message),
        ...loader.getPrompts().diagnostics.map((d) => d.message),
        ...this.runtime!.diagnostics.map((d) => d.message),
      ],
      commands:
        session.extensionRunner?.getRegisteredCommands().map((c) => ({
          name: c.invocationName,
          description: c.description,
          source: "extension",
        })) ?? [],
      providers: services.modelRuntime.getProviders().map((p) => {
        const status = services.modelRuntime.getProviderAuthStatus(p.id);
        return {
          id: p.id,
          name: p.name ?? p.id,
          configured: status.configured,
          source: status.source,
          methods: Object.keys(p.auth ?? {}).filter((k) =>
            ["apiKey", "oauth"].includes(k),
          ),
        };
      }),
      settings: record(services.settingsManager.getSettings()),
      toolImages: {
        visible: session.settingsManager.getShowImages(),
        widthCells: session.settingsManager.getImageWidthCells(),
      },
      editor: {
        text: this.desktopUI.getEditorText() ?? this.editorText,
        revision: this.editorRevision + this.desktopUI.editorVersion,
      },
      globalSettings: record(services.settingsManager.getGlobalSettings()),
      projectSettings: record(services.settingsManager.getProjectSettings()),
      queue: {
        steering: [...session.getSteeringMessages()],
        followUp: [...session.getFollowUpMessages()],
      },
      tree,
      leafId: session.sessionManager.getLeafId(),
      stats: {
        tokens: stats.tokens,
        cost: stats.cost,
        toolCalls: stats.toolCalls,
        contextUsage: session.getContextUsage(),
      },
      statuses: this.statuses,
      widgets: this.widgets,
      scopedModels: session.scopedModels.map(
        (m) => `${m.model.provider}/${m.model.id}`,
      ),
      trusted: services.settingsManager.isProjectTrusted(),
      recentWorkspaces: this.recentWorkspaces,
      desktopSurfaces: this.desktopUI.surfaces,
      widgetPlacements: this.widgetPlacements,
      widgetOrder: application?.content.widgetOrder(),
      extensionUI: {
        textPresentation: {
          ...(this.hiddenThinkingLabel !== undefined
            ? {
                hiddenThinkingLabel: this.componentTextApi
                  ? componentText(
                      this.hiddenThinkingLabel,
                      this.componentTextApi,
                    )
                  : { text: this.hiddenThinkingLabel },
              }
            : {}),
          ...(this.workingIndicator?.frames
            ? {
                workingFrames: this.workingIndicator.frames.map((value) =>
                  this.componentTextApi
                    ? componentText(value, this.componentTextApi)
                    : { text: value },
                ),
              }
            : {}),
          statuses: Object.fromEntries(
            Object.entries(this.statuses).map(([key, value]) => [
              key,
              this.componentTextApi
                ? componentText(value, this.componentTextApi)
                : { text: value },
            ]),
          ),
          widgets: Object.fromEntries(
            Object.entries(this.widgets).map(([key, lines]) => [
              key,
              application?.content.widgetPresentation(key, this.renderWidth) ??
                (this.componentTextApi
                  ? componentText(lines.join("\n"), this.componentTextApi)
                  : { text: lines.join("\n") }),
            ]),
          ),
        },
        windowTitle: this.windowTitle,
        windowProgress: this.windowProgressOwners.size > 0,
        inputListeners: this.inputListeners.size,
        shortcuts: [
          ...session.extensionRunner.getShortcuts(this.keybindings).keys(),
        ],
        theme: this.desktopTheme,
        workingVisible: this.workingVisible,
        workingMessage: this.workingMessage,
        workingIndicator: this.workingIndicator,
        hiddenThinkingLabel: this.hiddenThinkingLabel,
      },
      bashRunning: session.isBashRunning,
      hasPendingBashMessages: session.hasPendingBashMessages,
      cacheWarmingStatus: session.cacheWarmingStatus,
      routedModel: session.routedModel
        ? modelView(session.routedModel.model)
        : undefined,
    };
  }
  async action(request: ActionRequest): Promise<unknown> {
    if (this.shuttingDown || this.disposal) throw new Error("Pi 正在关闭");
    const mutations = new Set([
      "workspace.remove",
      "session.new",
      "session.switch",
      "session.delete",
      "session.fork",
      "session.clone",
      "session.navigate",
      "session.label",
      "session.import",
      "session.export",
      "model.set",
      "models.scope",
      "models.refresh",
      "tools.set",
      "compact",
      "resources.reload",
      "settings.save",
      "trust.set",
      "packages.install",
      "packages.remove",
      "packages.update",
      "config.save",
      "mcp.command",
      "mcp.status",
      "context.refresh",
      "context.edit",
      "model.cycle",
      "thinking.cycle",
      "bash.record",
    ]);
    if (!mutations.has(request.action)) {
      if (
        this.changing &&
        ["prompt", "auth.login", "bash"].includes(request.action)
      )
        throw new Error("配置正在更新，请稍后重试");
      return this.perform(request);
    }
    if (this.changing) throw new Error("另一项操作正在进行，请稍后重试");
    if (this.runtime) this.idle();
    else if (this.authAbort) throw new Error("已有登录流程正在进行");
    this.changing = true;
    this.publish();
    let result: unknown;
    try {
      result = await this.runtimeLifecycle.track(() =>
        Promise.resolve().then(() => this.perform(request)),
      );
    } finally {
      this.changing = false;
      this.publish();
    }
    return result && typeof result === "object" && "sessionId" in result
      ? this.snapshot()
      : result;
  }
  private async perform(request: ActionRequest): Promise<unknown> {
    const a = request.args ?? {};
    if (request.action === "fonts.list") return listSystemFonts(a.refresh === true);
    if (request.action === "settings.snapshot" && this.runtime) return this.snapshot();
    if (!this.runtime && globalSettingsActions.has(request.action)) {
      this.globalSettings ??= new GlobalSettings(this.agentDir, this.hostLifetime.signal,
        (models, settings, args) => this.login(models, settings, args, this.hostLifetime.signal),
        message => this.notice(message));
      return this.globalSettings.action(request);
    }
    if (request.action === "transcript.layout") {
      const session = this.runtime?.session;
      if (
        this.changing ||
        !session ||
        a.backendId !== this.backendId ||
        a.sessionId !== session.sessionId
      )
        return { accepted: false };
      const widths = record(a.widths);
      if (
        ![widths.text, widths.thinking].every(
          (width) =>
            typeof width === "number" &&
            Number.isInteger(width) &&
            width >= 1 &&
            width <= 10000,
        ) || (widths.user !== undefined && (typeof widths.user !== "number" || !Number.isInteger(widths.user) || widths.user < 1 || widths.user > 10000)) ||
        Object.values(record(widths.users)).some(value => typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10000)
      )
        return { accepted: false };
      const next = {
        sessionId: session.sessionId,
        text: widths.text as number,
        thinking: widths.thinking as number,
        user: widths.user as number | undefined,
        users: widths.users as Record<string, number> | undefined,
      };
      if (
        this.transcriptLayout?.sessionId !== next.sessionId ||
        this.transcriptLayout.text !== next.text ||
        this.transcriptLayout.thinking !== next.thinking ||
        this.transcriptLayout.user !== next.user ||
        JSON.stringify(this.transcriptLayout.users) !== JSON.stringify(next.users)
      ) {
        this.transcriptLayout = next;
        this.publish();
      }
      return { accepted: true };
    }
    if (request.action === "terminal.effect") {
      await this.applyTerminalEffect(parseTerminalEffect(a.effect));
      return null;
    }
    if (request.action === "terminal.query.list")
      return this.terminalQueries.requests;
    if (request.action === "terminal.query.reply")
      return this.terminalQueries.reply(required(a.id, "Query ID"), a.data);
    if (request.action === "desktop.appearance") {
      if (a.appearance !== "light" && a.appearance !== "dark")
        throw new Error("Invalid desktop appearance");
      this.updateDesktopAppearance(a.appearance);
      return this.runtime ? this.snapshot() : null;
    }
    if (request.action === "initialize") {
      if (a.appearance === "light" || a.appearance === "dark") {
        this.updateDesktopAppearance(a.appearance);
      }
      if (a.resumeExisting === true && this.runtime) return this.snapshot();
      const cwd = a.cwd ?? process.env.PI_DESKTOP_CWD;
      // Launching the host from a directory does not select that workspace.
      if (cwd === undefined || cwd === "") return null;
      return this.initialize(
        required(cwd, "工作目录"),
        a.startup === undefined ? undefined : startupOptions(a.startup),
      );
    }
    if (request.action === "workspace.add") {
      const cwd = resolve(required(a.cwd, "工作区路径"));
      if (!(await stat(cwd)).isDirectory()) throw new Error("工作区不是文件夹");
      await this.rememberWorkspace(cwd);
      this.publish();
      return this.runtime ? this.snapshot() : { cwd };
    }
    if (request.action === "workspaces.list") {
      await this.readWorkspacePreferences();
      return this.recentWorkspaces;
    }
    if (request.action === "workspace.remove") {
      const cwd = resolve(required(a.cwd, "工作区路径"));
      const current = this.runtime?.cwd;
      await this.rememberWorkspace(cwd, true);
      if (current === cwd) {
        let next: string | undefined;
        for (const workspace of this.recentWorkspaces) {
          if (await stat(workspace).then((info) => info.isDirectory(), () => false)) {
            next = workspace;
            break;
          }
        }
        if (next) return this.initializeWorkspace(next, {});
        await this.closeWorkspaceRuntime();
        this.emitEvent({ type: "workspace_closed", workspaces: this.recentWorkspaces });
        return null;
      }
      this.publish();
      return this.runtime ? this.snapshot() : null;
    }
    if (request.action === "folders.list")
      return browseDirectories(text(a.path), a.showDot === true);
    if (request.action === "folders.create")
      return createDirectory(required(a.path, "父目录"), required(a.name, "文件夹名称"));
    if (request.action === "managed-tools.inspect")
      return this.managedTools.snapshot();
    if (request.action === "startup.inspect") return this.startup.snapshot();
    if (request.action === "startup-policy.inspect")
      return this.startupPolicies.snapshot();
    if (request.action === "startup-policy.run") {
      if (!startupPolicyNames.includes(a.name as StartupPolicyName))
        throw new Error("Invalid startup policy");
      return this.sdkOperation(
        typeof a.id === "string" ? a.id : randomUUID(),
        (signal) =>
          this.startupPolicies.runTransport(
            a.name as StartupPolicyName,
            signal,
          ),
      );
    }
    if (request.action === "crash.read")
      return this.startupPolicies.readCrashes();
    if (request.action === "crash.take") {
      if (
        a.now !== undefined &&
        (typeof a.now !== "number" || !Number.isFinite(a.now))
      )
        throw new Error("Invalid crash timestamp");
      return this.startupPolicies.takeCrash(
        a.display === true,
        a.now as number | undefined,
      );
    }
    if (request.action === "crash.clear") {
      await this.startupPolicies.clearCrashes();
      return null;
    }
    if (request.action === "crash.record" || request.action === "crash.hint") {
      let error = a.error;
      if (a.message !== undefined) {
        if (
          typeof a.message !== "string" ||
          (a.stack !== undefined && typeof a.stack !== "string")
        )
          throw new Error("Invalid crash error");
        const native = new Error(a.message);
        if (typeof a.stack === "string") native.stack = a.stack;
        error = native;
      }
      if (request.action === "crash.hint")
        return this.startupPolicies.crashHint(error);
      if (a.kind !== "fatal_error" && a.kind !== "uncaught_exception")
        throw new Error("Invalid crash kind");
      return this.startupPolicies.recordCrash(a.kind, error);
    }
    if (request.action === "crash.instructions")
      return this.startupPolicies.crashInstructions();
    if (request.action === "startup.run")
      return this.sdkOperation(
        typeof a.id === "string" ? a.id : randomUUID(),
        (signal) => this.startup.run(startupOptions(a.options ?? a), signal),
      );
    if (request.action === "startup.changelog") {
      if (a.kind !== undefined && a.kind !== "startup" && a.kind !== "full")
        throw new Error("Invalid changelog kind");
      const result = this.startup.changelog(
        a.kind as "startup" | "full" | undefined,
        a.display === true,
      );
      return {
        markdown: result.markdown,
        components: result.components.length,
      };
    }
    if (request.action === "managed-tools.path") {
      if (a.tool !== "fd" && a.tool !== "rg")
        throw new Error("Unknown managed tool");
      return this.managedTools.path(a.tool);
    }
    if (request.action === "managed-tools.prepare") {
      const runtime = this.runtime;
      const result = await this.managedTools.prepare({
        refresh: a.refresh === true,
      });
      if (runtime && this.runtime === runtime && !this.disposal)
        await this.refreshAutocomplete(
          () => this.runtime === runtime && !this.disposal,
        );
      this.publish();
      return result;
    }
    if (request.action === "dialog.list") return this.pendingDialogs;
    if (request.action === "dialog.answer") {
      this.answer(required(a.id, "请求 ID"), a.value);
      return null;
    }
    if (request.action === "auth.cancel") {
      if (typeof a.id === "string") {
        if (a.id === this.authId) this.authAbort?.abort();
        else this.authorizations.cancelById(a.id);
        return null;
      }
      this.authAbort?.abort();
      this.authorizations.cancel();
      return null;
    }
    if (request.action === "sdk.cancel") {
      this.sdkOperations.get(required(a.id, "Operation ID"))?.abort();
      return null;
    }
    if (
      request.action === "desktop.input" &&
      typeof a.dialogId === "string" &&
      this.dialogs.get(a.dialogId)?.sessionBound === false
    ) {
      const event = a.event as DesktopKeyEvent | undefined;
      let data =
        typeof a.data === "string"
          ? a.data
          : event
            ? encodeDesktopKey(event)
            : undefined;
      if (data === undefined) return { consume: false };
      const tui = await loadTuiApi();
      this.desktopUI.terminalInput.initialize(tui);
      const initial = data;
      const filtered = this.desktopUI.terminalInput.capture().run(data);
      if (filtered.consume) return { consume: true };
      data = filtered.data ?? data;
      if (tui.isKeyRelease(data)) return { consume: true };
      return (
        (await this.handleDialogInput(a, data, initial, tui, () => {
          this.expanded = !this.expanded;
          this.toolExpansions.clear();
        })) ?? {
          consume: false,
          data,
          keyId: tui.parseKey(data),
          changed: data !== initial,
        }
      );
    }
    if (request.action === "snapshot") return this.snapshot();
    if (request.action === "theme.set")
      return this.session.extensionRunner
        .getUIContext()
        .setTheme(required(a.theme, "Theme"));
    if (request.action === "theme.setting") {
      if (a.setting !== undefined && typeof a.setting !== "string")
        throw new Error("Invalid theme setting");
      this.setThemeSetting(a.setting as string | undefined);
      return null;
    }
    if (request.action === "editor.external.cancel") {
      if (!a.id || a.id === this.externalEditor?.id)
        this.externalEditor?.controller.abort();
      return null;
    }
    if (request.action === "editor.external.status")
      return { id: this.externalEditor?.id, running: !!this.externalEditor };
    if (request.action === "editor.external.result")
      return this.externalEditorResult ?? null;
    if (request.action === "editor.update") {
      if (
        typeof a.sessionId === "string" &&
        a.sessionId !== this.session.sessionId
      )
        return null;
      this.rememberEditorText(text(a.text));
      this.editorSelection = a.selection as DesktopSelection | undefined;
      this.desktopUI.setEditorText(this.editorText);
      if (this.editorSelection)
        this.desktopUI.setEditorSelection(this.editorSelection);
      return null;
    }
    if (request.action === "editor.restore") {
      if (
        a.sessionId === this.session.sessionId &&
        a.revision === this.editorRevision + this.desktopUI.editorVersion &&
        !this.session.extensionRunner.getUIContext().getEditorText()
      )
        this.session.extensionRunner.getUIContext().setEditorText(text(a.text));
      return this.snapshot();
    }
    if (request.action === "display.thinking") {
      const visible =
        a.visible === undefined
          ? this.session.settingsManager.getHideThinkingBlock()
          : a.visible === true;
      this.session.settingsManager.setHideThinkingBlock(!visible);
      this.transcriptMarkdown?.resetThinking();
      this.emitEvent({
        type: "activity",
        name: "thinking_visible",
        data: visible,
      });
      this.publish();
      return null;
    }
    if (request.action === "display.tools") {
      this.session.extensionRunner
        .getUIContext()
        .setToolsExpanded(a.expanded === true);
      return null;
    }
    const session = this.session;
    switch (request.action) {
      case "transcript.tool": {
        if (a.sessionId !== session.sessionId) return null;
        const snapshot = this.snapshot();
        const id = required(a.toolCallId, "Tool call ID");
        const hasCall =
          snapshot.messages.concat(snapshot.streaming ?? []).some(message =>
            message.content.some(block => block.type === "toolCall" && block.id === id)) ||
          snapshot.messages.some(
            (message) =>
              message.role === "toolResult" && message.toolCallId === id,
          ) ||
          snapshot.activeTools.some(
            (tool) => tool.id === id,
          );
        if (hasCall) this.setToolExpanded(id, a.expanded === true);
        return null;
      }
      case "transcript.thinking": {
        const message = this.snapshot()
          .messages.concat(this.streaming ?? [])
          .find((item) => item.id === a.messageId);
        const index = Number(a.blockIndex);
        if (
          message?.role === "assistant" &&
          message.content[index]?.type === "thinking"
        ) {
          this.transcriptMarkdown?.setThinkingVisible(
            message,
            index,
            a.visible === true,
          );
          this.publish();
        }
        return null;
      }
      case "model.select":
        return this.selectModel(a.persist === true);
      case "session.selector":
        return this.selectSession(text(a.kind), a);
      case "clipboard.paste":
        return this.pasteClipboard();
      case "clipboard.copy": {
        const content =
          typeof a.text === "string" ? a.text : session.getLastAssistantText();
        if (!content) {
          this.notice("没有可复制的回复", "info", true);
          return { copied: false };
        }
        const clipboard = this.clipboardOverride ?? (await systemClipboard());
        if (!clipboard?.setText)
          throw new Error("System clipboard is unavailable");
        await clipboard.setText(content);
        this.notice(typeof a.text === "string" ? "已复制文本" : "已复制回复", "info", true);
        return { copied: true };
      }
      case "editor.external":
        return this.editExternally(text(a.id) || randomUUID());
      case "dialog.external":
        return this.editDialogExternally(
          required(a.id, "Dialog ID"),
          text(a.text),
        );
      case "desktop.input": {
        if (
          typeof a.instanceId === "string" &&
          typeof a.surfaceId === "string" &&
          !this.desktopUI.isCurrent(a.surfaceId, a.instanceId)
        )
          return { consume: true };
        if (
          typeof a.sessionId === "string" &&
          a.sessionId !== session.sessionId
        )
          return { consume: true };
        const event = a.event as DesktopKeyEvent | undefined;
        let data =
          typeof a.data === "string"
            ? a.data
            : event
              ? encodeDesktopKey(event)
              : undefined;
        if (data === undefined) return { consume: false };
        const tui = await loadTuiApi();
        const initialRelease = tui.isKeyRelease(data);
        if (
          typeof a.editorText === "string" &&
          a.controlVersion === undefined &&
          !initialRelease
        ) {
          this.rememberEditorText(a.editorText);
          this.editorSelection = a.selection as DesktopSelection | undefined;
        }
        const initial = data;
        let componentEditor: DesktopInputResult["editor"];
        if (typeof a.dialogId === "string" || typeof a.surfaceId !== "string") {
          const filtered = this.desktopUI.terminalInput.capture().run(data);
          if (filtered.consume) return { consume: true };
          data = filtered.data ?? data;
        }
        if (typeof a.dialogId === "string") {
          if (tui.isKeyRelease(data)) return { consume: true };
          const result = await this.handleDialogInput(
            a,
            data,
            initial,
            tui,
            () => {
              session.extensionRunner
                .getUIContext()
                .setToolsExpanded(!this.expanded);
              this.publish();
            },
          );
          if (result) return result;
        }
        if (typeof a.surfaceId === "string") {
          const result = await this.desktopUI.input(
            a.surfaceId,
            data,
            event,
            initialRelease
              ? undefined
              : (a.selection as DesktopSelection | undefined),
            {
              controlAction:
                typeof a.controlAction === "string"
                  ? a.controlAction
                  : undefined,
              raw: a.raw === true,
              controlText:
                !initialRelease && typeof a.controlText === "string"
                  ? a.controlText
                  : undefined,
              controlVersion:
                typeof a.controlVersion === "number"
                  ? a.controlVersion
                  : undefined,
              autocompleteActive: a.autocompleteActive === true,
              editorText:
                !initialRelease && typeof a.editorText === "string"
                  ? a.editorText
                  : undefined,
              selection: initialRelease
                ? undefined
                : (a.selection as DesktopSelection | undefined),
              editorLayout: (initialRelease ? undefined : a.editorLayout) as
                | import("../shared/desktop-ui.ts").DesktopEditorLayout
                | undefined,
              instanceId:
                typeof a.instanceId === "string" ? a.instanceId : undefined,
            },
          );
          if (this.session !== session) return { consume: true };
          if (result.consume)
            return {
              consume: true,
              ...(result.editor ? { editor: result.editor } : {}),
            };
          if (result.data !== undefined) data = result.data;
          componentEditor = result.editor;
        }
        if (tui.isKeyRelease(data)) return { consume: true };
        return {
          consume: false,
          data,
          keyId: tui.parseKey(data),
          ...(tui.isKeyRepeat(data) ? { repeat: true } : {}),
          changed: data !== initial,
          ...(componentEditor ? { editor: componentEditor } : {}),
        };
      }
      case "desktop.viewport":
        this.renderWidth = Math.max(1, Number(a.width) || 120);
        this.desktopUI.setViewport(
          this.renderWidth,
          Math.max(1, Number(a.height) || 40),
        );
        return null;
      case "desktop.focus":
        this.desktopUI.focus(
          required(a.id, "Component ID"),
          typeof a.expectedRevision === "number"
            ? a.expectedRevision
            : undefined,
          typeof a.controlAction === "string" &&
            typeof a.instanceId === "string"
            ? { action: a.controlAction, instanceId: a.instanceId }
            : undefined,
        );
        return null;
      case "desktop.overlay.measure":
        return this.desktopUI.measureOverlay(
          required(a.id, "Component ID"),
          required(a.instanceId, "Component instance"),
          required(a.layoutKey, "Overlay layout"),
          Number(a.height),
        );
      case "desktop.key":
        return this.desktopUI.key(
          required(a.id, "Component ID"),
          a.event as import("../shared/desktop-ui.ts").DesktopKeyEvent,
        );
      case "autocomplete.suggest":
        return this.sdkOperation(
          required(a.id, "Completion request ID"),
          (signal) =>
            this.autocomplete!.getSuggestions(
              a.lines as string[],
              Number(a.line),
              Number(a.column),
              { signal, force: a.force === true },
            ),
        );
      case "autocomplete.apply":
        return this.autocomplete!.applyCompletion(
          a.lines as string[],
          Number(a.line),
          Number(a.column),
          a.item as Parameters<
            DesktopAutocompleteProvider["applyCompletion"]
          >[3],
          text(a.prefix),
        );
      case "desktop.mouse":
        return this.desktopUI.mouse(
          required(a.id, "Component ID"),
          required(a.action, "Component action"),
          a.event as import("../shared/desktop-ui.ts").DesktopMouseEvent,
          typeof a.instanceId === "string" ? a.instanceId : undefined,
        );
      case "desktop.action": {
        const view = await this.desktopUI.action(
          required(a.id, "Component ID"),
          {
            action: required(a.action, "Component action"),
            value: a.value,
          },
          typeof a.instanceId === "string" ? a.instanceId : undefined,
        );
        if (a.id === "editor" && view !== undefined) {
          const editorText = this.desktopUI.getEditorText();
          if (editorText !== undefined) {
            this.rememberEditorText(editorText);
            this.emitEvent({ type: "editor", text: editorText });
          }
        }
        return { view };
      }
      case "desktop.close":
        this.desktopUI.close(required(a.id, "Component ID"));
        return null;
      case "sdk.inspect":
        return {
          state: session.state,
          systemPrompt: session.systemPrompt,
          cacheWarmingStatus: session.cacheWarmingStatus,
          routedModel: session.routedModel,
          retryAttempt: session.retryAttempt,
          isIdle: session.isIdle,
          isStreaming: session.isStreaming,
          isBashRunning: session.isBashRunning,
          hasPendingBashMessages: session.hasPendingBashMessages,
          pendingMessageCount: session.pendingMessageCount,
          callableTools: session.getCallableToolNames(),
          entries: session.sessionManager.getEntries(),
          projection: session.sessionManager.buildSessionProjection(),
          scopedModels: session.scopedModels,
        };
      case "models.catalog":
        return session.modelRuntime.getAllModels(text(a.provider) || undefined);
      case "models.request": {
        const id = required(a.id, "Operation ID");
        return this.sdkOperation(id, (signal) =>
          runModelOperation(session.modelRuntime, a, signal, (event) =>
            this.emitEvent({
              type: "activity",
              name: `sdk:model:${id}`,
              data: event,
            }),
          ),
        );
      }
      case "sdk.run":
        // Import preparation can be cancelled without joining arbitrary module
        // top-level awaits; withSdk tracks the invoked callback after admission.
        return this.sdkOperation(
          text(a.id) || randomUUID(),
          async (signal) => {
            const runtime = this.runtime!;
            const path = resolve(required(a.path, "Module path"));
            const roots = [resolve(this.agentDir, "desktop")];
            if (session.settingsManager.isProjectTrusted())
              roots.push(resolve(runtime.cwd, ".pi", "desktop"));
            const { realpath } = await import("node:fs/promises");
            const actual = await realpath(path);
            const { relative, isAbsolute } = await import("node:path");
            let trusted = false;
            let projectModule = false;
            for (const root of roots) {
              try {
                const delta = relative(await realpath(root), actual);
                if (
                  delta &&
                  delta !== ".." &&
                  !delta.startsWith("..\\") &&
                  !delta.startsWith("../") &&
                  !isAbsolute(delta)
                ) {
                  trusted = true;
                  projectModule = root !== roots[0];
                  break;
                }
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                  throw error;
              }
            }
            if (!trusted || !/\.(mjs|js)$/.test(actual))
              throw new Error(
                "SDK module must be inside a trusted desktop module directory",
              );
            const requireCurrent = () => {
              signal.throwIfAborted();
              if (
                this.runtime !== runtime ||
                this.session !== session ||
                (projectModule && !session.settingsManager.isProjectTrusted())
              )
                throw new DOMException(
                  "SDK module context changed during preparation",
                  "AbortError",
                );
            };
            requireCurrent();
            const module = await import(pathToFileURL(actual).href);
            if (typeof module.default !== "function")
              throw new Error(
                "SDK module must export a default operation function",
              );
            requireCurrent();
            return this.withSdk(module.default, record(a.args), signal);
          },
          false,
        );
      case "context.refresh":
        session.refreshContext();
        break;
      case "context.edit":
        session.sessionManager.appendContextEdit(
          required(a.id, "Entry ID"),
          a.replacement as Parameters<SessionManager["appendContextEdit"]>[1],
        );
        session.refreshContext();
        break;
      case "message.custom":
        await session.sendCustomMessage(
          {
            customType: required(a.customType, "Message type"),
            content: a.content as Parameters<
              AgentSession["sendCustomMessage"]
            >[0]["content"],
            display: a.display !== false,
            details: a.details,
          },
          record(a.options),
        );
        break;
      case "message.user":
        await session.sendUserMessage(
          a.content as Parameters<AgentSession["sendUserMessage"]>[0],
          record(a.options),
        );
        break;
      case "model.cycle":
        return session.cycleModel(
          a.direction === "backward" ? "backward" : "forward",
          { persist: a.persist === true },
        );
      case "thinking.cycle":
        return session.cycleThinkingLevel({ persist: a.persist === true });
      case "cache.mode": {
        const mode = required(a.mode, "Cache warming mode");
        if (!["off", "streaming", "idle"].includes(mode))
          throw new Error("Invalid cache warming mode");
        session.setCacheWarmingMode(
          mode as Parameters<AgentSession["setCacheWarmingMode"]>[0],
        );
        break;
      }
      case "cache.status":
        return session.cacheWarmingStatus;
      case "session.bugReport":
        return this.sdkOperation(text(a.id) || randomUUID(), (signal) =>
          session.summarizeForBugReport({
            hint: text(a.hint) || undefined,
            signal,
          }),
        );
      case "bash.abort":
        session.abortBash();
        break;
      case "bash.status":
        return {
          running: session.isBashRunning,
          pending: session.hasPendingBashMessages,
        };
      case "bash.record":
        session.recordBashResult(
          required(a.command, "Command"),
          a.result as Parameters<AgentSession["recordBashResult"]>[1],
          { excludeFromContext: a.exclude === true },
        );
        break;
      case "compact.abort":
        session.abortCompaction();
        break;
      case "summary.abort":
        session.abortBranchSummary();
        break;
      case "retry.abort":
        session.abortRetry();
        break;
      case "sessions.list":
        return a.all
          ? desktopSessionHistory(
              this.agentDir,
              this.runtime!.services.settingsManager.getSessionDir(),
            )
          : SessionManager.list(
              this.runtime!.cwd,
              session.sessionManager.getSessionDir(),
            );
      case "session.new":
        this.idle();
        if (typeof a.cwd === "string" && resolve(required(a.cwd, "工作区路径")) !== this.runtime!.cwd)
          return this.initializeWorkspace(a.cwd, {}, true);
        await this.runtime!.newSession();
        break;
      case "session.switch":
        this.idle();
        await this.runtime!.switchSession(required(a.path, "会话路径"));
        break;
      case "session.delete": {
        this.idle();
        const path = resolve(required(a.path, "会话路径"));
        const id = required(a.id, "会话 ID");
        const history = await desktopSessionHistory(
          this.agentDir,
          this.runtime!.services.settingsManager.getSessionDir(),
        );
        const target = history.find(
          (item) => item.id === id && resolve(item.path) === path,
        );
        if (!target) throw new Error("会话不存在或已被删除");
        if (session.sessionFile && resolve(session.sessionFile) === path) {
          const next = (await SessionManager.list(
            this.runtime!.cwd,
            session.sessionManager.getSessionDir(),
          )).find((item) => resolve(item.path) !== path);
          // Detach from the file before deleting it. An empty workspace keeps
          // Pi's editor manager in memory until the user sends a message.
          const result = next
            ? await this.runtime!.switchSession(next.path)
            : await this.runtime!.newSession({
                setup: async (manager) => {
                  this.workspaceDraft = manager;
                },
              });
          if (result.cancelled)
            throw new Error("会话切换已取消，未删除会话");
        }
        await unlink(path);
        forgetDesktopSession(this.agentDir, id, target.path);
        this.editorDrafts.delete(id);
        break;
      }
      case "session.name":
        session.setSessionName(required(a.name, "会话名称"));
        break;
      case "session.fork":
        this.idle();
        {
          const result = await this.runtime!.fork(required(a.id, "节点 ID"));
          if (!result.cancelled && result.selectedText !== undefined)
            this.session.extensionRunner
              .getUIContext()
              .setEditorText(result.selectedText);
        }
        break;
      case "session.clone":
        this.idle();
        if (!session.sessionManager.getLeafId())
          throw new Error("当前会话为空");
        await this.runtime!.fork(session.sessionManager.getLeafId()!, {
          position: "at",
        });
        break;
      case "session.navigate":
        this.idle();
        {
          const result = await session.navigateTree(required(a.id, "节点 ID"), {
            summarize: a.summarize === true,
            customInstructions: text(a.instructions) || undefined,
            replaceInstructions: a.replaceInstructions === true,
            label: text(a.label) || undefined,
          });
          if (
            !result.cancelled &&
            result.editorText &&
            !session.extensionRunner.getUIContext().getEditorText().trim()
          )
            session.extensionRunner
              .getUIContext()
              .setEditorText(result.editorText);
        }
        break;
      case "session.label":
        this.idle();
        session.sessionManager.appendLabelChange(
          required(a.id, "节点 ID"),
          text(a.label) || undefined,
        );
        break;
      case "session.import":
        this.idle();
        await this.runtime!.importFromJsonl(required(a.path, "JSONL 路径"));
        break;
      case "session.export":
        this.idle();
        return a.format === "jsonl"
          ? session.exportToJsonl(text(a.path) || undefined)
          : session.exportToHtml(text(a.path) || undefined);
      case "prompt": {
        this.inflightPrompts++;
        this.publish();
        let accepted = false;
        try {
          const editorMessage =
            a.clearEditor === true
              ? this.desktopUI.expandEditorText(required(a.message, "消息"))
              : required(a.message, "消息");
          let message = editorMessage;
          const images = Array.isArray(a.images)
            ? a.images.map((i) => {
                const image = record(i);
                const mimeType = required(image.mimeType, "图片格式");
                if (!/^image\/(png|jpeg|webp|gif)$/.test(mimeType))
                  throw new Error("不支持的图片格式");
                return {
                  type: "image" as const,
                  data: required(image.data, "图片数据"),
                  mimeType,
                };
              })
            : [];
          const files = Array.isArray(a.files) ? a.files : [];
          if (files.length > 20) throw new Error("一次最多添加 20 个文件");
          for (const file of files) {
            const preview = await previewFile(
              this.runtime!.cwd,
              required(file, "附件路径"),
            );
            if (preview.image) {
              const match = /^data:([^;]+);base64,(.+)$/.exec(preview.image)!;
              images.push({
                type: "image",
                mimeType: match[1],
                data: match[2],
              });
            } else {
              if (preview.truncated) throw new Error(`附件过大：${file}`);
              message += `\n\nAttached file ${JSON.stringify(file)}:\n${preview.content}`;
            }
          }
          const streamingBehavior =
            a.mode === "followUp" ? ("followUp" as const) : ("steer" as const);
          this.desktopUI.addEditorHistory(editorMessage);
          if (a.clearEditor === true)
            session.extensionRunner.getUIContext().setEditorText("");
          void session
            .prompt(message, {
              images,
              streamingBehavior,
              source: "interactive",
            })
            .catch((error) => {
              this.notice(errorMessage(error), "error");
              this.publish();
            })
            .finally(() => {
              this.inflightPrompts--;
              this.publish();
            });
          accepted = true;
        } finally {
          if (!accepted) {
            this.inflightPrompts--;
            this.publish();
          }
        }
        break;
      }
      case "abort":
        this.authorizations.cancel();
        for (const surface of this.desktopUI.surfaces)
          if (surface.slot === "dialog") this.desktopUI.close(surface.id);
        session.abortBash();
        this.authAbort?.abort();
        for (const id of this.dialogs.keys()) this.answer(id, undefined);
        await session.abort();
        break;
      case "queue.clear":
        return session.clearQueue();
      case "queue.restore": {
        const queued = session.clearQueue();
        const messages = [...queued.steering, ...queued.followUp];
        const ui = session.extensionRunner.getUIContext();
        if (messages.length)
          ui.setEditorText(
            [messages.join("\n\n"), ui.getEditorText()]
              .filter((part) => part.trim())
              .join("\n\n"),
          );
        this.publish();
        if (a.abort === true) await this.perform({ action: "abort" });
        return { ...queued, count: messages.length, text: ui.getEditorText() };
      }
      case "model.set": {
        this.idle();
        const model = session.modelRuntime.getModel(
          required(a.provider, "提供商"),
          required(a.id, "模型"),
        );
        if (!model) throw new Error("模型不存在");
        await session.setModel(model, { persist: a.persist === true });
        break;
      }
      case "thinking.set": {
        const level = required(a.level, "思考等级");
        if (
          !session
            .getAvailableThinkingLevels()
            .includes(level as AgentSession["thinkingLevel"])
        )
          throw new Error("模型不支持该思考等级");
        session.setThinkingLevel(level as AgentSession["thinkingLevel"], {
          persist: a.persist === true,
        });
        break;
      }
      case "models.scope": {
        this.idle();
        const ids = Array.isArray(a.models)
          ? a.models.filter((m): m is string => typeof m === "string")
          : [];
        session.setScopedModels(
          session.modelRuntime
            .getModels()
            .filter((m) => ids.includes(`${m.provider}/${m.id}`))
            .map((model) => ({ model })),
        );
        this.runtime!.services.settingsManager.setEnabledModels(
          ids.length ? ids : undefined,
        );
        break;
      }
      case "models.refresh":
        this.idle();
        await session.modelRuntime.refresh();
        break;
      case "tools.set":
        this.idle();
        if (
          !Array.isArray(a.names) ||
          !a.names.every((n) => typeof n === "string")
        )
          throw new Error("工具名称格式错误");
        session.setActiveToolsByName(a.names);
        break;
      case "compact":
        this.idle();
        await session.compact(text(a.instructions) || undefined);
        break;
      case "resources.reload":
        this.idle();
        await this.reloadResources();
        break;
      case "settings.save": {
        this.idle();
        const scope = a.scope === "project" ? "project" : "global";
        if (
          scope === "project" &&
          !this.runtime!.services.settingsManager.isProjectTrusted()
        )
          throw new Error("请先信任此项目");
        const settings = record(a.settings);
        const path =
          scope === "project"
            ? join(this.runtime!.cwd, ".pi", "settings.json")
            : join(this.agentDir, "settings.json");
        await mkdir(resolve(path, ".."), { recursive: true });
        await writeFile(path, JSON.stringify(settings, null, 2));
        await this.runtime!.services.settingsManager.reload();
        if ("theme" in settings)
          this.setThemeSetting(session.settingsManager.getThemeSetting());
        await this.reloadResources();
        if ("tuiMode" in settings)
          this.desktopUI.terminalRuntime.capture().applySettings();
        break;
      }
      case "trust.set":
        this.idle();
        new ProjectTrustStore(this.agentDir).set(
          this.runtime!.cwd,
          a.trusted === true,
        );
        this.runtime!.services.settingsManager.setProjectTrusted(
          a.trusted === true,
        );
        this.projectTrustByCwd.set(this.runtime!.cwd, a.trusted === true);
        await this.reloadResources();
        break;
      case "files.list":
        return listFiles(this.runtime!.cwd, text(a.path), a.showExcluded === true);
      case "files.resolveLink": {
        const path = resolveFileLink(required(a.url, "文件链接"));
        if (a.mustExist === true) {
          try {
            await stat(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              throw new Error(`文件或文件夹不存在：${path}`);
            throw error;
          }
        }
        return { path };
      }
      case "files.read":
        return previewFile(this.runtime!.cwd, required(a.path, "文件路径"));
      case "git.changes":
        return gitChanges(this.runtime!.cwd);
      case "bash": {
        const command = required(a.command, "命令");
        if (
          (await this.ask({
            kind: "confirm",
            title: "执行命令？",
            desktopTitle: true,
            message: command,
          })) !== true
        )
          return null;
        const excludeFromContext = a.exclude === true;
        const intercepted = await session.extensionRunner.emitUserBash({
          type: "user_bash",
          command,
          excludeFromContext,
          cwd: this.runtime!.cwd,
        });
        if (intercepted?.result) {
          session.recordBashResult(command, intercepted.result, {
            excludeFromContext,
          });
          this.publish();
          return intercepted.result;
        }
        return session.executeBash(command, undefined, {
          excludeFromContext,
          operations: intercepted?.operations,
        });
      }
      case "auth.login":
        this.idle();
        await this.login(session.modelRuntime, session.settingsManager, a, this.sessionLifetime.signal);
        break;
      case "auth.logout":
        this.idle();
        await session.modelRuntime.logout(required(a.provider, "提供商"));
        break;
      case "mcp.command": {
        const lifetime = this.sessionLifetime;
        const name = required(a.name, "服务器名称");
        const operation = required(a.operation, "MCP 操作");
        if (
          !/^[a-zA-Z0-9_-]+$/.test(name) ||
          !["login", "logout", "reconnect"].includes(operation)
        )
          throw new Error("MCP 操作格式错误");
        await session.prompt(`/mcp ${operation} ${name}`);
        lifetime.signal.throwIfAborted();
        break;
      }
      case "mcp.status": {
        const lifetime = this.sessionLifetime;
        if (
          !session.extensionRunner
            ?.getRegisteredCommands()
            .some((c) => c.name === "mcp")
        )
          throw new Error("MCP 扩展未启用");
        const messages: string[] = [];
        const capture = (event: DesktopEvent) => {
          if (event.type === "notice") messages.push(event.message);
        };
        this.on("event", capture);
        try {
          await session.prompt("/mcp");
          lifetime.signal.throwIfAborted();
          return messages.join("\n");
        } finally {
          this.off("event", capture);
        }
      }
      case "packages.list":
        return this.packages().listConfiguredPackages();
      case "packages.install":
        this.idle();
        await this.packages().installAndPersist(required(a.source, "包地址"), {
          local: a.local === true,
        });
        await this.reloadResources();
        break;
      case "packages.remove":
        this.idle();
        await this.packages().removeAndPersist(required(a.source, "包地址"), {
          local: a.local === true,
        });
        await this.reloadResources();
        break;
      case "packages.update":
        this.idle();
        await this.packages().update(text(a.source) || undefined);
        await this.reloadResources();
        break;
      case "config.read": {
        const name = required(a.name, "配置文件");
        if (!["models.json", "mcp.json"].includes(name))
          throw new Error("配置文件不受支持");
        const path = join(
          a.local ? join(this.runtime!.cwd, ".pi") : this.agentDir,
          name,
        );
        try {
          return await readFile(path, "utf8");
        } catch (e) {
          if (record(e).code === "ENOENT") return "{}";
          throw e;
        }
      }
      case "config.save": {
        this.idle();
        const name = required(a.name, "配置文件");
        if (!["models.json", "mcp.json"].includes(name))
          throw new Error("配置文件不受支持");
        if (
          a.local &&
          !this.runtime!.services.settingsManager.isProjectTrusted()
        )
          throw new Error("请先信任此项目");
        const config = JSON.parse(required(a.content, "配置内容"));
        const directory = a.local
          ? join(this.runtime!.cwd, ".pi")
          : this.agentDir;
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, name), JSON.stringify(config, null, 2));
        await session.modelRuntime.refresh();
        await this.reloadResources();
        break;
      }
      default:
        throw new Error(`未知操作：${request.action}`);
    }
    await this.runtime!.services.settingsManager.flush();
    this.publish();
    return this.snapshot();
  }
  private async login(modelRuntime: ModelRuntime, settingsManager: SettingsManager, a: RecordValue, lifetime: AbortSignal) {
    if (this.authAbort) throw new Error("已有登录流程正在进行");
    const controller = new AbortController();
    const authorizationId = randomUUID();
    this.authId = authorizationId;
    const loginSignal = AbortSignal.any([
      controller.signal,
      lifetime,
    ]);
    this.authAbort = controller;
    try {
      await modelRuntime.login(
        required(a.provider, "提供商"),
        a.method === "api_key" ? "api_key" : "oauth",
        {
          signal: loginSignal,
          prompt: async (info) => {
            const signal = info.signal
              ? AbortSignal.any([info.signal, loginSignal])
              : loginSignal;
            const value = await this.ask(
              {
                kind: info.type === "select" ? "select" : "input",
                title: info.message,
                options:
                  info.type === "select"
                    ? info.options.map((option) => ({
                        value: option.id,
                        label: option.label,
                        description: option.description,
                      }))
                    : undefined,
                secret: info.type === "secret",
                placeholder:
                  "placeholder" in info ? info.placeholder : undefined,
              },
              signal,
              lifetime,
            );
            if (typeof value !== "string" || signal.aborted)
              throw new Error("登录已取消");
            if (
              info.type === "select" &&
              !info.options.some((option) => option.id === value)
            )
              throw new Error("登录选项无效");
            return value;
          },
          notify: (event) => {
            if (loginSignal.aborted) return;
            this.emitEvent({ type: "activity", name: "auth", data: event });
            if (loginSignal.aborted) return;
            if (event.type === "auth_url")
              this.emitEvent({
                type: "auth_url",
                id: authorizationId,
                url: event.url,
                message: event.instructions,
              });
            else if (event.type === "device_code")
              this.emitEvent({
                type: "auth_url",
                id: authorizationId,
                url: event.verificationUri,
                message: `授权码：${event.userCode}`,
                desktopCopy: true,
              });
            else this.notice(event.message);
          },
        },
        {
          getDeviceId: () => settingsManager.getOrCreateDeviceId(),
        },
      );
    } finally {
      if (this.authAbort === controller) {
        this.authAbort = undefined;
        this.authId = undefined;
      }
      this.emitEvent({
        type: "activity",
        name: "auth_complete",
        data: { id: authorizationId },
      });
    }
  }
  private packages() {
    const manager = new DefaultPackageManager({
      cwd: this.runtime!.cwd,
      agentDir: this.agentDir,
      settingsManager: this.runtime!.services.settingsManager,
      builtinExtensions: ["codemode", "tool_search", "mcp"],
    });
    manager.setProgressCallback((event) =>
      this.notice(event.message ?? `${event.action}: ${event.source}`),
    );
    return manager;
  }
  dispose(): Promise<void> {
    const transitions = this.runtimeLifecycle.close();
    if (this.disposal) return this.disposal;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    this.disposal = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    // Publish the shared promise before eager cancellation can invoke another
    // caller's cleanup. Every caller observes the same completion or error.
    this.hostLifetime.abort();
    void this.disposeResources(transitions).then(resolve, reject);
    return this.disposal;
  }
  private disposeRuntime(runtime: AgentSessionRuntime) {
    let disposal = this.runtimeDisposals.get(runtime);
    if (!disposal) {
      disposal = Promise.resolve()
        .then(() => runtime.dispose())
        .finally(() => {
          this.restoreRuntimeCallbacks.get(runtime)?.();
          this.restoreRuntimeCallbacks.delete(runtime);
        });
      this.runtimeDisposals.set(runtime, disposal);
    }
    return disposal;
  }
  private async disposeResources(transitions: Promise<void>) {
    this.sessionTitles.cancel();
    this.restoreSessionReload?.();
    this.restoreSessionPrompt?.();
    this.restoreSessionBash?.();
    this.stopThemeWatch?.();
    this.appearanceChanged = undefined;
    this.sessionLifetime.abort();
    clearTimeout(this.refreshTimer);
    this.terminalQueries.dispose();
    this.authAbort?.abort();
    this.externalEditor?.controller.abort();
    await this.externalEditor?.pending.catch(() => {});
    for (const controller of this.sdkOperations.values()) controller.abort();
    this.runtime?.session.abortBash();
    for (const id of this.dialogs.keys()) this.answer(id, undefined);
    await transitions;
    this.desktopUI.dispose();
    this.desktopAppearanceListeners.clear();
    this.clearInputListeners();
    await Promise.allSettled(
      [...this.dialogEditors.values()].map((operation) => operation.pending),
    );
    this.unsubscribe?.();
    try {
      if (this.runtime) await this.disposeRuntime(this.runtime);
    } finally {
      for (const restore of this.restoreRuntimeTransitions.values()) restore();
      this.restoreRuntimeTransitions.clear();
    }
    this.runtime = undefined;
  }
}
