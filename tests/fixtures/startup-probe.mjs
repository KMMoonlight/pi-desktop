import { createRequire } from "node:module";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const states = new WeakMap();
const image = {
  type: "image",
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/ACiqeP8EkgJKJCPrYwAAAABJRU5ErkJggg==",
};
export default async function (
  { host, desktop, sdk, startup },
  { action = "inspect", mode = "collapsed" } = {},
) {
  let state = states.get(host);
  if (action === "seed") {
    const session = host.session,
      settings = session.settingsManager;
    state = {
      originalCwd: host.runtime.cwd,
      workspace: join(host.runtime.cwd, "startup-content-workspace"),
      previous: {
        version: settings.getLastChangelogVersion(),
        collapse: settings.getCollapseChangelog(),
        quiet: settings.getQuietStartup(),
      },
      startup,
    };
    states.set(host, state);
    await mkdir(state.workspace, { recursive: true });
    settings.setLastChangelogVersion(
      mode === "collapsed" || mode === "expanded" ? "0.99.0" : sdk.VERSION,
    );
    settings.setCollapseChangelog(mode === "collapsed");
    settings.setQuietStartup(mode === "collapsed" ? true : false);
    await settings.flush();
    const options =
      mode === "messages"
        ? {
            initialMessage: "Native first startup input",
            initialImages: [image],
            initialMessages: ["Native next startup input"],
          }
        : mode === "diagnostics"
          ? {
              startupDiagnostics: [
                { type: "info", message: "Native startup information" },
                { type: "warning", message: "Native startup warning" },
                { type: "error", message: "Native startup error" },
              ],
              migratedProviders: ["desktop-test"],
              modelFallbackMessage: "Native model fallback",
            }
          : {};
    await host.initialize(state.workspace, options);
    state.scope = desktop.terminalRuntime.capture();
    state.app = state.scope.application;
    state.rows = state.app.noticeEntries(0).map((entry) => entry.component);
    if (mode !== "messages") {
      const require = createRequire(join(sdk.getPackageDir(), "package.json"));
      const api = await import(
        pathToFileURL(require.resolve("@earendil-works/pi-tui")).href
      );
      state.container = new api.Container();
      for (const row of state.rows) state.container.addChild(row);
      host.session.extensionRunner
        .getUIContext()
        .setWidget("startup-preview", () => state.container);
      for (
        let attempt = 0;
        attempt < 100 &&
        desktop.nativeComponent("widget:startup-preview") !== state.container;
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!state) throw new Error("Startup content probe is not seeded");
  if (action === "reload") await host.action({ action: "resources.reload" });
  if (action === "full") {
    const full = startup.changelog();
    state.fullClasses = full.components.map(
      (component) => component.constructor.name,
    );
    state.fullText = full.markdown;
  }
  if (action === "cleanup") {
    host.session.extensionRunner
      .getUIContext()
      .setWidget("startup-preview", undefined);
    const settings = host.session.settingsManager;
    settings.setLastChangelogVersion(state.previous.version ?? sdk.VERSION);
    settings.setCollapseChangelog(state.previous.collapse);
    settings.setQuietStartup(state.previous.quiet);
    await settings.flush();
    await host.initialize(state.originalCwd);
    await rm(state.workspace, { recursive: true, force: true });
  }
  host.publish();
  return {
    same: state.startup === startup,
    scopeSame: state.scope === desktop.terminalRuntime.capture(),
    state: startup.snapshot(),
    classes: state.rows.map((component) => component.constructor.name),
    fullClasses: state.fullClasses,
    fullHasPinnedLinks: state.fullText?.includes("/v1.0.0/"),
    rendered: state.container?.render(60).join("\n"),
    userMessages: host.session.messages
      .filter((message) => message.role === "user")
      .map((message) => ({
        text:
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n"),
        images:
          typeof message.content === "string"
            ? 0
            : message.content.filter((part) => part.type === "image").length,
      })),
    rows: state.app.noticeEntries(0).length,
  };
}
