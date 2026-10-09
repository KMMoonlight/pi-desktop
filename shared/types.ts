export type RecordValue = Record<string, unknown>;
export interface ManagedToolsSnapshot {
  state: "idle" | "preparing" | "settled" | "failed" | "closed";
  paths: { fd: string | null; rg: string | null };
  statuses: { tool: "fd" | "rg"; type: "info" | "warning"; message: string }[];
  error?: string;
}
export type StartupPolicyName =
  "catalogs" | "version" | "packages" | "tmux" | "subscription";
export interface StartupPoliciesSnapshot {
  automaticStarted: boolean;
  checks: Partial<
    Record<
      StartupPolicyName,
      {
        state: "running" | "settled" | "failed" | "retired";
        sessionId: string;
        result?: unknown;
        error?: string;
      }
    >
  >;
}
export interface StartupSnapshot {
  state: "idle" | "running" | "settled" | "retired";
  sessionId?: string;
  attempted: number;
  completed: number;
  errors: string[];
  changelog?: string;
}
export interface ToolPresentation {
  sessionId: string;
  shell: "default" | "self" | "generic";
  expanded: boolean;
  state: "pending" | "success" | "error";
  hasResult: boolean;
}
export interface TranscriptMarkdown {
  blockIndices: number[];
  source: string;
  blocks: import("./desktop-ui").DesktopMarkdownBlock[];
  visible?: boolean;
}
export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
  data?: string;
  mimeType?: string;
  desktopSurfaceId?: string;
  imageFallback?: string;
  toolRenderShell?: "default" | "self";
  toolPresentation?: ToolPresentation;
}
export interface ChatMessage {
  id: string;
  entryId?: string;
  role: string;
  content: ContentBlock[];
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  errorMessage?: string;
  stopReason?: string;
  details?: unknown;
  customType?: string;
  desktopSurfaceId?: string;
  markdown?: TranscriptMarkdown[];
  completionNotice?: import("./desktop-ui").DesktopMarkdownText;
  toolRenderShell?: "default" | "self";
  toolPresentation?: ToolPresentation;
  outputTokens?: number;
  generation?: GenerationMetrics;
}
export interface GenerationMetrics {
  outputTokens: number;
  durationMs?: number;
  elapsedMs?: number;
  tokensPerSecond?: number;
  estimatedTokensPerSecond?: number;
  completed: boolean;
}
export interface ModelItem {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  reasoning: boolean;
  available: boolean;
}
export interface SessionItem {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  modified: string;
}
export interface TreeItem {
  id: string;
  parentId: string | null;
  type: string;
  text: string;
  role?: string;
  label?: string;
  timestamp: string;
}
export interface ToolItem {
  name: string;
  description: string;
  active: boolean;
  exposure: string;
  parameters: unknown;
}
export interface ResourceItem {
  kind: string;
  name: string;
  path: string;
  description?: string;
}
export interface ProviderItem {
  id: string;
  name: string;
  configured: boolean;
  source?: string;
  methods: string[];
}
export interface DialogRequest {
  id: string;
  /** Only desktop-owned copy is localized; extension and user content is preserved. */
  desktopTitle?: boolean;
  desktopOptions?: boolean;
  kind: "confirm" | "select" | "input" | "editor";
  title: string;
  message?: string;
  options?: (string | { value: string; label: string; description?: string })[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  /** Backend deadline; presenting a queued/reconnected dialog must not restart it. */
  expiresAt?: number;
  secret?: boolean;
  presentation?: {
    title: import("./desktop-ui.ts").DesktopMarkdownText;
    message?: import("./desktop-ui.ts").DesktopMarkdownText;
    placeholder?: import("./desktop-ui.ts").DesktopMarkdownText;
    options?: {
      label: import("./desktop-ui.ts").DesktopMarkdownText;
      description?: import("./desktop-ui.ts").DesktopMarkdownText;
    }[];
  };
}
export interface DesktopSnapshot {
  managedTools?: ManagedToolsSnapshot;
  startup?: StartupSnapshot;
  startupPolicies?: StartupPoliciesSnapshot;
  backendId: string;
  revision: number;
  desktopSurfaces: import("./desktop-ui.ts").DesktopSurface[];
  widgetPlacements: Record<string, "aboveEditor" | "belowEditor">;
  widgetOrder?: string[];
  version: string;
  cwd: string;
  agentDir: string;
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  /** Agent, compaction or shell work; excludes configuration updates. */
  running: boolean;
  busy: boolean;
  changing: boolean;
  compacting: boolean;
  retrying: boolean;
  model?: ModelItem;
  thinking: string;
  thinkingLevels: string[];
  models: ModelItem[];
  messages: ChatMessage[];
  conversationNotices?: {
    id: string;
    afterMessageId?: string;
    presentation: import("./desktop-ui.ts").DesktopMarkdownText;
  }[];
  streaming?: ChatMessage;
  activeTools: {
    id: string;
    name: string;
    arguments: unknown;
    output?: ContentBlock[];
    toolRenderShell?: "default" | "self";
    toolPresentation?: ToolPresentation;
  }[];
  tools: ToolItem[];
  resources: ResourceItem[];
  diagnostics: string[];
  commands: { name: string; description?: string; source: string }[];
  providers: ProviderItem[];
  settings: RecordValue;
  toolImages?: { visible: boolean; widthCells: number };
  editor: { text: string; revision: number };
  globalSettings: RecordValue;
  projectSettings: RecordValue;
  queue: { steering: string[]; followUp: string[] };
  tree: TreeItem[];
  leafId: string | null;
  stats: {
    tokens: Record<string, number>;
    cost: number;
    toolCalls: number;
    contextUsage?: {
      tokens: number | null;
      percent: number | null;
      contextWindow: number;
    };
  };
  statuses: Record<string, string>;
  widgets: Record<string, string[]>;
  scopedModels: string[];
  trusted: boolean;
  recentWorkspaces: string[];
  extensionUI: {
    textPresentation?: {
      workingFrames?: import("./desktop-ui.ts").DesktopMarkdownText[];
      hiddenThinkingLabel?: import("./desktop-ui.ts").DesktopMarkdownText;
      statuses: Record<string, import("./desktop-ui.ts").DesktopMarkdownText>;
      widgets: Record<string, import("./desktop-ui.ts").DesktopMarkdownText>;
    };
    windowTitle: string;
    windowProgress: boolean;
    inputListeners: number;
    shortcuts: string[];
    theme?: {
      name?: string;
      appearance: "light" | "dark";
      followsSystem?: boolean;
      colors: Record<string, string>;
    };
    workingVisible: boolean;
    workingMessage?: string;
    workingIndicator?: { frames?: string[]; intervalMs?: number };
    hiddenThinkingLabel?: string;
  };
  bashRunning: boolean;
  hasPendingBashMessages: boolean;
  cacheWarmingStatus?: unknown;
  routedModel?: ModelItem;
}
export interface TerminalQuery {
  id: string;
  data: string;
}
export type DesktopSettingsSnapshot = Pick<DesktopSnapshot,
  "version" | "agentDir" | "cwd" | "busy" | "changing" | "trusted" |
  "settings" | "globalSettings" | "projectSettings" | "models" | "providers" |
  "model" | "scopedModels" | "resources"
>;
export type DesktopEvent =
  | { type: "shell_output"; terminalId: string; sequence: number; data: string }
  | { type: "shell_exit"; terminalId: string; exitCode: number }
  | ({ type: "terminal_query" } & TerminalQuery)
  | { type: "terminal_output"; sequence: number; data: string }
  | { type: "terminal_exit"; exitCode: number }
  | { type: "shutdown"; exitCode?: number }
  | { type: "sdk_event"; data: unknown }
  | { type: "snapshot"; data: DesktopSnapshot }
  | { type: "workspace_closed"; workspaces: string[] }
  | { type: "dialog"; data: DialogRequest }
  | { type: "dialog_closed"; id: string }
  | {
      type: "notice";
      desktopCopy?: boolean;
      message: string;
      level: "info" | "warning" | "error";
      presentation?: import("./desktop-ui.ts").DesktopMarkdownText;
    }
  | {
      type: "editor";
      text: string;
      append?: boolean;
      selection?: import("./desktop-ui.ts").DesktopSelection;
    }
  | { type: "auth_url"; url: string; message?: string; id?: string; desktopCopy?: boolean }
  | { type: "activity"; name: string; data?: unknown };
export interface ActionRequest {
  action: string;
  args?: RecordValue;
}
export interface FileItem {
  name: string;
  path: string;
  directory: boolean;
  size: number;
}
export interface DirectoryEntry { name: string; path: string }
export interface DirectoryListing {
  path: string;
  parent?: string;
  home: string;
  roots: DirectoryEntry[];
  ancestors: DirectoryEntry[];
  directories: DirectoryEntry[];
  siblings: DirectoryEntry[];
}
export interface FilePreview {
  path: string;
  content: string;
  image?: string;
  size: number;
  truncated: boolean;
}
