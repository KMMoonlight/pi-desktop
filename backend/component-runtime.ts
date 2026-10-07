import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { desktopExternalLink, desktopFileReference } from "../shared/links.ts";
import { collapseEditorSelection } from "../shared/editor-navigation.ts";
import {
  CustomMessageComponent,
  getPackageDir,
  VERSION,
  type AgentSession,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionUIContext,
  ReadonlyFooterDataProvider,
  Theme,
  MarkdownTransformer,
  MarkdownTransformContext,
} from "@earendil-works/pi-coding-agent";
import type { DesktopTui, PiMouseApi } from "./tui-api.ts";
import type {
  DesktopPasteSpan,
  DesktopEditorLayout,
  DesktopSelection,
} from "../shared/desktop-ui.ts";
import type { ComponentRenderRange } from "./component-render.ts";

export type PiComponent = NonNullable<Parameters<DesktopTui["setFocus"]>[0]>;
export type PiMouseEvent = Parameters<
  NonNullable<PiComponent["handleMouse"]>
>[0];
export type PiKeybindings = Parameters<
  Parameters<ExtensionUIContext["custom"]>[0]
>[2];
export interface FooterProvider extends ReadonlyFooterDataProvider {
  setExtensionStatus(key: string, text: string | undefined): void;
  setAvailableProviderCount(count: number): void;
  setCwd(cwd: string): void;
  dispose(): void;
}
export type NativeStatusIndicator = NonNullable<
  Parameters<
    import("@earendil-works/pi-coding-agent").CustomEditor["setWorkingStatusIndicator"]
  >[0]
>;
type Assistant = Extract<
  AgentSession["messages"][number],
  { role: "assistant" }
