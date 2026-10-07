import * as sdk from "@earendil-works/pi-coding-agent";
import type { DesktopHost } from "./host.ts";
import type { ManagedTools } from "./managed-tools.ts";
import type { DesktopStartup } from "./startup.ts";
import type { StartupPolicies } from "./startup-policies.ts";
import type { DesktopUIRegistry } from "./desktop-ui.ts";

export * from "@earendil-works/pi-coding-agent";

/** Native objects stay in Node so callbacks, streams and custom implementations survive. */
export interface DesktopSdkContext {
  readonly managedTools: ManagedTools;
  readonly startup: DesktopStartup;
  readonly startupPolicies: StartupPolicies;
  sdk: typeof sdk;
  host: DesktopHost;
  desktop: DesktopUIRegistry;
  signal?: AbortSignal;
  readonly runtime: sdk.AgentSessionRuntime;
  readonly session: sdk.AgentSession;
  readonly agent: sdk.AgentSession["agent"];
  readonly sessionManager: sdk.SessionManager;
  readonly modelRuntime: sdk.ModelRuntime;
  readonly settingsManager: sdk.SettingsManager;
  readonly resourceLoader: sdk.AgentSession["resourceLoader"];
  emit(name: string, data?: unknown): void;
}
export function sdkContext(
  host: DesktopHost,
  signal?: AbortSignal,
): DesktopSdkContext {
  return {
    sdk,
    get managedTools() {
      return host.managedTools;
    },
    get startup() {
      return host.startup;
    },
    get startupPolicies() {
      return host.startupPolicies;
    },
    host,
    desktop: host.desktopUI,
    signal,
    get runtime() {
      if (!host.runtime) throw new Error("Workspace has not been initialized");
      return host.runtime;
    },
    get session() {
      return host.session;
    },
    get agent() {
      return host.session.agent;
    },
    get sessionManager() {
      return host.session.sessionManager;
    },
    get modelRuntime() {
      return host.session.modelRuntime;
    },
    get settingsManager() {
      return host.session.settingsManager;
    },
    get resourceLoader() {
      return host.session.resourceLoader;
    },
    emit(name: string, data?: unknown) {
      host.emitEvent({ type: "activity", name: `sdk:${name}`, data });
    },
  };
}

export type DesktopSdkOperation<T = unknown> = (
  context: DesktopSdkContext,
  args: Record<string, unknown>,
) => T | Promise<T>;

export type DesktopRuntimeFactory = (
  options: Parameters<sdk.CreateAgentSessionRuntimeFactory>[0],
  createDefault: sdk.CreateAgentSessionRuntimeFactory,
  api: typeof sdk,
) => ReturnType<sdk.CreateAgentSessionRuntimeFactory>;
