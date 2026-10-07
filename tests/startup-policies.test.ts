import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  InteractiveMode,
  VERSION,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { loadStartupPolicyRuntime } from "../backend/startup-policy-runtime.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";
function barrier<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    release = done;
  });
  return { promise, release };
}
async function until(ready: () => boolean) {
  const end = Date.now() + 10000;
  while (!ready()) {
    assert.ok(Date.now() < end, "Startup policy boundary did not arrive");
    await new Promise((done) => setTimeout(done, 10));
  }
}
function environment(keys: string[]) {
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  return () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}
const rows = (host: DesktopHost) =>
  host.desktopUI.terminalRuntime
    .capture()
    .application!.noticeEntries(0)
    .map((entry) => entry.component);

test("native policy notifications retain original classes, padding, rendering and once-only bug hints", async () => {
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const content =
      host.desktopUI.terminalRuntime.capture().application!.content;
    const tui = await loadTuiApi(),
      Container = Reflect.get(tui, "Container"),
      native = Object.create(InteractiveMode.prototype);
    Object.defineProperties(native, {
      session: { value: host.session },
      settingsManager: { value: host.session.settingsManager },
      sessionManager: { value: host.session.sessionManager },
    });
    Object.assign(native, {
      chatContainer: new Container(),
      ui: { requestRender() {} },
      outputPad: host.session.settingsManager.getOutputPad(),
    });
    for (const [kind, method, value] of [
      [
        "version",
        "showNewVersionNotification",
        {
          version: "2.0.0",
          packageName: "native-package",
          note: "**Native release** with [links](https://pi.dev/changelog)",
        },
      ],
      [
        "packages",
        "showPackageUpdateNotification",
        ["npm:original-package", "git:original-package"],
      ],
      ["warning", "showWarning", "Original policy warning"],
      [
        "bug",
        "maybeSuggestBugReport",
        { stopReason: "error", errorMessage: "Native unexpected failure" },
      ],
      [
        "bug",
        "maybeSuggestBugReport",
        { stopReason: "error", errorMessage: "Second unexpected failure" },
      ],
    ] as const) {
      native.chatContainer.clear();
      Reflect.apply(Reflect.get(InteractiveMode.prototype, method), native, [
        value,
      ]);
      const actual = content.policyNotice(kind, value);
      assert.deepEqual(
        actual.map((item) => item.constructor.name),
        native.chatContainer.children.map(
          (item: object) => item.constructor.name,
        ),
      );
      for (const width of [18, 80])
        assert.deepEqual(
          actual.flatMap((item) => item.render(width)),
          native.chatContainer.render(width),
        );
    }
    assert.equal(
      host.startupPolicies.crashInstructions(),
      Reflect.apply(
        Reflect.get(InteractiveMode.prototype, "crashReportInstructions"),
        native,
        [],
      ),
    );
    assert.equal(
      await host.withSdk((context) => context.startupPolicies),
      host.startupPolicies,
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});

test("original crash log retains records, age filtering, newest selection, notification and explicit paths", async () => {
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir),
    api = await loadStartupPolicyRuntime();
  try {
    for (let index = 0; index < 7; index++)
      await host.startupPolicies.recordCrash(
        "fatal_error",
        new Error(`Native crash ${index}`),
      );
    const records = (await host.action({ action: "crash.read" })) as {
      message: string;
      stack: string;
      cwd: string;
    }[];
    assert.equal(records.length, 5);
    assert.equal(records[0].message, "Native crash 2");
    assert.ok(records[4].stack.includes("Native crash 6"));
    const path = join(files.agentDir, "crashes.json");
    assert.deepEqual(records, api.readCrashes(path));
    const old = {
      ...records[0],
      timestamp: new Date(Date.now() - 8 * 86400000).toISOString(),
    };
    await writeFile(path, JSON.stringify([old]));
    assert.equal(await host.startupPolicies.takeCrash(), undefined);
    await host.action({
      action: "crash.record",
      args: {
        kind: "uncaught_exception",
        message: "Native recent crash",
        stack: "Original crash stack",
      },
    });
    await host.initialize(files.cwd, {
      startupDiagnostics: [{ type: "info", message: "Before native crash" }],
    });
    const output = rows(host)
      .flatMap((item) => item.render(100))
      .join("\n");
    assert.ok(
      output.indexOf("Before native crash") <
        output.indexOf("Native recent crash"),
    );
    assert.match(
      stripVTControlCharacters(output).replace(/\s+/g, " "),
      /crash details are attached automatically/,
    );
    assert.ok(
      (await host.startupPolicies.readCrashes()).every(
        (record) => record.notified,
      ),
    );
    await host.startup.run();
    assert.equal(
      rows(host).filter((item) =>
        item.render(100).join("\n").includes("Native recent crash"),
      ).length,
      1,
    );
    assert.equal(await host.startupPolicies.takeCrash(), undefined);
    await host.action({ action: "crash.clear" });
    assert.deepEqual(await host.startupPolicies.readCrashes(), []);
  } finally {
    await host.dispose();
    await files.close();
  }
});

