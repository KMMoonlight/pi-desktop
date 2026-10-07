import { createRequire } from "node:module";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const states = new WeakMap();
export default async function (
  { host, desktop, sdk, startupPolicies },
  { action = "inspect", mode = "version" } = {},
) {
  let state = states.get(host);
  if (action === "seed") {
    state = {
      cwd: host.runtime.cwd,
      workspace: join(host.runtime.cwd, `startup-policy-${mode}`),
    };
    states.set(host, state);
    try {
      await mkdir(state.workspace, { recursive: true });
      await host.initialize(state.workspace);
      const scope = desktop.terminalRuntime.capture(),
        app = scope.application;
      state.scope = scope;
      state.app = app;
      state.startupPolicies = startupPolicies;
      const count = app.noticeEntries(0).length;
      if (mode === "version") {
        const saved = {
          fetch: globalThis.fetch,
          offline: process.env.PI_OFFLINE,
          skip: process.env.PI_SKIP_VERSION_CHECK,
        };
        delete process.env.PI_OFFLINE;
        delete process.env.PI_SKIP_VERSION_CHECK;
        globalThis.fetch = async (url, ...args) =>
          String(url) === "https://pi.dev/api/latest-version"
            ? Response.json({
                version: "2.0.0",
                note: "**Native policy release** with [changelog](https://pi.dev/changelog).",
              })
            : saved.fetch(url, ...args);
        try {
          state.result = await startupPolicies.run("version");
        } finally {
          globalThis.fetch = saved.fetch;
          for (const [key, value] of [
            ["PI_OFFLINE", saved.offline],
            ["PI_SKIP_VERSION_CHECK", saved.skip],
          ]) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      } else if (mode === "packages")
        app.appendNoticeComponents(
          app.content.policyNotice("packages", [
            "npm:original-desktop-package",
            "git:original-desktop-package",
          ]),
        );
      else if (mode === "crash") {
        await startupPolicies.recordCrash(
          "fatal_error",
          new Error("Native desktop crash fixture"),
        );
        state.result = await startupPolicies.takeCrash(true);
      } else if (mode === "subscription") {
        const session = host.session,
          original = session.modelRuntime.checkAuth;
        session.agent.state.model = { ...session.model, provider: "anthropic" };
        session.modelRuntime.checkAuth = async () => ({ type: "oauth" });
        try {
          state.result = await startupPolicies.run("subscription");
        } finally {
          session.modelRuntime.checkAuth = original;
        }
      } else
        startupPolicies.maybeBug({
          stopReason: "error",
          errorMessage: "Native unexpected failure",
        });
      state.rows = app
        .noticeEntries(0)
        .slice(count)
        .map((entry) => entry.component);
      const require = createRequire(join(sdk.getPackageDir(), "package.json")),
        api = await import(
          pathToFileURL(require.resolve("@earendil-works/pi-tui")).href
        );
      state.container = new api.Container();
      for (const row of state.rows) state.container.addChild(row);
      host.session.extensionRunner
        .getUIContext()
        .setWidget("startup-policy", () => state.container);
      for (
        let attempt = 0;
        attempt < 100 &&
        desktop.nativeComponent("widget:startup-policy") !== state.container;
        attempt++
      )
        await new Promise((done) => setTimeout(done, 10));
    } catch (error) {
      try {
        await host.initialize(state.cwd);
      } finally {
        states.delete(host);
        await rm(state.workspace, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
      throw error;
    }
  }
  if (!state) throw new Error("Startup policy probe is not seeded");
  if (action === "clear") {
    host.session.extensionRunner
      .getUIContext()
      .setWidget("startup-policy", undefined);
    if (mode === "crash") await startupPolicies.clearCrashes();
    await host.initialize(state.cwd);
    await rm(state.workspace, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    states.delete(host);
    return { cleared: true };
  }
  return {
    same:
      startupPolicies === state.startupPolicies &&
      desktop.terminalRuntime.capture() === state.scope,
    classes: state.rows.map((row) => row.constructor.name),
    rows: state.rows.length,
    result: state.result,
    text: state.container.render(80).join("\n"),
  };
}