>;
export interface CacheMissNotice {
  missedTokens: number;
  missedCost: number;
  idleMs: number;
  modelChanged: boolean;
}
export interface ConversationNoticeRenderer {
  warming(entry: Extract<SessionEntry, { type: "usage" }>): PiComponent[];
  summary(
    entry: Extract<SessionEntry, { type: "compaction" | "branch_summary" }>,
  ): PiComponent[];
  thinking(message: Assistant): PiComponent[];
  liveMiss(message: Assistant): PiComponent[];
  miss(miss: CacheMissNotice): PiComponent[];
  misses(): Map<Assistant, CacheMissNotice>;
}
export interface NativeApplicationBuilder {
  saveImplicitTrustAfterReload(agentDir: string): {
    saved: boolean;
    warnings: PiComponent[];
  };
  policyNotice(
    kind: "version" | "packages" | "warning" | "bug",
    value: unknown,
  ): PiComponent[];
  subscriptionWarning(
    session: AgentSession,
    current: () => boolean,
  ): Promise<PiComponent[]>;
  restoreTitle(): void;
  crashInstructions(): string;
  configure(options: {
    verbose?: boolean;
    autoTrustOnReloadCwd?: string;
  }): void;
  changelog(
    kind: "startup" | "full",
    preceded?: boolean,
  ): { markdown?: string; components: PiComponent[] };
  managedStatus(status: {
    type: "info" | "warning";
    message: string;
  }): PiComponent[];
  resetManagedStatus(): void;
  header(): Promise<PiComponent[]>;
  resources(options?: {
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): PiComponent[];
  pending(
    compactionQueue?: { mode: "steer" | "followUp"; text: string }[],
  ): PiComponent[];
  stringWidget(
    key: string,
    lines: string[] | undefined,
  ): PiComponent | undefined;
  widgetRegion(
    widgets: Map<string, PiComponent>,
    above: boolean,
  ): PiComponent[];
}
interface ComponentRuntime {
  application: {
    create(
      getSession: () => AgentSession,
      tui: DesktopTui,
      keybindings: PiKeybindings,
    ): NativeApplicationBuilder;
  };
  conversation: {
    create(getSession: () => AgentSession): ConversationNoticeRenderer;
  };
  interactive: {
    createInteractiveTuiReference(getTui: () => DesktopTui): DesktopTui;
    createInteractiveTui(options: {
      tuiMode: "regular" | "fullscreen";
      showHardwareCursor: boolean;
      logDirectory: string;
      terminal: DesktopTui["terminal"];
      onRightClickPaste?: () => void;
      fullscreenCopyOnSelect?: boolean;
      fullscreenWheelScrollLines?: number | "auto";
    }): DesktopTui;
    createChatViewport(options: {
      document: PiComponent;
      pendingMessages: PiComponent;
      status: PiComponent;
      editor: PiComponent;
      footer: PiComponent;
      widgetsAbove: PiComponent;
      widgetsBelow: PiComponent;
      scrollbar: "hidden" | "auto" | "always";
      scrollbarTrackStyle(text: string): string;
      scrollbarThumbStyle(text: string): string;
    }): {
      root: PiComponent;
      transcript: PiComponent & {
        setScrollbar(value: "hidden" | "auto" | "always"): void;
      };
    };
  };
  notice: {
    ThemedText: new (
      build: () => string,
      paddingX?: number,
      paddingY?: number,
    ) => PiComponent;
    Spacer: new (lines: number) => PiComponent;
  };
  status: {
    WorkingStatusIndicator: new (
      tui: DesktopTui,
      message: string,
      indicator?: { frames?: string[]; intervalMs?: number },
      color?: (text: string) => string,
    ) => NativeStatusIndicator;
    RetryStatusIndicator: new (
      tui: DesktopTui,
      attempt: number,
      maxAttempts: number,
      delayMs: number,
    ) => NativeStatusIndicator;
    CompactionStatusIndicator: new (
      tui: DesktopTui,
      reason: "manual" | "threshold" | "overflow",
    ) => NativeStatusIndicator;
    BranchSummaryStatusIndicator: new (
      tui: DesktopTui,
    ) => NativeStatusIndicator;
    IdleStatus: new () => PiComponent;
  };
  transcript: {
    CustomMessageComponent: typeof CustomMessageComponent;
    CustomEntryComponent: new (
      entry: unknown,
      renderer: Function,
    ) => PiComponent;
  };
  markdown: {
    Markdown: new (...args: unknown[]) => PiComponent;
    createMarkdownTransform(
      messageType: MarkdownTransformContext["messageType"],
      isStreaming: boolean,
      transformers: readonly MarkdownTransformer[],
    ): (markdown: string, availableWidth: number) => string;
    createMermaidMarkdownTransformer(options: {
      getMode(): "off" | "final" | "streaming";
      theme?: Theme;
    }): MarkdownTransformer;
    getMarkdownTheme(): ReturnType<
      typeof import("@earendil-works/pi-coding-agent").getMarkdownTheme
    >;
  };
  diff: {
    diffArrays<T>(
      before: T[],
      after: T[],
      options: { comparator(left: T, right: T): boolean },
    ): { added?: boolean; removed?: boolean; value: T[] }[];
  };
  preview: {
    VisualLinePreview: new (options: {
      text: string;
      maxVisualLines: number;
      keep: "start" | "end";
      formatHint: (hidden: number) => string;
    }) => PiComponent;
  };
  image: {
    getImageDimensions(
      data: string,
      mimeType: string,
    ): { widthPx: number; heightPx: number } | null;
    imageFallback(
      mimeType: string,
      dimensions?: { widthPx: number; heightPx: number },
      filename?: string,
    ): string;
  };
  text: {
    colorToHex(color: { kind: "indexed"; index: number }): string;
    extractAnsiCode(
      text: string,
      position: number,
    ): { code: string; length: number } | null;
    getOsc8LinkAtColumn(text: string, column: number): string | undefined;
  };
  theme: {
    createSelection(
      getSettingsManager: () => AgentSession["settingsManager"],
      initialThemeSetting?: string,
    ): {
      currentThemeSetting?: string;
      activeThemeName: string;
      getThemeSetting(): string | undefined;
      getThemeSelection(): string;
      resolveThemeName(): string;
    };
    getAvailableThemesWithPaths(): { name: string; path: string | undefined }[];
    getThemeByName(name: string): Theme | undefined;
    loadThemeFromPath(path: string): Theme;
    parseAutoThemeSetting(
      setting: string | undefined,
    ): { lightTheme: string; darkTheme: string } | undefined;
    resolveThemeSetting(
      setting: string | undefined,
      appearance: "light" | "dark",
    ): string | undefined;
    setThemeInstance(theme: Theme): void;
    setTerminalColorScheme(appearance: "light" | "dark"): void;
    setTerminalColors(colors: object): void;
  };
  mouse: PiMouseApi;
  stack: {
    allocateStackSizes(
      entries: Record<string, unknown>[],
      intrinsic: number[],
      available: number | undefined,
      gap: number,
    ): number[];
  };
  keys: { KeybindingsManager: { create(agentDir: string): PiKeybindings } };
  footer: { FooterDataProvider: new (cwd: string) => FooterProvider };
}
let runtime: Promise<ComponentRuntime> | undefined;

// Pi exposes no native component descriptors. Keep all version-bound access here.
export function loadComponentRuntime(): Promise<ComponentRuntime> {
  if (VERSION !== "1.0.0")
    throw new Error(
      `Pi ${VERSION}: the desktop component bridge requires a compatibility update`,
    );
  return (runtime ??= (async () => {
    const load = (name: string) =>
      import(
        pathToFileURL(join(getPackageDir(), "dist", "core", `${name}.js`)).href
      );
    const require = createRequire(
      import.meta.resolve("@earendil-works/pi-coding-agent"),
    );
    const tuiDir = dirname(require.resolve("@earendil-works/pi-tui"));
    const [
      keys,
      footer,
      mouse,
      stack,
      theme,
      themeJSON,
      text,
      colors,
      image,
      preview,
      diff,
      markdown,
      markdownTransform,
      mermaid,
      customEntry,
      status,
      themedText,
      spacer,
      interactive,
      viewport,
    ] = await Promise.all([
      load("keybindings"),
      load("footer-data-provider"),
      import(pathToFileURL(join(tuiDir, "tui.js")).href),
      import(pathToFileURL(join(tuiDir, "components", "stack.js")).href),
      import(
        pathToFileURL(
          join(
            getPackageDir(),
            "dist",
            "modes",
            "interactive",
            "theme",
            "theme.js",
          ),
        ).href
      ),
      import(
        pathToFileURL(
          join(
            getPackageDir(),
            "dist",
            "modes",
            "interactive",
            "theme",
            "theme-json.js",
          ),
        ).href
      ),
      import(pathToFileURL(join(tuiDir, "utils.js")).href),
      import(pathToFileURL(join(tuiDir, "colors.js")).href),
      import(pathToFileURL(join(tuiDir, "terminal-image.js")).href),
      import(
        pathToFileURL(
          join(
            getPackageDir(),
            "dist",
            "modes",
            "interactive",
            "components",
            "visual-truncate.js",
          ),
        ).href
      ),
      import(pathToFileURL(require.resolve("diff")).href),
      import(pathToFileURL(join(tuiDir, "components", "markdown.js")).href),
      import(
        pathToFileURL(
          join(
            getPackageDir(),
            "dist",
            "modes",
            "interactive",
            "components",
            "markdown-transform.js",
          ),
        ).href
      ),
      import(
        pathToFileURL(
          join(
            getPackageDir(),
            "dist",
            "modes",
            "interactive",
            "components",
            "mermaid.js",
          ),
        ).href
      ),
      import(
        pathToFileURL(
          join(
            getPackageDir(),
            "dist",
            "modes",
            "interactive",
            "components",
            "custom-entry.js",
          ),
        ).href
      ),
      import(
        pathToFileURL(
          join(
            getPackageDir(),
            "dist",
            "modes",
            "interactive",
            "components",
            "status-indicator.js",
          ),
        ).href
      ),
      import(
        pathToFileURL(
          join(
            getPackageDir(),
            "dist",
            "modes",
            "interactive",
            "components",
            "themed-text.js",
          ),
        ).href
      ),
      import(pathToFileURL(join(tuiDir, "components", "spacer.js")).href),
      import(
        pathToFileURL(
          join(getPackageDir(), "dist/modes/interactive/tui-renderer.js"),
        ).href
      ),
      import(
        pathToFileURL(
          join(getPackageDir(), "dist/modes/interactive/chat-viewport.js"),
        ).href
      ),
    ]);
    const [mode, cache, themeController] = await Promise.all([
      import(
        pathToFileURL(
          join(getPackageDir(), "dist/modes/interactive/interactive-mode.js"),
        ).href
      ),
      load("cache-stats"),
      import(
        pathToFileURL(
          join(
            getPackageDir(),
            "dist/modes/interactive/theme/theme-controller.js",
          ),
        ).href
      ),
    ]);
    theme.setThemeJsonValidator(themeJSON.validateThemeJson);
    return {
      application: {
        create(getSession, tui, keybindings) {
          image.setCapabilityOverrides(
            getSession().settingsManager.getTerminalCapabilityOverrides(),
          );
          const receiver = Object.create(mode.InteractiveMode.prototype);
          const Container = Reflect.get(mouse, "Container");
          for (const field of [
            "headerContainer",
            "loadedResourcesContainer",
            "chatContainer",
            "documentContainer",
            "pendingMessagesContainer",
            "statusContainer",
            "widgetContainerAbove",
            "editorContainer",
            "widgetContainerBelow",
            "footerContainer",
          ])
            receiver[field] = new Container();
          Object.defineProperties(receiver, {
            session: { get: getSession },
            settingsManager: { get: () => getSession().settingsManager },
            sessionManager: { get: () => getSession().sessionManager },
          });
          receiver.options = {};
          receiver.version = VERSION;
          receiver.keybindings = keybindings;
          receiver.toolOutputExpanded = false;
          receiver.compactionQueuedMessages = [];
          receiver.extensionWidgetsAbove = new Map();
          receiver.extensionWidgetsBelow = new Map();
          receiver.renderer = tui;
          const call = (name: string, ...args: unknown[]) =>
            Reflect.apply(
              Reflect.get(mode.InteractiveMode.prototype, name),
              receiver,
              args,
            );
          const headerReady = Symbol("native header captured");
          let capturing = false,
            headerPhase = false;
          let changelogLoaded = false;
          // Pi constructs its private BuiltInHeader inside init(). Capture that
          // original construction segment on an isolated receiver. Stop at its
          // first completed-header draw, before managed tools or session binding.
          // Layout/renderer/theme ownership stays with the actual desktop host.
          receiver.registerSignalHandlers = () => {};
          receiver.getChangelogForDisplay = () => undefined;
          receiver.renderWidgets = () => {};
          receiver.mountInteractiveTui = () => {};
          receiver.shouldShowStartupHeader = () => {
            headerPhase = true;
            return call("shouldShowStartupHeader");
          };
          receiver.shouldShowStartupDetails = () =>
            headerPhase && call("shouldShowStartupDetails");
          receiver.defaultEditor = { onAction() {} };
          receiver.editor = receiver.defaultEditor;
          receiver.themeController = {
            applyFromSettings() {},
            waitForTerminalColors: () => Promise.resolve(),
          };
          receiver.ui = {
            terminal: tui.terminal,
            setFocus() {},
            start() {},
            requestRender() {
              if (capturing) throw headerReady;
            },
          };
          return {
            saveImplicitTrustAfterReload(agentDir) {
              receiver.runtimeHost = { services: { agentDir } };
              receiver.chatContainer.clear();
              const saved = call("maybeSaveImplicitProjectTrustAfterReload");
              if (typeof saved !== "boolean")
                throw new Error(
                  "Pi implicit trust policy returned an invalid value",
                );
              return {
                saved,
                warnings: receiver.chatContainer.children.slice(),
              };
            },
            policyNotice(kind, value) {
              receiver.outputPad = getSession().settingsManager.getOutputPad();
              receiver.chatContainer.clear();
              call(
                kind === "version"
                  ? "showNewVersionNotification"
                  : kind === "packages"
                    ? "showPackageUpdateNotification"
                    : kind === "bug"
                      ? "maybeSuggestBugReport"
                      : "showWarning",
                value,
              );
              return receiver.chatContainer.children.slice();
            },
            async subscriptionWarning(session, current) {
              const output: PiComponent[] = [];
              const captured = Object.create(mode.InteractiveMode.prototype);
              Object.defineProperties(captured, {
                session: { value: session },
                settingsManager: { value: session.settingsManager },
              });
              Object.assign(captured, {
                anthropicSubscriptionWarningShown:
                  receiver.anthropicSubscriptionWarningShown,
                chatContainer: {
                  addChild(child: PiComponent) {
                    output.push(child);
                  },
                },
                ui: { requestRender() {} },
              });
              await Reflect.apply(
                Reflect.get(
                  mode.InteractiveMode.prototype,
                  "maybeWarnAboutAnthropicSubscriptionAuth",
                ),
                captured,
                [],
              );
              if (!current()) return [];
              receiver.anthropicSubscriptionWarningShown =
                captured.anthropicSubscriptionWarningShown;
              return output;
            },
            restoreTitle() {
              call("updateTerminalTitle");
            },
            crashInstructions() {
              const result = call("crashReportInstructions");
              if (typeof result !== "string")
                throw new Error(
                  "Pi crashReportInstructions returned an invalid value",
                );
              return result;
            },
            configure(options) {
              receiver.options = { ...receiver.options, ...options };
              receiver.autoTrustOnReloadCwd = options.autoTrustOnReloadCwd;
            },
            changelog(kind, preceded = false) {
              receiver.chatContainer.clear();
              if (kind === "startup") {
                if (!changelogLoaded) {
                  receiver.changelogMarkdown = call("getChangelogForDisplay");
                  changelogLoaded = true;
                }
                const previous = { render: () => [], invalidate() {} };
                if (preceded) receiver.chatContainer.addChild(previous);
                call("showStartupNoticesIfNeeded");
                return {
                  markdown: receiver.changelogMarkdown,
                  components: receiver.chatContainer.children.filter(
                    (component: PiComponent) => component !== previous,
                  ),
                };
              }
              call("handleChangelogCommand");
              const components = receiver.chatContainer.children.slice();
              return {
                markdown: components.find(
                  (component: PiComponent) =>
                    component.constructor.name === "Markdown",
                )?.text,
                components,
              };
            },
            async header() {
              capturing = true;
              headerPhase = false;
              receiver.isInitialized = false;
              receiver.headerContainer.clear();
              try {
                await call("init");
              } catch (error) {
                if (error !== headerReady) throw error;
              } finally {
                capturing = false;
              }
              if (!receiver.builtInHeader)
                throw new Error(
                  "Pi's native header construction boundary changed",
                );
              return receiver.headerContainer.children.slice();
            },
            resources(options) {
              call(
                "showLoadedResources",
                options ?? { showDiagnosticsWhenQuiet: true },
              );
              return receiver.loadedResourcesContainer.children.slice();
            },
            pending(compactionQueue = []) {
              receiver.compactionQueuedMessages = compactionQueue;
              call("updatePendingMessagesDisplay");
              return receiver.pendingMessagesContainer.children.slice();
            },
            managedStatus(status) {
              receiver.chatContainer.clear();
              call("showManagedToolStatus", status);
              return receiver.chatContainer.children.slice();
            },
            resetManagedStatus() {
              receiver.managedToolStatusStarted = false;
            },
            stringWidget(key, lines) {
              call("setExtensionWidget", key, lines);
              return receiver.extensionWidgetsAbove.get(key);
            },
            widgetRegion(widgets, above) {
              const container = above
                ? receiver.widgetContainerAbove
                : receiver.widgetContainerBelow;
              call("renderWidgetContainer", container, widgets, above, above);
              return container.children.slice();
            },
          };
        },
      },
      conversation: {
        create(getSession) {
          // These synchronous original methods only need the session, settings,
          // manager and chat sink. Do not construct the CLI or replace its APIs.
          const receiver = Object.create(mode.InteractiveMode.prototype);
          let output: PiComponent[] = [];
          Object.defineProperties(receiver, {
            session: { get: getSession },
            settingsManager: { get: () => getSession().settingsManager },
            sessionManager: { get: () => getSession().sessionManager },
            chatContainer: {
              value: { addChild: (child: PiComponent) => output.push(child) },
            },
          });
          const capture = (name: string, value: unknown) => {
            output = [];
            Reflect.apply(
              Reflect.get(mode.InteractiveMode.prototype, name),
              receiver,
              [value],
            );
            return output;
          };
          return {
            warming: (entry) => capture("addCacheWarmingUsage", entry),
            summary: (entry) =>
              capture("addCompactionCostNotice", {
                type: "compaction_cost",
                kind: entry.type,
                usage: entry.usage,
              }),
            thinking: (message) =>
              capture("maybeShowThinkingDropNotice", message),
            liveMiss: (message) => capture("maybeShowCacheMissNotice", message),
            miss: (miss) => capture("addCacheMissNotice", miss),
            misses: () =>
              cache.collectCacheMisses(
                getSession().sessionManager.getEntries(),
                getSession().modelRuntime,
              ),
          };
        },
      },
      interactive: { ...interactive, ...viewport },
      keys,
      footer,
      status,
      notice: {
        ThemedText: themedText.ThemedText,
        Spacer: spacer.Spacer,
      },
      mouse,
      stack,
      theme: {
        ...theme,
        createSelection(getSettingsManager, initialThemeSetting) {
          // Keep Pi's invocation precedence/selection methods on an isolated
          // receiver; theme resources and file watchers belong to this host.
          const selection = Object.create(
            themeController.InteractiveThemeController.prototype,
          );
          Object.assign(selection, {
            getSettingsManager,
            currentThemeSetting: initialThemeSetting,
            activeThemeName: "system",
          });
          return selection;
        },
      },
      text: { ...text, colorToHex: colors.colorToHex },
      image,
      preview,
      diff,
      transcript: {
        CustomMessageComponent,
        CustomEntryComponent: customEntry.CustomEntryComponent,
      },
      markdown: {
        ...markdown,
        ...markdownTransform,
        ...mermaid,
        getMarkdownTheme: theme.getMarkdownTheme,
      },
    };
  })());
}

export function componentField(value: object, key: string): unknown {
  return Reflect.get(value, key);
}
export function requiredComponentField(value: object, key: string): unknown {
  if (!(key in value))
    throw new Error(
      `Pi component field '${key}' changed; the desktop component bridge requires a compatibility update`,
    );
  return componentField(value, key);
}
export function setComponentField(
  value: object,
  key: string,
  next: unknown,
): void {
  requiredComponentField(value, key);
  Reflect.set(value, key, next);
}

export function componentHasCustomRender(
  target: PiComponent,
  prototype: object,
) {
  return (
    target.render !== Reflect.get(prototype, "render") ||
    Object.getPrototypeOf(target) !== prototype ||
    Reflect.ownKeys(target).some(
      (key) =>
        typeof Reflect.get(prototype, key) === "function" &&
        Reflect.get(target, key) !== Reflect.get(prototype, key),
    )
  );
}

export function componentRenderBaseline(
  target: PiComponent,
  prototype: object,
  width: number,
): string[] {
  return componentRenderBaselineFrame(target, prototype, width).lines;
}

export function componentRenderBaselineFrame(
  target: PiComponent,
  prototype: object,
  width: number,
  kind?: string,
): { lines: string[]; children?: ComponentRenderRange[]; borders?: number[] } {
  const receiver = Object.create(prototype);
  for (const key of Reflect.ownKeys(target)) {
    // Instance helper overrides belong only to the original render.
    if (typeof Reflect.get(prototype, key) !== "function")
      Object.defineProperty(
        receiver,
        key,
        Object.getOwnPropertyDescriptor(target, key)!,
      );
  }
  const mouseLayout = Object.getOwnPropertyDescriptor(receiver, "mouseLayout");
  // A synchronous mouse callback may render while the original layout is scoped.
  // The canonical receiver must neither read that scope nor call its setter.
  if (mouseLayout?.configurable && (mouseLayout.get || mouseLayout.set))
    Object.defineProperty(receiver, "mouseLayout", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  // Reset only the receiver's own cache, preserving original child renders and lifetime.
  const invalidateCache = Reflect.get(prototype, "invalidateCache");
  if (typeof invalidateCache === "function")
    Reflect.apply(invalidateCache, receiver, []);
  else if ("cachedLines" in receiver) {
    let invalidate: ((...args: unknown[]) => unknown) | undefined;
    for (
      let current = prototype;
      current && current !== Object.prototype;
      current = Object.getPrototypeOf(current)
    ) {
      const method = Object.getOwnPropertyDescriptor(
        current,
        "invalidate",
      )?.value;
      if (typeof method === "function") invalidate = method;
    }
    if (invalidate) Reflect.apply(invalidate, receiver, []);
  }
  const lines: string[] = Reflect.apply(
    Reflect.get(prototype, "render"),
    receiver,
    [width],
  );
  if (kind === "Editor" || kind === "CustomEditor")
    return {
      lines,
      borders: [
        0,
        Number(componentField(receiver, "renderedVisibleLineCount")) + 1,
      ],
    };
  if (!["Container", "Box", "BorderedLoader"].includes(kind ?? ""))
    return { lines };
  const layout = componentField(receiver, "mouseLayout");
  const paddingY = Number(componentField(receiver, "paddingY"));
  let row =
    kind === "Box" && Number.isFinite(paddingY)
      ? Math.max(0, Math.ceil(paddingY))
      : 0;
  const children: ComponentRenderRange[] = [];
  if (layout && typeof layout === "object") {
    const entries = componentField(layout, "children");
    if (!Array.isArray(entries))
      throw new Error(
        "Pi canonical container layout changed; the desktop bridge requires an update",
      );
    for (const [child, entry] of entries.entries()) {
      const length = Number(componentField(entry, "height"));
      if (!Number.isInteger(length) || length < 0)
        throw new Error(
          "Pi canonical child height changed; the desktop bridge requires an update",
        );
      children.push({ child, start: row, length });
      row += length;
    }
  }
  return { lines, children };
}

export function componentMarkdownSource(target: PiComponent, width: number) {
  if (!target.render(width).length) return { source: "", tokens: [] };
  const read = () => {
    const cached = requiredComponentField(target, "cachedTokens");
    return cached instanceof WeakRef ? cached.deref() : undefined;
  };
  let source = read();
  // Pi keeps rendered lines strongly but holds its parsed token tree weakly.
  if (!source) {
    callComponentMethod(target, "invalidate");
    target.render(width);
    source = read();
  }
  if (
    !source ||
    typeof source.source !== "string" ||
    !Array.isArray(source.tokens)
  )
    throw new Error(
      "Pi Markdown tokens changed; the desktop bridge requires an update",
    );
  return source as { source: string; tokens: object[] };
}

/** Add desktop link metadata while the original inline renderer applies its theme. */
export function withComponentMarkdownLinks<T>(
  target: PiComponent,
  tokens: object[],
  operation: () => T,
): T {
  const links: string[] = [];
  const visit = (values: object[]) => {
    for (const token of values) {
      const children = componentField(token, "tokens");
      if (Array.isArray(children)) visit(children);
      if (componentField(token, "type") === "link")
        links.push(String(componentField(token, "href") ?? ""));
    }
  };
  visit(tokens);
  if (!links.length) return operation();
  const original = requiredComponentField(target, "theme") as object;
  const link = requiredComponentField(original, "link") as (
    text: string,
  ) => string;
  let index = 0;
  const linked = new Proxy(original, {
    get: (value, key) =>
      key === "link"
        ? (text: string) => {
            const href = links[index++];
            const styled = Reflect.apply(link, original, [text]);
            const destination = href
              ? (desktopExternalLink(href) ??
                (desktopFileReference(href) ? href : undefined))
              : undefined;
            if (destination)
              return `\x1b]8;;${destination}\x1b\\${styled}\x1b]8;;\x1b\\`;
            return styled;
          }
        : Reflect.get(value, key, original),
  });
  setComponentField(target, "theme", linked);
  try {
    return operation();
  } finally {
    if (componentField(target, "theme") === linked)
      setComponentField(target, "theme", original);
  }
}
export function callComponentMethod(
  value: object,
  key: string,
  ...args: unknown[]
): unknown {
  const method = requiredComponentField(value, key);
  if (typeof method !== "function")
    throw new Error(
      `Pi component method '${key}' changed; the desktop component bridge requires a compatibility update`,
    );
  return Reflect.apply(method, value, args);
}

export function resolveComponentOverlayLayout(
  runtime: object,
  options: Parameters<DesktopTui["showOverlay"]>[1],
  height: number,
  viewport: { width: number; height: number },
): { width: number; row: number; col: number; maxHeight?: number } {
  if (VERSION !== "1.0.0")
    throw new Error(
      `Pi ${VERSION}: overlay layout requires a compatibility update`,
    );
  return callComponentMethod(
    runtime,
    "resolveOverlayLayout",
    options,
    height,
    viewport.width,
    viewport.height,
  ) as { width: number; row: number; col: number; maxHeight?: number };
}

const verticalPositions = new WeakMap<
  object,
  { text: string; width: number; offset: number; preferred: number | null }
>();

/** Supply native geometry while retaining Pi's input, history, paging and atomic segments. */
export function withComponentEditorLayout<T>(
  target: object,
  layout: DesktopEditorLayout | undefined,
  operation: () => T,
  range?: { selection: DesktopSelection; onCollapse?: () => void },
): T {
  if (!layout || layout.text !== callComponentMethod(target, "getText"))
    return operation();
  const lines = layout.text.split("\n");
  const starts: number[] = [];
  let length = 0;
  for (const line of lines) {
    starts.push(length);
    length += line.length + 1;
  }
  if (
    !Number.isFinite(layout.width) ||
    layout.width <= 0 ||
    !Number.isFinite(layout.pageRows) ||
    layout.pageRows < 1 ||
    !Array.isArray(layout.rows) ||
    !layout.rows.length ||
    layout.rows.some(
      (row) =>
        !Number.isInteger(row.logicalLine) ||
        (!lines[row.logicalLine] && lines[row.logicalLine] !== "") ||
        !Number.isInteger(row.startCol) ||
        row.startCol < 0 ||
        !Number.isInteger(row.length) ||
        row.length < 0 ||
        row.startCol + row.length > lines[row.logicalLine].length ||
        !Array.isArray(row.carets) ||
        !row.carets.length ||
        row.carets.some(
          (caret) =>
            !Number.isInteger(caret.offset) ||
            caret.offset < starts[row.logicalLine] + row.startCol ||
            caret.offset >
              starts[row.logicalLine] + row.startCol + row.length ||
            !Number.isFinite(caret.x),
        ),
    )
  )
    throw new Error("Invalid desktop editor layout");
  const model = requiredComponentField(target, "state") as object;
  const offset = () =>
    starts[Number(componentField(model, "cursorLine"))] +
    Number(componentField(model, "cursorCol"));
  const previous = verticalPositions.get(target);
  let preferred =
    previous?.text === layout.text &&
    previous.width === layout.width &&
    previous.offset === offset()
      ? previous.preferred
      : null;
  let moved = false;
  let current: number | undefined, destination: number | undefined;
  const names = [
    "buildVisualLineMap",
    "moveToVisualLine",
    "computeVerticalMoveColumn",
    "pageScroll",
    "moveCursor",
  ];
  const entries = names.map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(target, key),
    original: requiredComponentField(target, key) as (
      ...args: unknown[]
    ) => unknown,
  }));
  const valid = () => layout.text === callComponentMethod(target, "getText");
  const original = (index: number, args: unknown[]) =>
    Reflect.apply(entries[index].original, target, args);
  let collapsed = false;
  const scoped = [
    (...args: unknown[]) => (valid() ? layout.rows : original(0, args)),
    (...args: unknown[]) => {
      const before = [current, destination];
      current = Number(args[1]);
      destination = Number(args[2]);
      try {
        return original(1, args);
      } finally {
        [current, destination] = before;
      }
    },
    (...args: unknown[]) => {
      if (!valid() || current === undefined || destination === undefined)
        return original(2, args);
      const source = layout.rows[current],
        row = layout.rows[destination];
      if (!source || !row) return original(2, args);
      const nearest = (
        carets: typeof row.carets,
        value: number,
        field: "offset" | "x",
      ) =>
        carets.reduce((a, b) =>
          Math.abs(b[field] - value) < Math.abs(a[field] - value) ? b : a,
        );
      const x = nearest(source.carets, offset(), "offset").x;
      preferred ??= Math.floor(x);
      const before = requiredComponentField(target, "preferredVisualCol");
      setComponentField(target, "preferredVisualCol", preferred);
      try {
        const pixel = original(2, [
          preferred,
          Math.max(...source.carets.map((c) => c.x)),
          Math.max(...row.carets.map((c) => c.x)),
        ]) as number;
        moved = true;
        return (
          nearest(row.carets, pixel, "x").offset -
          starts[row.logicalLine] -
          row.startCol
        );
      } finally {
        setComponentField(target, "preferredVisualCol", before);
      }
    },
    (...args: unknown[]) => {
      if (!valid()) return original(3, args);
      preferred = null;
      const tui = requiredComponentField(target, "tui") as object;
      const terminal = requiredComponentField(tui, "terminal") as object;
      const rows = Math.ceil((Math.max(5, layout.pageRows) + 0.1) / 0.3);
      const nativeTerminal = new Proxy(terminal, {
        get: (value, key) => (key === "rows" ? rows : Reflect.get(value, key)),
      });
      const nativeTui = new Proxy(tui, {
        get: (value, key) =>
          key === "terminal" ? nativeTerminal : Reflect.get(value, key),
      });
      setComponentField(target, "tui", nativeTui);
      try {
        return original(3, args);
      } finally {
        if (componentField(target, "tui") === nativeTui)
          setComponentField(target, "tui", tui);
      }
    },
    (...args: unknown[]) => {
      if (!valid() || args[0] !== 0 || Math.abs(Number(args[1])) !== 1)
        return original(4, args);
      if (collapsed || !range || range.selection.start === range.selection.end)
        return original(
          4,
          layout.direction === "rtl" ? [0, -Number(args[1])] : args,
        );
      const position = collapseEditorSelection(
        range.selection,
        Number(args[1]) > 0,
        layout,
      );
      const line = starts.reduce(
        (found, start, index) => (start <= position ? index : found),
        -1,
      );
      if (line < 0 || position > layout.text.length) return original(4, args);
      collapsed = true;
      setComponentField(model, "cursorLine", line);
      callComponentMethod(target, "setCursorCol", position - starts[line]);
      range.onCollapse?.();
      // The original movement still resets its action state and refreshes completion.
      return original(4, [0, 0]);
    },
  ];
  try {
    entries.forEach(({ key }, index) =>
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value: scoped[index],
      }),
    );
    return operation();
  } finally {
    for (let index = 0; index < entries.length; index++) {
      const { key, descriptor } = entries[index];
      if (componentField(target, key) !== scoped[index]) continue;
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
    verticalPositions.set(target, {
      text: String(callComponentMethod(target, "getText")),
      width: layout.width,
      offset: offset(),
      preferred: moved ? preferred : null,
    });
  }
}