test("shared original catalog refresh keeps independent cancellation, native result identity and usable callbacks", async () => {
  const restoreEnv = environment(["PI_OFFLINE"]);
  delete process.env.PI_OFFLINE;
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir),
    gate =
      barrier<Awaited<ReturnType<AgentSession["modelRuntime"]["refresh"]>>>();
  try {
    await host.initialize(files.cwd);
    const first = new AbortController(),
      second = new AbortController();
    let calls = 0,
      originalSignal: AbortSignal | undefined;
    const value = Object.assign(
      { aborted: false, errors: new Map<string, Error>() },
      { callback: () => "Native callback" },
    );
    host.session.modelRuntime.refresh = (options) => {
      calls++;
      originalSignal = options!.signal;
      return gate.promise;
    };
    const a = host.startupPolicies.run("catalogs", first.signal),
      b = host.startupPolicies.run("catalogs", second.signal);
    const cancelled = assert.rejects(a, { name: "AbortError" });
    await until(() => calls > 0);
    assert.equal(calls, 1);
    first.abort();
    await cancelled;
    assert.equal(originalSignal!.aborted, false);
    gate.release(value);
    assert.equal(await b, value);
    assert.equal(value.callback(), "Native callback");
    assert.equal(
      host.startupPolicies.snapshot().checks.catalogs!.state,
      "settled",
    );
    assert.deepEqual(host.startupPolicies.snapshot().checks.catalogs!.result, {
      aborted: false,
      errors: [],
    });
    assert.equal(originalSignal!.aborted, false);
  } finally {
    gate.release({ aborted: false, errors: new Map() });
    await host.dispose();
    await files.close();
    restoreEnv();
  }
});

for (const end of ["cancel", "reload", "session", "dispose"] as const)
  test(
    `catalog policy cancellation follows native coordinator and ${end} retirement`,
    { timeout: 20000 },
    async () => {
      const restoreEnv = environment(["PI_OFFLINE"]);
      delete process.env.PI_OFFLINE;
      const files = await createFixture(),
        host = new DesktopHost(files.agentDir),
        gate =
          barrier<
            Awaited<ReturnType<AgentSession["modelRuntime"]["refresh"]>>
          >();
      try {
        await host.initialize(files.cwd);
        const controller = new AbortController();
        let nativeSignal: AbortSignal | undefined;
        host.session.modelRuntime.refresh = (options) => {
          nativeSignal = options!.signal;
          return gate.promise;
        };
        const pending = host.startupPolicies.run("catalogs", controller.signal),
          cancelled = assert.rejects(pending, { name: "AbortError" });
        await until(() => !!nativeSignal);
        if (end === "cancel") controller.abort();
        else if (end === "reload") await host.session.reload();
        else if (end === "session") await host.runtime!.newSession();
        else await host.dispose();
        await cancelled;
        assert.equal(nativeSignal!.aborted, true);
        assert.equal(
          host.startupPolicies.snapshot().checks.catalogs!.state,
          "retired",
        );
      } finally {
        gate.release({ aborted: false, errors: new Map() });
        await host.dispose();
        await files.close();
        restoreEnv();
      }
    },
  );

