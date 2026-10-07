import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const mode = process.argv[2];
delete process.env.PI_TELEMETRY;
delete process.env.PI_OFFLINE;
if (mode === "env-disabled") process.env.PI_TELEMETRY = "0";
if (mode === "env-enabled" || mode === "upgrade")
  process.env.PI_TELEMETRY = "yes";
if (mode === "offline") process.env.PI_OFFLINE = "0"; // Native install telemetry treats any nonempty offline flag as offline.
if (mode === "initial-differential") {
  process.env.PI_TELEMETRY = "0";
  process.env.PI_OFFLINE = "1";
}
const { DesktopHost } = await import("../../backend/host.ts");
const { createFixture } = await import("../fixture.ts");
const { InteractiveMode, SettingsManager, VERSION } =
  await import("@earendil-works/pi-coding-agent");
const files = await createFixture();
const path = join(files.agentDir, "settings.json");
const originalFetch = globalThis.fetch,
  telemetry = [];
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith("https://pi.dev/api/report-install")) {
    telemetry.push({ url: String(url), options });
    return new Response("Recorded native report", { status: 200 });
  }
  return originalFetch(url, options);
};
const host = new DesktopHost(files.agentDir);
try {
  if (mode !== "initial-differential") {
    await writeFile(
      path,
      JSON.stringify({
        ...JSON.parse(await readFile(path, "utf8")),
        lastChangelogVersion: mode === "upgrade" ? "0.99.0" : undefined,
        enableInstallTelemetry:
          mode === "fresh-default"
            ? undefined
            : !["fresh-disabled", "env-enabled", "upgrade"].includes(mode),
      }),
    );
    await host.initialize(files.cwd);
    const reports = ["fresh-default", "env-enabled", "upgrade"].includes(mode)
      ? 1
      : 0;
    assert.equal(telemetry.length, reports);
    if (reports) {
      assert.equal(
        new URL(telemetry[0].url).searchParams.get("version"),
        VERSION,
      );
      assert.ok(telemetry[0].options.headers["User-Agent"].includes(VERSION));
      assert.ok(telemetry[0].options.signal instanceof AbortSignal);
    }
    assert.equal(
      host.session.settingsManager.getLastChangelogVersion(),
      VERSION,
    );
    assert.equal(!!host.startup.snapshot().changelog, mode === "upgrade");
    await host.initialize(files.cwd);
    assert.equal(telemetry.length, reports);
  } else {
    const image = {
      type: "image",
      data: "native-image",
      mimeType: "image/png",
    };
    const options = {
      initialMessage: "first",
      initialImages: [image],
      initialMessages: ["error", "non-error", "", "last"],
      startupDiagnostics: [
        { type: "info", message: "Native info" },
        { type: "warning", message: "Native warning" },
        { type: "error", message: "Native error" },
      ],
      migratedProviders: ["one", "two"],
      modelFallbackMessage: "Native fallback",
    };
    const nativeCalls = [],
      nativeNotices = [],
      actualCalls = [],
      actualNotices = [];
    const prompt =
      (record) =>
      async (...args) => {
        record.push(args);
        if (args[0] === "error") throw new Error("Native initial error");
        if (args[0] === "non-error") throw 123;
      };
    const receiver = Object.create(InteractiveMode.prototype),
      done = Symbol("native input loop boundary");
    Object.defineProperties(receiver, {
      session: {
        value: {
          modelRuntime: { getError: () => undefined },
          prompt: prompt(nativeCalls),
        },
      },
      settingsManager: {
        value: SettingsManager.inMemory({ enableInstallTelemetry: false }),
      },
    });
    Object.assign(receiver, {
      version: VERSION,
      options,
      init: async () => {},
      checkForPackageUpdates: async () => [],
      checkTmuxKeyboardSetup: async () => undefined,
      maybeWarnAboutAnthropicSubscriptionAuth: async () => {},
      showStatus: (text) =>
        nativeNotices.push({ message: text, level: "info" }),
      showWarning: (text) =>
        nativeNotices.push({ message: text, level: "warning" }),
      showError: (text) =>
        nativeNotices.push({ message: text, level: "error" }),
      getUserInput: async () => {
        throw done;
      },
    });
    await assert.rejects(
      Reflect.apply(InteractiveMode.prototype.run, receiver, []),
      (error) => error === done,
    );
    await host.initialize(files.cwd);
    host.session.prompt = prompt(actualCalls);
    host.on("event", (event) => {
      if (event.type === "notice")
        actualNotices.push({ message: event.message, level: event.level });
    });
    const result = await host.startup.run(options);
    assert.deepEqual(actualCalls, nativeCalls);
    assert.deepEqual(actualNotices, nativeNotices);
    assert.equal(result.attempted, 5);
    assert.equal(result.completed, 3);
    assert.deepEqual(result.errors, [
      "Native initial error",
      "Unknown error occurred",
    ]);
    assert.equal(telemetry.length, 0);
  }
  console.log(
    JSON.stringify({
      mode,
      telemetry: telemetry.length,
      startup: host.startup.snapshot(),
    }),
  );
} finally {
  await host.dispose();
  await files.close();
  globalThis.fetch = originalFetch;
}