export function componentPasteSpans(target: PiComponent): DesktopPasteSpan[] {
  const text = callComponentMethod(target, "getText") as string;
  if (!text.includes("[paste #")) return [];
  const segments = callComponentMethod(
    target,
    "segment",
    text,
    "grapheme",
  ) as Iterable<Intl.SegmentData>;
  const pastes: DesktopPasteSpan[] = [];
  for (const { segment, index } of segments) {
    if (!segment.startsWith("[paste #")) continue;
    const expanded = callComponentMethod(target, "expandPasteMarkers", segment);
    if (typeof expanded === "string" && expanded !== segment)
      pastes.push({
        start: index,
        end: index + segment.length,
        marker: segment,
        text: expanded,
      });
  }
  return pastes;
}

/** Keep browser range removal and the original Input handler in one Pi undo transaction. */
export function editComponentInput<T>(
  target: PiComponent,
  text: string,
  operation: () => T,
): T {
  const descriptor = Object.getOwnPropertyDescriptor(target, "pushUndo");
  callComponentMethod(target, "pushUndo");
  setComponentField(target, "lastAction", null);
  const snapshotTaken = () => {};
  try {
    Object.defineProperty(target, "pushUndo", {
      configurable: true,
      writable: true,
      value: snapshotTaken,
    });
    callComponentMethod(target, "setValue", text);
    return operation();
  } finally {
    if (componentField(target, "pushUndo") === snapshotTaken) {
      if (descriptor) Object.defineProperty(target, "pushUndo", descriptor);
      else Reflect.deleteProperty(target, "pushUndo");
    }
  }
}

