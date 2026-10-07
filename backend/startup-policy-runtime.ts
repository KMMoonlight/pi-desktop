import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getPackageDir,
  InteractiveMode,
  VERSION,
  type ModelRuntime,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

export interface PiRelease {
  version: string;
  packageName?: string;
  note?: string;
}
export interface PiCrash {
  timestamp: string;
  version: string;
  kind: "uncaught_exception" | "fatal_error";
  message: string;
  stack: string | null;
  sessionFile: string | null;
  cwd: string;
  notified?: boolean;
}
export interface StartupPolicyRuntime {
  appName: string;
  refreshCatalogs(
    runtime: ModelRuntime,
    signal: AbortSignal,
  ): ReturnType<ModelRuntime["refresh"]>;
  checkVersion(version: string): Promise<PiRelease | undefined>;
  checkTmux(): Promise<string | undefined>;
  readCrashes(path: string): PiCrash[];
  takeCrash(path: string, now?: number): PiCrash | undefined;
  clearCrashes(path: string): void;
  recordCrash(
    crash: {
      kind: PiCrash["kind"];
      error: unknown;
      cwd: string;
      sessionFile?: string;
    },
    path: string,
  ): PiCrash | undefined;
  extensionHint(error: unknown, session: AgentSession): string | undefined;
  killChildren(): void;
}
let loaded: Promise<StartupPolicyRuntime> | undefined;
export function loadStartupPolicyRuntime(): Promise<StartupPolicyRuntime> {
  if (VERSION !== "1.0.0")
    throw new Error(
      `Pi ${VERSION}: startup policy integration requires a compatibility update`,
    );
  return (loaded ??= (async () => {
    const load = (path: string) =>
      import(pathToFileURL(join(getPackageDir(), "dist", path)).href);
    const [catalog, version, crash, shell, config] = await Promise.all([
      load("modes/interactive/model-catalog-refresh.js"),
      load("utils/version-check.js"),
      load("core/crash-log.js"),
      load("utils/shell.js"),
      load("config.js"),
    ]);
    return {
      appName: config.APP_NAME,
      refreshCatalogs: catalog.refreshModelCatalogs,
      checkVersion: version.checkForNewPiVersion,
      checkTmux: () =>
        Reflect.apply(
          Reflect.get(InteractiveMode.prototype, "checkTmuxKeyboardSetup"),
          {},
          [],
        ),
      readCrashes: crash.readCrashLog,
      takeCrash: crash.takeUnnotifiedCrash,
      clearCrashes: crash.clearCrashLog,
      recordCrash: crash.recordCrash,
      extensionHint(error, session) {
        return Reflect.apply(
          Reflect.get(InteractiveMode.prototype, "getCrashExtensionHint"),
          { session },
          [error],
        );
      },
      killChildren: shell.killTrackedDetachedChildren,
    };
  })());
}