for (const ending of ["cancel", "workspace", "dispose"] as const)
  test(
    `uncancellable original version check retains drain and suppresses notices after ${ending}`,
    { timeout: 20000 },
    async () => {
      const restoreEnv = environment(["PI_OFFLINE", "PI_SKIP_VERSION_CHECK"]);
      delete process.env.PI_OFFLINE;
      delete process.env.PI_SKIP_VERSION_CHECK;
      const originalFetch = globalThis.fetch,
        response = barrier<Response>();
      let started = false;
      globalThis.fetch = async (url, ...args) => {
        if (String(url) === "https://pi.dev/api/latest-version") {
          started = true;
          return response.promise;
        }
        return originalFetch(url, ...args);
      };
      const files = await createFixture(),
        host = new DesktopHost(files.agentDir),
        controller = new AbortController();
      let closing: Promise<unknown> | undefined;
      try {
        await host.initialize(files.cwd);
        const original = host.desktopUI.terminalRuntime.capture().application!;
        const pending = host.startupPolicies.run("version", controller.signal),
          cancelled = assert.rejects(pending, { name: "AbortError" });
        await until(() => started);
        if (ending === "cancel") controller.abort();
        else if (ending === "workspace") await host.initialize(files.root);
        else {
          let done = false;
          closing = host.dispose().then(() => {
            done = true;
          });
          await new Promise((done) => setImmediate(done));
          assert.equal(done, false);
        }
        response.release(
          Response.json({ version: "2.0.0", note: "Obsolete policy release" }),
        );
        await cancelled;
        await closing;
        assert.equal(
          original
            .noticeEntries(0)
            .filter((entry) =>
              entry.component
                .render(100)
                .join("\n")
                .includes("Obsolete policy release"),
            ).length,
          0,
        );
        if (host.runtime)
          assert.equal(
            rows(host).filter((item) =>
              item.render(100).join("\n").includes("Obsolete policy release"),
            ).length,
            0,
          );
      } finally {
        response.release(Response.json({ version: VERSION }));
        await closing?.catch(() => {});
        await host.dispose();
        await files.close();
        globalThis.fetch = originalFetch;
        restoreEnv();
      }
    },
  );

for (const auth of ["oauth", "key", "regular", "disabled", "failure"] as const)
  test(`native subscription warning policy retains ${auth} gates and workspace lifetime`, async () => {
    const files = await createFixture(),
      host = new DesktopHost(files.agentDir);
    try {
      await host.initialize(files.cwd);
      host.session.agent.state.model = {
        ...host.session.model!,
        provider: "anthropic",
      };
      host.session.modelRuntime.checkAuth = async () => {
        if (auth === "failure") throw new Error("Native auth unavailable");
        return auth === "oauth" ? { type: "oauth" } : undefined;
      };
      host.session.modelRuntime.getAuth = async () => ({
        auth: {
          apiKey:
            auth === "key"
              ? "sk-ant-oat01-native-fixture"
              : "sk-ant-api03-native-fixture",
        },
      });
      if (auth === "disabled")
        host.session.settingsManager.setWarnings({
          anthropicExtraUsage: false,
        });
      assert.equal(
        await host.startupPolicies.run("subscription"),
        ["oauth", "key"].includes(auth),
      );
      assert.equal(await host.startupPolicies.run("subscription"), false);
      await host.runtime!.newSession();
      host.session.agent.state.model = {
        ...host.session.model!,
        provider: "anthropic",
      };
      host.session.modelRuntime.checkAuth = async () => ({ type: "oauth" });
      if (["oauth", "key"].includes(auth))
        assert.equal(await host.startupPolicies.run("subscription"), false);
    } finally {
      await host.dispose();
      await files.close();
    }
  });

test("SDK model selection automatically runs the native subscription warning once", async () => {
  const restoreEnv = environment(["PI_DESKTOP_SKIP_STARTUP_POLICIES"]);
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const session = host.session;
    const model = { ...session.model!, provider: "anthropic" };
    session.modelRuntime.checkAuth = async () => ({ type: "oauth" });
    process.env.PI_DESKTOP_SKIP_STARTUP_POLICIES = "0";
    await host.withSdk(({ session }) => session.setModel(model));
    await until(
      () =>
        host.startupPolicies.snapshot().checks.subscription?.state ===
        "settled",
    );
    assert.equal(host.session.model, model);
    assert.equal(
      host.startupPolicies.snapshot().checks.subscription!.result,
      true,
    );
    const warnings = () =>
      rows(host).filter((component) =>
        stripVTControlCharacters(component.render(100).join(" ")).includes(
          "extra usage",
        ),
      );
    assert.equal(warnings().length, 1);
    await host.withSdk(({ session }) =>
      session.setModel({ ...model, id: "another-native-model" }),
    );
    await until(
      () =>
        host.startupPolicies.snapshot().checks.subscription?.state ===
        "settled",
    );
    assert.equal(
      host.startupPolicies.snapshot().checks.subscription!.result,
      false,
    );
    assert.equal(warnings().length, 1);
  } finally {
    restoreEnv();
    await host.dispose();
    await files.close();
  }
});