/** Scope single-line cursor writes to native selection collapse after Pi matches a movement command. */
export function withComponentInputNavigation<T>(
  target: object,
  layout: DesktopEditorLayout,
  selection: DesktopSelection,
  right: boolean,
  operation: (matched: () => void) => T,
  onCollapse: () => void,
): T {
  if (layout.text !== callComponentMethod(target, "getValue"))
    return operation(() => {});
  const entries = ["cursor", "lastAction"].map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(target, key),
    value: componentField(target, key),
  }));
  if (
    entries.some(
      (entry) =>
        !entry.descriptor ||
        !("value" in entry.descriptor) ||
        !entry.descriptor.configurable,
    )
  )
    return operation(() => {});
  let matched = false;
  const destination = collapseEditorSelection(selection, right, layout);
  const canCollapse = () =>
    matched &&
    selection.start !== selection.end &&
    layout.text === callComponentMethod(target, "getValue");
  const accessors = entries.map((entry, index) => ({
    get: () => entry.value,
    set: (value: unknown) => {
      entry.value = value;
      if (canCollapse() && (index === 0 || value === null)) {
        entries[0].value = destination;
        onCollapse();
      }
    },
  }));
  try {
    entries.forEach((entry, index) =>
      Object.defineProperty(target, entry.key, {
        configurable: true,
        enumerable: entry.descriptor!.enumerable,
        ...accessors[index],
      }),
    );
    return operation(() => {
      matched = true;
    });
  } finally {
    entries.forEach((entry, index) => {
      const current = Object.getOwnPropertyDescriptor(target, entry.key);
      if (
        current?.get === accessors[index].get &&
        current?.set === accessors[index].set
      )
        Object.defineProperty(target, entry.key, {
          ...entry.descriptor!,
          value: entry.value,
        });
    });
  }
}

