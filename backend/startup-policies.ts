import { join } from "node:path";
import {
  DefaultPackageManager,
  VERSION,
  type AgentSession,
  type AgentSessionRuntime,
} from "@earendil-works/pi-coding-agent";
import type { DesktopHost } from "./host.ts";
import {
  loadStartupPolicyRuntime,
  type PiCrash,
  type StartupPolicyRuntime,
} from "./startup-policy-runtime.ts";
import type {
  StartupPoliciesSnapshot,
  StartupPolicyName,
} from "../shared/types.ts";

export const startupPolicyNames: StartupPolicyName[] = [
  "catalogs",
  "version",
  "packages",
  "tmux",
  "subscription",
];

/** Original background checks with explicit desktop lifetime and inspectable results. */
export class StartupPolicies {
  private owner?: AgentSessionRuntime;
  private started = false;
  private crashTaken = false;
  private subscriptionReady = false;
  private modelSignature?: string;
  private api?: StartupPolicyRuntime;
  private revision = 0;
  private jobs = new Map<StartupPolicyName, number>();
  private state: StartupPoliciesSnapshot = {
    automaticStarted: false,
    checks: {},
  };
  constructor(private host: DesktopHost) {}
  snapshot(): StartupPoliciesSnapshot {
    return structuredClone(this.state);
  }
  private inspectResult(name: StartupPolicyName, result: unknown) {
    if (name === "catalogs" && result) {
      const native = result as Awaited<
        ReturnType<AgentSession["modelRuntime"]["refresh"]>
      >;
      return {
        aborted: native.aborted,
        errors: Array.from(native.errors, ([provider, error]) => ({
          provider,
          message: error.message,
          stack: error.stack,
        })),
      };
    }
    try {
      return structuredClone(result);
    } catch {
      return undefined;
    }
  }
  async runTransport(name: StartupPolicyName, signal?: AbortSignal) {
    return this.inspectResult(name, await this.run(name, signal));
  }
  private scope() {
    return this.host.desktopUI.terminalRuntime.capture();
  }
  start() {
    if (this.owner !== this.host.runtime) {
      this.owner = this.host.runtime;
      this.started = false;
      this.crashTaken = false;
      this.subscriptionReady = false;
      this.modelSignature = undefined;
      this.jobs.clear();
      this.state = { automaticStarted: false, checks: {} };
    }
    if (this.started) return;
    this.started = true;
    if (process.env.PI_DESKTOP_SKIP_STARTUP_POLICIES === "1") return;
    this.state.automaticStarted = true;
    for (const name of ["catalogs", "version", "packages", "tmux"] as const)
      void this.run(name).catch(() => {});
  }
  activateSubscription() {
    this.subscriptionReady = true;
    this.observeModel();
  }
  observeModel() {
    if (
      !this.subscriptionReady ||
      process.env.PI_DESKTOP_SKIP_STARTUP_POLICIES === "1" ||
      !this.host.runtime
    )
      return;
    const session = this.host.runtime.session;
    const signature = JSON.stringify([
      session.sessionId,
      session.model?.provider,
      session.model?.id,
      session.modelRuntime.getProviderAuthStatus("anthropic"),
    ]);
    if (signature === this.modelSignature) return;
    this.modelSignature = signature;
    void this.run("subscription").catch(() => {});
  }
  async run(name: StartupPolicyName, signal?: AbortSignal): Promise<unknown> {
    if (!startupPolicyNames.includes(name))
      throw new Error("Invalid startup policy");
    return this.host.withSdk(
      async ({ runtime, session, signal: hostLife }) => {
        const scope = this.scope(),
          application = scope.application;
        if (!application)
          throw new Error("Interactive application has not been initialized");
        const life = AbortSignal.any([hostLife!, this.host.sessionSignal]);
        const job = ++this.revision;
        this.jobs.set(name, job);
        this.state.checks[name] = {
          state: "running",
          sessionId: session.sessionId,
        };
        const current = () =>
          !life.aborted &&
          this.host.runtime === runtime &&
          runtime.session === session &&
          this.scope() === scope;
        const latest = () => this.jobs.get(name) === job;
        const check = () => {
          life.throwIfAborted();
          if (!current())
            throw new DOMException(
              "Startup policy session was retired",
              "AbortError",
            );
        };
        const show = (
          kind: "version" | "packages" | "warning",
          value: unknown,
        ) => {
          if (current())
            application.appendNoticeComponents(
              application.content.policyNotice(kind, value),
            );
        };
        let timeout: NodeJS.Timeout | undefined;
        try {
          check();
          const api = (this.api ??= await loadStartupPolicyRuntime());
          check();
          let result: unknown;
          if (name === "catalogs") {
            if (!process.env.PI_OFFLINE) {
              const controller = new AbortController();
              timeout = setTimeout(() => controller.abort(), 15000);
              result = await api.refreshCatalogs(
                session.modelRuntime,
                AbortSignal.any([life, controller.signal]),
              );
              check();
            }
          } else if (name === "version") {
            result = await api.checkVersion(VERSION);
            if (result) show("version", result);
          } else if (name === "packages") {
            result = [];
            if (!process.env.PI_OFFLINE) {
              try {
                const manager = new DefaultPackageManager({
                  cwd: runtime.cwd,
                  agentDir: this.host.agentDir,
                  settingsManager: session.settingsManager,
                });
                result = (await manager.checkForAvailableUpdates()).map(
                  (update) => update.displayName,
                );
              } catch {
                result = [];
              }
            }
            if ((result as string[]).length) show("packages", result);
          } else if (name === "tmux") {
            result = await api.checkTmux();
            if (result) show("warning", result);
          } else {
            const components = await application.content.subscriptionWarning(
              session,
              current,
            );
            if (current()) application.appendNoticeComponents(components);
            result = components.length > 0;
          }
          check();
          if (latest())
            this.state.checks[name] = {
              state: "settled",
              sessionId: session.sessionId,
              result: this.inspectResult(name, result),
            };
          return result;
        } catch (error) {
          if (latest())
            this.state.checks[name] = {
              state: current() ? "failed" : "retired",
              sessionId: session.sessionId,
              error: error instanceof Error ? error.message : String(error),
            };
          throw error;
        } finally {
          clearTimeout(timeout);
          // Native Windows package checks can replace the shared console title.
          if (name === "packages" && process.platform === "win32" && current())
            application.content.restoreTitle();
          if (current()) this.host.publish();
        }
      },
      {},
      signal,
    );
  }
  async startupCrash() {
    if (this.crashTaken) return undefined;
    this.crashTaken = true;
    return this.takeCrash(true);
  }
  async readCrashes() {
    return (this.api ??= await loadStartupPolicyRuntime()).readCrashes(
      join(this.host.agentDir, "crashes.json"),
    );
  }
  async takeCrash(display = false, now?: number) {
    const runtime = this.host.runtime,
      scope = this.scope(),
      signal = this.host.sessionSignal;
    const api = (this.api ??= await loadStartupPolicyRuntime());
    if (
      signal.aborted ||
      runtime !== this.host.runtime ||
      scope !== this.scope()
    )
      return undefined;
    const crash = api.takeCrash(join(this.host.agentDir, "crashes.json"), now);
    if (crash && display && scope.application) {
      const message = `${api.appName} crashed on ${new Date(crash.timestamp).toLocaleString()} (${crash.message}). Run /bug to report it; the crash details are attached automatically.`;
      scope.application.appendNoticeComponents(
        scope.application.content.policyNotice("warning", message),
      );
      this.host.publish();
    }
    return crash;
  }
  async clearCrashes() {
    (this.api ??= await loadStartupPolicyRuntime()).clearCrashes(
      join(this.host.agentDir, "crashes.json"),
    );
  }
  async recordCrash(kind: PiCrash["kind"], error: unknown) {
    if (!["uncaught_exception", "fatal_error"].includes(kind))
      throw new Error("Invalid crash kind");
    const session = this.host.runtime?.session;
    const details = {
      kind,
      error,
      cwd: session?.sessionManager.getCwd() ?? process.cwd(),
      sessionFile: session?.sessionFile,
    };
    return (this.api ??= await loadStartupPolicyRuntime()).recordCrash(
      details,
      join(this.host.agentDir, "crashes.json"),
    );
  }
  async crashHint(error: unknown) {
    const session = this.host.runtime?.session;
    const api = (this.api ??= await loadStartupPolicyRuntime());
    return session ? api.extensionHint(error, session) : undefined;
  }
  crashInstructions() {
    return this.scope().application?.content.crashInstructions();
  }
  maybeBug(
    message: Extract<AgentSession["messages"][number], { role: "assistant" }>,
  ) {
    const application = this.scope().application;
    if (application)
      application.appendNoticeComponents(
        application.content.policyNotice("bug", message),
      );
  }
}
