import type { InteractiveModeOptions } from "@earendil-works/pi-coding-agent";
import type { DesktopHost } from "./host.ts";
import type { StartupSnapshot } from "../shared/types.ts";
import { bindSessionAbort } from "./session-abort.ts";

export type DesktopStartupOptions = Pick<
  InteractiveModeOptions,
  | "migratedProviders"
  | "startupDiagnostics"
  | "modelFallbackMessage"
  | "initialMessage"
  | "initialImages"
  | "initialMessages"
  | "verbose"
  | "tuiMode"
  | "initialThemeSetting"
  | "terminal"
  | "autoTrustOnReloadCwd"
>;

export function startupOptions(value: unknown): DesktopStartupOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid startup options");
  const input = value as Record<string, unknown>,
    options: DesktopStartupOptions = {};
  for (const key of [
    "initialMessage",
    "modelFallbackMessage",
    "initialThemeSetting",
    "autoTrustOnReloadCwd",
  ] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string") throw new Error(`Invalid ${key}`);
      options[key] = input[key];
    }
  }
  if (input.tuiMode !== undefined) {
    if (input.tuiMode !== "regular" && input.tuiMode !== "fullscreen")
      throw new Error("Invalid tuiMode");
    options.tuiMode = input.tuiMode;
  }
  if (input.terminal !== undefined)
    throw new Error(
      "Invalid terminal: pass a Terminal object through the Node SDK host, not JSON transport",
    );
  for (const key of ["initialMessages", "migratedProviders"] as const) {
    const items = input[key];
    if (items !== undefined) {
      if (
        !Array.isArray(items) ||
        !items.every((item) => typeof item === "string")
      )
        throw new Error(`Invalid ${key}`);
      options[key] = items.slice();
    }
  }
  if (input.verbose !== undefined) {
    if (typeof input.verbose !== "boolean")
      throw new Error("Invalid verbose option");
    options.verbose = input.verbose;
  }
  if (input.startupDiagnostics !== undefined) {
    if (!Array.isArray(input.startupDiagnostics))
      throw new Error("Invalid startup diagnostics");
    options.startupDiagnostics = input.startupDiagnostics.map((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        !["info", "warning", "error"].includes(item.type) ||
        typeof item.message !== "string"
      )
        throw new Error("Invalid startup diagnostic");
      return { type: item.type, message: item.message };
    });
  }
  if (input.initialImages !== undefined) {
    if (!Array.isArray(input.initialImages))
      throw new Error("Invalid initial images");
    options.initialImages = input.initialImages.map((item) => {
      if (
        !item ||
        item.type !== "image" ||
        typeof item.data !== "string" ||
        typeof item.mimeType !== "string"
      )
        throw new Error("Invalid initial image");
      return { type: "image", data: item.data, mimeType: item.mimeType };
    });
  }
  return options;
}

/** Startup inputs stay native; no alternate session, parser or model loop. */
export class DesktopStartup {
  private state: StartupSnapshot = {
    state: "idle",
    attempted: 0,
    completed: 0,
    errors: [],
  };
  private active?: Promise<StartupSnapshot>;
  configuration: DesktopStartupOptions = {};
  constructor(private host: DesktopHost) {}
  snapshot(): StartupSnapshot {
    return { ...this.state, errors: this.state.errors.slice() };
  }
  run(
    options: DesktopStartupOptions = {},
    signal?: AbortSignal,
  ): Promise<StartupSnapshot> {
    if (this.active)
      return Promise.reject(new Error("Startup input is already running"));
    const pending = this.host.withSdk(
      async ({ runtime, session, desktop, signal: life }) => {
        const scope = desktop.terminalRuntime.capture();
        const cancelled = new AbortController();
        const lifetime = AbortSignal.any([
          life!,
          this.host.sessionSignal,
          cancelled.signal,
        ]);
        const current = () =>
          this.host.runtime === runtime &&
          runtime.session === session &&
          desktop.terminalRuntime.capture() === scope &&
          !lifetime.aborted;
        const application = scope.application!;
        if (!application)
          throw new Error("Interactive application has not been initialized");
        this.state = {
          state: "running",
          sessionId: session.sessionId,
          attempted: 0,
          completed: 0,
          errors: [],
        };
        const check = () => {
          lifetime.throwIfAborted();
          if (!current())
            throw new DOMException("Startup session was retired", "AbortError");
        };
        let nativeAborting = false;
        const restoreAbort = bindSessionAbort(session, () => {
          // Native accepted transitions invoke abort before awaiting shutdown
          // handlers. Retire the batch now, while keeping those handlers live.
          nativeAborting = true;
          try {
            cancelled.abort();
          } finally {
            nativeAborting = false;
          }
        });
        const abort = () => {
          if (!nativeAborting) void session.abort().catch(() => {});
        };
        lifetime.addEventListener("abort", abort, { once: true });
        try {
          check();
          this.host.startupPolicies.start();
          const changelog = application.content.startupChangelog(
            application.noticeEntries(0).length > 0,
          );
          this.state.changelog = changelog.markdown;
          application.appendNoticeComponents(changelog.components, true);
          for (const diagnostic of options.startupDiagnostics ??
            runtime.diagnostics)
            this.host.notice(diagnostic.message, diagnostic.type);
          if (options.migratedProviders?.length)
            this.host.notice(
              `Migrated credentials to auth.json: ${options.migratedProviders.join(", ")}`,
              "warning",
            );
          const modelsError = session.modelRuntime.getError();
          if (modelsError)
            this.host.notice(`models.json error: ${modelsError}`, "error");
          const fallback =
            options.modelFallbackMessage ?? runtime.modelFallbackMessage;
          if (fallback) this.host.notice(fallback, "warning");
          await this.host.startupPolicies.startupCrash();
          check();
          this.host.startupPolicies.activateSubscription();
          this.host.publish();
          const messages = [
            ...(options.initialMessage
              ? [
                  {
                    text: options.initialMessage,
                    images: options.initialImages,
                  },
                ]
              : []),
            ...(options.initialMessages ?? []).map((text) => ({ text })),
          ];
          for (const message of messages) {
            check();
            this.state.attempted++;
            try {
              if ("images" in message)
                await session.prompt(message.text, { images: message.images });
              else await session.prompt(message.text);
              check();
              this.state.completed++;
            } catch (error) {
              check();
              const text =
                error instanceof Error
                  ? error.message
                  : "Unknown error occurred";
              this.state.errors.push(text);
              this.host.notice(text, "error");
            }
            this.host.publish();
          }
          check();
          this.state.state = "settled";
          return this.snapshot();
        } catch (error) {
          this.state.state = "retired";
          throw error;
        } finally {
          lifetime.removeEventListener("abort", abort);
          restoreAbort();
          this.host.publish();
        }
      },
      {},
      signal,
    );
    this.active = pending;
    void pending
      .finally(() => {
        if (this.active === pending) this.active = undefined;
      })
      .catch(() => {});
    return pending;
  }
  changelog(kind: "startup" | "full" = "full", display = false) {
    if (!this.host.runtime)
      throw new Error("Workspace has not been initialized");
    const application =
      this.host.desktopUI.terminalRuntime.capture().application!;
    if (!application)
      throw new Error("Interactive application has not been initialized");
    const result =
      kind === "startup"
        ? application.content.startupChangelog(
            application.noticeEntries(0).length > 0,
          )
        : application.content.fullChangelog();
    if (display) {
      application.appendNoticeComponents(result.components);
      this.host.publish();
    }
    return result;
  }
}