/** Reduce a selected range only when the original handler executes a deletion. */
export function withComponentRangeDeletion<T>(
  target: PiComponent,
  range: DesktopSelection,
  edit: (text: string, offset: number, deletion: () => unknown) => unknown,
  operation: () => T,
): T {
  const isEditor = typeof componentField(target, "getText") === "function";
  const read = () =>
    callComponentMethod(target, isEditor ? "getText" : "getValue") as string;
  const before = read();
  const start = Math.max(0, Math.min(before.length, range.start));
  const end = Math.max(start, Math.min(before.length, range.end));
  if (start === end) return operation();
  const entries = ["handleBackspace", "handleForwardDelete"].map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(target, key),
    original: requiredComponentField(target, key) as (
      ...args: unknown[]
    ) => unknown,
  }));
  let used = false;
  const wrappers = entries.map(
    ({ original }, index) =>
      (...args: unknown[]) => {
        const deletion = () => Reflect.apply(original, target, args);
        if (used || read() !== before) return deletion();
        used = true;
        const selected = before.slice(start, end);
        const segments = [
          ...(isEditor
            ? (callComponentMethod(
                target,
                "segment",
                selected,
                "grapheme",
              ) as Iterable<Intl.SegmentData>)
            : new Intl.Segmenter(undefined, {
                granularity: "grapheme",
              }).segment(selected)),
        ];
        const unit = (index === 0 ? segments.at(-1) : segments[0])!.segment;
        // The original deletion consumes the remaining unit, retaining its callbacks and undo.
        return edit(
          before.slice(0, start) + unit + before.slice(end),
          start + (index === 0 ? unit.length : 0),
          deletion,
        );
      },
  );
  try {
    entries.forEach(({ key }, index) =>
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value: wrappers[index],
      }),
    );
    return operation();
  } finally {
    entries.forEach(({ key, descriptor }, index) => {
      if (componentField(target, key) !== wrappers[index]) return;
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    });
  }
}

