import type { DesktopSdkContext } from "./sdk-access.ts";
import type { DesktopTui } from "./tui-api.ts";
import { componentText } from "./component-text.ts";
import type { loadComponentRuntime, PiComponent } from "./component-runtime.ts";

type Runtime = Awaited<ReturnType<typeof loadComponentRuntime>>;
type Entry = { id: string; component: PiComponent };
type Placement = "aboveEditor" | "belowEditor";
type Widget = {
  placement: Placement;
  component?: PiComponent;
  factory: boolean;
};

/** Native application presentation, independently owned from session chat content. */
export class ApplicationContent {
  private builder;
  private header: Entry[] = [];
  private resources: Entry[] = [];
  private resourceSignature?: string;
  private pending: Entry[] = [];
  private pendingSignature?: string;
  private widgets = new Map<string, Widget>();
  private regions = new Map<
    Placement,
    { signature: PiComponent[]; entries: Entry[] }
  >();
  private expanded?: boolean;
  private activeHeader?: PiComponent;
  private headerExpanded?: boolean;
  private resourceOptions = { force: false, showDiagnosticsWhenQuiet: true };
  private disposed = false;

  constructor(
    private context: () => DesktopSdkContext,
    private runtime: Runtime,
    tui: DesktopTui,
  ) {
    this.builder = runtime.application.create(
      () => context().session,
      tui,
      runtime.keys.KeybindingsManager.create(context().host.agentDir),
    );
  }
  async initialize() {
    this.builder.configure({
      verbose: this.context().host.startup.configuration.verbose,
      autoTrustOnReloadCwd:
        this.context().host.startup.configuration.autoTrustOnReloadCwd,
    });
    const components = await this.builder.header();
    if (!this.disposed)
      this.header = components.map((component, index) => ({
        id: `native-header:${index}`,
        component,
      }));
  }
  saveImplicitTrustAfterReload() {
    return this.disposed
      ? { saved: false, warnings: [] as PiComponent[] }
      : this.builder.saveImplicitTrustAfterReload(this.context().host.agentDir);
  }
  managedStatus(status: { type: "info" | "warning"; message: string }) {
    return this.disposed ? [] : this.builder.managedStatus(status);
  }
  startupChangelog(preceded = false) {
    return this.disposed
      ? { components: [] as PiComponent[] }
      : this.builder.changelog("startup", preceded);
  }
  fullChangelog() {
    return this.disposed
      ? { components: [] as PiComponent[] }
      : this.builder.changelog("full");
  }
  policyNotice(
    kind: "version" | "packages" | "warning" | "bug",
    value: unknown,
  ) {
    return this.disposed ? [] : this.builder.policyNotice(kind, value);
  }
  subscriptionWarning(
    session: DesktopSdkContext["session"],
    current: () => boolean,
  ) {
    return this.disposed
      ? Promise.resolve([])
      : this.builder.subscriptionWarning(
          session,
          () => !this.disposed && current(),
        );
  }
  restoreTitle() {
    if (!this.disposed) this.builder.restoreTitle();
  }
  crashInstructions() {
    return this.builder.crashInstructions();
  }
  headerEntries(replacement?: PiComponent, expanded = false) {
    if (this.disposed) return [];
    const active =
      replacement ??
      this.header.find((entry) => entry.component.constructor.name !== "Spacer")
        ?.component;
    if (
      active &&
      (active !== this.activeHeader || expanded !== this.headerExpanded)
    ) {
      const set = Reflect.get(active, "setExpanded");
      if (typeof set === "function") Reflect.apply(set, active, [expanded]);
      this.activeHeader = active;
      this.headerExpanded = expanded;
    }
    return this.header.map((entry) =>
      entry.component.constructor.name === "Spacer" || !replacement
        ? entry
        : { ...entry, component: replacement },
    );
  }
  showResources(
    options: { force?: boolean; showDiagnosticsWhenQuiet?: boolean } = {},
  ) {
    if (this.disposed) return [];
    this.resourceOptions = {
      force: options.force ?? false,
      showDiagnosticsWhenQuiet: options.showDiagnosticsWhenQuiet ?? false,
    };
    this.resourceSignature = undefined;
    return this.resourceEntries(this.expanded ?? false);
  }
  resourceEntries(expanded: boolean) {
    if (this.disposed) return [];
    const session = this.context().session,
      loader = session.resourceLoader;
    const extensions = loader.getExtensions();
    const signature = JSON.stringify({
      quiet: session.settingsManager.getQuietStartup(),
      options: this.resourceOptions,
      context: loader.getAgentsFiles(),
      system: loader.getSystemPromptSource(),
      append: loader.getAppendSystemPromptSources(),
      skills: loader.getSkills(),
      prompts: loader.getPrompts(),
      themes: loader.getThemes(),
      extensions: extensions.extensions.map((extension) => ({
        path: extension.path,
        sourceInfo: extension.sourceInfo,
        hidden: extension.hidden,
      })),
      errors: extensions.errors,
      warnings: extensions.warnings,
      commands: session.extensionRunner.getCommandDiagnostics(),
      shortcuts: session.extensionRunner.getShortcutDiagnostics(),
      registered: session.extensionRunner
        .getRegisteredCommands()
        .map((command) => [
          command.name,
          command.invocationName,
          command.sourceInfo,
        ]),
    });
    if (signature !== this.resourceSignature) {
      this.resourceSignature = signature;
      this.resources = this.builder
        .resources(this.resourceOptions)
        .map((component, index) => ({
          id: `native-resource:${index}`,
          component,
        }));
      this.expanded = undefined;
    }
    if (this.expanded !== expanded) {
      for (const entry of this.resources) {
        const set = Reflect.get(entry.component, "setExpanded");
        if (typeof set === "function")
          Reflect.apply(set, entry.component, [expanded]);
      }
      this.expanded = expanded;
    }
    return this.resources;
  }
  pendingEntries(
    compactionQueue: { mode: "steer" | "followUp"; text: string }[] = [],
  ) {
    if (this.disposed) return [];
    const session = this.context().session;
    const signature = JSON.stringify([
      session.getSteeringMessages(),
      session.getFollowUpMessages(),
      compactionQueue,
    ]);
    if (this.pendingSignature !== signature) {
      this.pendingSignature = signature;
      this.pending = this.builder
        .pending(compactionQueue)
        .map((component, index) => ({
          id: `native-pending:${index}`,
          component,
        }));
    }
    return this.pending;
  }
  setWidget(
    key: string,
    lines: string[] | undefined,
    placement: Placement,
    factory = false,
  ) {
    if (this.disposed) return;
    this.builder.stringWidget(key, undefined);
    this.widgets.delete(key);
    if (lines !== undefined || factory)
      this.widgets.set(key, {
        placement,
        factory,
        component:
          lines !== undefined
            ? this.builder.stringWidget(key, lines)
            : undefined,
      });
    this.regions.clear();
  }
  widgetEntries(placement: Placement) {
    if (this.disposed) return [];
    const map = new Map<string, PiComponent>();
    for (const [key, widget] of this.widgets) {
      if (widget.placement !== placement) continue;
      const component = widget.factory
        ? this.context().desktop.nativeComponent(`widget:${key}`)
        : widget.component;
      if (component) map.set(key, component);
    }
    const signature = [...map.values()],
      previous = this.regions.get(placement);
    if (
      previous &&
      signature.length === previous.signature.length &&
      signature.every(
        (component, index) => component === previous.signature[index],
      )
    )
      return previous.entries;
    const entries = this.builder
      .widgetRegion(map, placement === "aboveEditor")
      .map((component, index) => ({
        id: `native-widget:${placement}:${index}`,
        component,
      }));
    this.regions.set(placement, { signature, entries });
    return entries;
  }
  widgetPresentation(key: string, width: number) {
    if (this.disposed) return undefined;
    const component = this.widgets.get(key)?.component;
    return component
      ? componentText(
          component.render(Math.max(3, width)).join("\n").trimEnd(),
          this.runtime.text,
        )
      : undefined;
  }
  widgetOrder() {
    return [...this.widgets.keys()];
  }
  invalidate() {
    if (this.disposed) return;
    for (const entry of [...this.header, ...this.resources, ...this.pending])
      entry.component.invalidate();
    for (const widget of this.widgets.values()) widget.component?.invalidate();
    // Original pending rows bake theme ANSI codes when they are constructed.
    this.pendingSignature = undefined;
  }
  resetSession() {
    this.builder.resetManagedStatus();
    const errors: unknown[] = [];
    for (const key of this.widgets.keys()) {
      try {
        this.builder.stringWidget(key, undefined);
      } catch (error) {
        errors.push(error);
      }
    }
    this.widgets.clear();
    this.regions.clear();
    this.resources = [];
    this.resourceSignature = undefined;
    this.resourceOptions = { force: false, showDiagnosticsWhenQuiet: true };
    this.pending = [];
    this.pendingSignature = undefined;
    this.expanded = undefined;
    if (errors.length) throw errors[0];
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.resetSession();
    } finally {
      this.header = [];
      this.activeHeader = undefined;
    }
  }
}