test("retired subscription auth results cannot consume the successor's original warning flag", async () => {
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir),
    auth = barrier<{ type: "oauth" }>();
  let entered = false;
  try {
    await host.initialize(files.cwd);
    host.session.agent.state.model = {
      ...host.session.model!,
      provider: "anthropic",
    };
    host.session.modelRuntime.checkAuth = async () => {
      entered = true;
      return auth.promise;
    };
    const pending = host.startupPolicies.run("subscription"),
      retired = assert.rejects(pending, { name: "AbortError" });
    await until(() => entered);
    await host.runtime!.newSession();
    auth.release({ type: "oauth" });
    await retired;
    host.session.agent.state.model = {
      ...host.session.model!,
      provider: "anthropic",
    };
    host.session.modelRuntime.checkAuth = async () => ({ type: "oauth" });
    assert.equal(await host.startupPolicies.run("subscription"), true);
  } finally {
    auth.release({ type: "oauth" });
    await host.dispose();
    await files.close();
  }
});

test("catalog refresh timeout uses the original fifteen-second coordinator cancellation", async (t) => {
  const restoreEnv = environment(["PI_OFFLINE"]);
  delete process.env.PI_OFFLINE;
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir),
    gate =
      barrier<Awaited<ReturnType<AgentSession["modelRuntime"]["refresh"]>>>();
  try {
    await host.initialize(files.cwd);
    let nativeSignal: AbortSignal | undefined;
    host.session.modelRuntime.refresh = (options) => {
      nativeSignal = options!.signal;
      return gate.promise;
    };
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = host.startupPolicies.run("catalogs"),
      expired = assert.rejects(pending, { name: "AbortError" });
    assert.ok(nativeSignal);
    t.mock.timers.tick(15000);
    await expired;
    assert.equal(nativeSignal.aborted, true);
  } finally {
    t.mock.timers.reset();
    gate.release({ aborted: false, errors: new Map() });
    await host.dispose();
    await files.close();
    restoreEnv();
  }
});

test("catalog policy transport exposes provider errors and footer count follows original scoped models", async () => {
  const restoreEnv = environment(["PI_OFFLINE"]);
  delete process.env.PI_OFFLINE;
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const session = host.session,
      model = session.model!,
      error = new Error("Native catalog diagnostic");
    session.modelRuntime.refresh = async () => ({
      aborted: false,
      errors: new Map([["native-provider", error]]),
    });
    const result = await host.action({
      action: "startup-policy.run",
      args: { name: "catalogs" },
    });
    assert.deepEqual(result, {
      aborted: false,
      errors: [
        {
          provider: "native-provider",
          message: error.message,
          stack: error.stack,
        },
      ],
    });
    session.setScopedModels([{ model }]);
    let expected: number | undefined;
    Reflect.apply(
      Reflect.get(InteractiveMode.prototype, "updateAvailableProviderCount"),
      {
        session,
        footerDataProvider: {
          setAvailableProviderCount(count: number) {
            expected = count;
          },
        },
      },
      [],
    );
    host.snapshot();
    assert.equal(
      host.desktopUI.terminalRuntime
        .capture()
        .application!.footerData.getAvailableProviderCount(),
      expected,
    );
    const snapshot = host.startupPolicies.snapshot();
    snapshot.checks.catalogs!.state = "failed";
    assert.equal(
      host.startupPolicies.snapshot().checks.catalogs!.state,
      "settled",
    );
  } finally {
    await host.dispose();
    await files.close();
    restoreEnv();
  }
});

test("invalid policy/crash transport data is rejected before original operations", async () => {
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir);
  try {
    for (const [action, args] of [
      ["startup-policy.run", { name: "other" }],
      ["crash.record", { kind: "other" }],
      ["crash.record", { kind: "fatal_error", message: 1 }],
      ["crash.take", { now: "tomorrow" }],
    ] as const)
      await assert.rejects(host.action({ action, args }), /Invalid/);
    assert.deepEqual(await host.action({ action: "crash.read" }), []);
  } finally {
    await host.dispose();
    await files.close();
  }
});