/** Keep a desktop range replacement and the original input in one Pi undo transaction. */
export function editComponentText<T>(
  target: PiComponent,
  text: string,
  operation: () => T,
): T {
  const before = callComponentMethod(target, "getText");
  const originalChange = componentField(target, "onChange");
  const descriptors = ["pushUndoSnapshot", "onChange"].map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(target, key),
  }));
  callComponentMethod(target, "cancelAutocomplete");
  callComponentMethod(target, "exitHistoryBrowsing");
  callComponentMethod(target, "pushUndoSnapshot");
  setComponentField(target, "lastAction", null);
  let notified = false,
    completed = false,
    preparing = true;
  const ignoredSnapshot = () => {};
  const changed = (...args: unknown[]) => {
    if (preparing) return;
    notified = true;
    if (typeof originalChange === "function")
      return Reflect.apply(originalChange, target, args);
  };
  const scoped = [ignoredSnapshot, changed];
  const restore = () => {
    for (let index = 0; index < descriptors.length; index++) {
      const { key, descriptor } = descriptors[index];
      if (componentField(target, key) !== scoped[index]) continue;
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
  };
  try {
    descriptors.forEach(({ key }, index) =>
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value: scoped[index],
      }),
    );
    const normalized = callComponentMethod(target, "normalizeText", text);
    callComponentMethod(target, "setTextInternal", normalized);
    preparing = false;
    const result = operation();
    completed = true;
    return result;
  } finally {
    const callbackReplaced = componentField(target, "onChange") !== changed;
    restore();
    const next = callComponentMethod(target, "getText");
    const onChange = componentField(target, "onChange");
    if (
      completed &&
      !notified &&
      !callbackReplaced &&
      next !== before &&
      typeof onChange === "function"
    )
      Reflect.apply(onChange, target, [next]);
  }
}
export function componentMouseFocus(
  tui: DesktopTui,
  component: PiComponent,
): PiComponent {
  const target = callComponentMethod(tui, "resolveMouseFocusTarget", component);
  if (
    !target ||
    typeof target !== "object" ||
    typeof componentField(target, "render") !== "function"
  )
    throw new Error("Pi mouse focus target is unavailable");
  return target as PiComponent;
}
export function componentFocus(tui: DesktopTui): PiComponent | undefined {
  const target = callComponentMethod(tui, "getFocusedComponent");
  if (target === null) return undefined;
  if (
    !target ||
    typeof target !== "object" ||
    typeof componentField(target, "render") !== "function"
  )
    throw new Error("Pi component focus is unavailable");
  return target as PiComponent;
}
