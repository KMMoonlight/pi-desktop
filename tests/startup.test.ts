import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  InteractiveMode,
  SettingsManager,
  VERSION,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { bindSessionAbort } from "../backend/session-abort.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";

const image = {
  type: "image" as const,
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/ACiqeP8EkgJKJCPrYwAAAABJRU5ErkJggg==",
};
async function settings(
  files: Awaited<ReturnType<typeof createFixture>>,
  changes: Record<string, unknown>,
) {
  const path = join(files.agentDir, "settings.json");
  await writeFile(
    path,
    JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), ...changes }),
  );
}
for (const collapse of [true, false])
  test(`startup changelog keeps original components and version filtering: collapse=${collapse}`, async () => {
    const files = await createFixture();
    await settings(files, {
      lastChangelogVersion: "0.99.0",
      collapseChangelog: collapse,
    });
    const host = new DesktopHost(files.agentDir);
    try {
      await host.initialize(files.cwd);
      const actual = host.desktopUI.terminalRuntime
        .capture()
        .application!.noticeEntries(0)
        .map((row) => row.component);
      const api = await loadTuiApi(),
        Container = Reflect.get(api, "Container"),
        mode = Object.create(InteractiveMode.prototype);
      Object.defineProperties(mode, {
        session: { value: host.session },
        settingsManager: {
          value: SettingsManager.inMemory({
            lastChangelogVersion: "0.99.0",
            collapseChangelog: collapse,
            enableInstallTelemetry: false,
          }),
        },
      });
      Object.assign(mode, {
        version: VERSION,
        chatContainer: new Container(),
        ui: { requestRender() {} },
        reportInstallTelemetry() {},
      });
      const invoke = (name: string, ...args: unknown[]) =>
        Reflect.apply(Reflect.get(InteractiveMode.prototype, name), mode, args);
      mode.changelogMarkdown = invoke("getChangelogForDisplay");
      invoke("showStartupNoticesIfNeeded");
      assert.equal(host.startup.snapshot().changelog, mode.changelogMarkdown);
      assert.deepEqual(
        actual.map((row) => row.constructor.name),
        mode.chatContainer.children.map((row: object) => row.constructor.name),
      );
      for (const width of [16, 79])
        assert.deepEqual(
          actual.flatMap((row) => row.render(width)),
          mode.chatContainer.render(width),
        );
      assert.equal(
        host.session.settingsManager.getLastChangelogVersion(),
        VERSION,
      );
      assert.equal(host.startup.changelog("startup").components.length, 0);
      const originals = actual.slice();
      await host.action({ action: "resources.reload" });
      assert.deepEqual(
        host.desktopUI.terminalRuntime.capture().application!.noticeEntries(0),
        [],
      );
      assert.equal(host.startup.changelog("startup").components.length, 0);
      assert.ok(originals.length > 0);
    } finally {
      await host.dispose();
      await files.close();
    }
  });
test("fresh startup records the original version without displaying changelog", async () => {
  const files = await createFixture();
  await settings(files, { lastChangelogVersion: undefined });
  const host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    assert.equal(
      host.session.settingsManager.getLastChangelogVersion(),
      VERSION,
    );
    assert.equal(host.startup.snapshot().changelog, undefined);
    assert.deepEqual(
      host.desktopUI.terminalRuntime.capture().application!.noticeEntries(0),
      [],
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});
test("verbose startup retains the original header while overriding quiet startup", async () => {
  const files = await createFixture();
  await settings(files, { quietStartup: true });
  const host = new DesktopHost(files.agentDir, { startup: { verbose: true } });
  try {
    await host.action({ action: "initialize", args: { cwd: files.cwd } });
    const entries = host.desktopUI.terminalRuntime
      .capture()
      .application!.content.headerEntries();
    assert.ok(
      entries.some(
        (entry) => entry.component.constructor.name === "BuiltInHeader",
      ),
    );
    assert.ok(
      entries
        .flatMap((entry) => entry.component.render(79))
        .join("\n")
        .includes(`v${VERSION}`),
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});
test("a resumed session preserves its changelog version and skips startup entries", async () => {
  const files = await createFixture();
  await settings(files, { lastChangelogVersion: "0.99.0" });
  const host = new DesktopHost(files.agentDir, {
    runtimeFactory: async (options, create) => {
      options.sessionManager.appendMessage({
        role: "user",
        content: "Resumed startup fixture",
        timestamp: 1,
      });
      return create(options);
    },
  });
  try {
    await host.initialize(files.cwd);
    assert.equal(
      host.session.settingsManager.getLastChangelogVersion(),
      "0.99.0",
    );
    assert.equal(host.startup.snapshot().changelog, undefined);
    assert.deepEqual(
      host.desktopUI.terminalRuntime.capture().application!.noticeEntries(0),
      [],
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});
test("full changelog uses the original command result without advancing startup version", async () => {
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const version = host.session.settingsManager.getLastChangelogVersion();
    const full = host.startup.changelog();
    const api = await loadTuiApi(),
      mode = Object.create(InteractiveMode.prototype),
      Container = Reflect.get(api, "Container");
    Object.defineProperty(mode, "settingsManager", {
      value: host.session.settingsManager,
    });
    Object.assign(mode, {
      chatContainer: new Container(),
      ui: { requestRender() {} },
    });
    Reflect.apply(
      Reflect.get(InteractiveMode.prototype, "handleChangelogCommand"),
      mode,
      [],
    );
    assert.deepEqual(
      full.components.map((row) => row.constructor.name),
      mode.chatContainer.children.map((row: object) => row.constructor.name),
    );
    assert.equal(
      full.markdown,
      Reflect.get(
        mode.chatContainer.children.find(
          (row: object) => row.constructor.name === "Markdown",
        ),
        "text",
      ),
    );
    assert.ok(full.markdown?.includes("v1.0.0/"));
    assert.equal(
      host.session.settingsManager.getLastChangelogVersion(),
      version,
    );
    const result = (await host.action({
      action: "startup.changelog",
      args: { kind: "full" },
    })) as { markdown: string; components: number };
    assert.equal(result.markdown, full.markdown);
    assert.equal(result.components, full.components.length);
    await assert.rejects(
      host.action({ action: "startup.changelog", args: { kind: "unknown" } }),
      /Invalid changelog kind/,
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});
for (const transport of [false, true])
  test(`initial messages retain native sequential prompts and first-message images: transport=${transport}`, async () => {
    const files = await createFixture();
    const options = {
      initialMessage: "Native first startup message",
      initialImages: [image],
      initialMessages: [
        "Native second startup message",
        "Native third startup message",
      ],
    };
    const host = new DesktopHost(
      files.agentDir,
      transport ? {} : { startup: options },
    );
    try {
      if (transport)
        await host.action({
          action: "initialize",
          args: { cwd: files.cwd, startup: options },
        });
      else await host.initialize(files.cwd);
      const users = host.session.messages.filter(
        (message) => message.role === "user",
      );
      assert.equal(users.length, 3);
      assert.ok(JSON.stringify(users[0]).includes(image.data));
      assert.ok(!JSON.stringify(users[1]).includes(image.data));
      assert.deepEqual(
        users.map((message) =>
          typeof message.content === "string"
            ? message.content
            : (
                message.content.find((part) => part.type === "text") as {
                  text: string;
                }
              )?.text,
        ),
        [options.initialMessage, ...options.initialMessages],
      );
      assert.equal(files.requests.length, 3);
      assert.equal(host.startup.snapshot().completed, 3);
      assert.equal(
        await host.withSdk((context) => context.startup),
        host.startup,
      );
      await host.initialize(files.cwd, options);
      assert.equal(files.requests.length, 3);
      assert.equal(
        (
          (await host.action({ action: "startup.inspect" })) as {
            state: string;
          }
        ).state,
        "settled",
      );
    } finally {
      await host.dispose();
      await files.close();
    }
  });
test("startup diagnostics, credential migration and fallback retain native warning order", async () => {
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    await host.startup.run({
      startupDiagnostics: [
        { type: "info", message: "Original setup info" },
        { type: "warning", message: "Original setup warning" },
        { type: "error", message: "Original setup error" },
      ],
      migratedProviders: ["one", "two"],
      modelFallbackMessage: "Original model fallback",
    });
    const rows = host.desktopUI.terminalRuntime
      .capture()
      .application!.noticeEntries(0)
      .flatMap((entry) => entry.component.render(100))
      .join("\n");
    const order = [
      "Original setup info",
      "Warning: Original setup warning",
      "Error: Original setup error",
      "Migrated credentials to auth.json: one, two",
      "Warning: Original model fallback",
    ].map((value) => rows.indexOf(value));
    assert.ok(order.every((value) => value >= 0));
    assert.deepEqual(
      order,
      order.slice().sort((a, b) => a - b),
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});
test("failed initial prompts report original error labels and continue in order", async () => {
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    const original = host.session.prompt.bind(host.session),
      calls: string[] = [];
    host.session.prompt = async (text, ...args) => {
      calls.push(text);
      if (text === "error") throw new Error("Original initial failure");
      if (text === "non-error") throw "raw failure";
      return original(text, ...args);
    };
    const result = await host.startup.run({
      initialMessages: ["error", "non-error", "Native after failures"],
    });
    assert.deepEqual(calls, ["error", "non-error", "Native after failures"]);
    assert.deepEqual(result.errors, [
      "Original initial failure",
      "Unknown error occurred",
    ]);
    assert.equal(result.attempted, 3);
    assert.equal(result.completed, 1);
    const snapshot = result.errors;
    snapshot.push("Caller changed result");
    assert.equal(host.startup.snapshot().errors.length, 2);
  } finally {
    await host.dispose();
    await files.close();
  }
});
for (const ending of [
  "cancel",
  "reload",
  "newSession",
  "switchSession",
  "fork",
  "importFromJsonl",
  "abort",
  "dispose",
] as const)
  test(
    `startup retirement prevents later initial prompts: ${ending}`,
    { timeout: 20000 },
    async (t) => {
      const files = await createFixture(),
        host = new DesktopHost(files.agentDir);
      const cancel = () =>
        host.action({
          action: "sdk.cancel",
          args: { id: "startup-retirement" },
        });
      // A timed-out assertion must release its real HTTP gate as well.
      const onTimeout = () => void cancel().catch(() => {});
      t.signal.addEventListener("abort", onTimeout);
      try {
        await host.initialize(files.cwd);
        const pending = host.action({
          action: "startup.run",
          args: {
            id: "startup-retirement",
            initialMessage: "application-status-gate",
            initialMessages: ["Obsolete initial successor"],
          },
        });
        const rejected = assert.rejects(pending, { name: "AbortError" });
        while (files.requests.length === 0) {
          t.signal.throwIfAborted();
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await assert.rejects(host.startup.run(), /already running/);
        if (ending === "dispose") await host.dispose();
        else if (ending === "reload")
          await host.withSdk((context) => context.session.reload());
        else if (ending === "abort") await host.session.abort();
        else if (ending !== "cancel")
          await host.withSdk(async ({ runtime, session }) => {
            const path = session.sessionFile!;
            const user = session.sessionManager
              .getEntries()
              .find(
                (entry) =>
                  entry.type === "message" && entry.message.role === "user",
              )!;
            const result =
              ending === "newSession"
                ? await runtime.newSession()
                : ending === "switchSession"
                  ? await runtime.switchSession(path)
                  : ending === "fork"
                    ? await runtime.fork(user.id)
                    : await runtime.importFromJsonl(path);
            assert.equal(result.cancelled, false);
          });
        else await cancel();
        await rejected;
        assert.equal(files.requests.length, 1);
        assert.equal(host.startup.snapshot().state, "retired");
        const deadline = Date.now() + 5000;
        while (files.abortedRequests.length === 0) {
          assert.ok(
            Date.now() < deadline,
            "Native HTTP stream did not close after cancellation",
          );
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        t.signal.removeEventListener("abort", onTimeout);
        await cancel().catch(() => {});
        await host.dispose();
        await files.close();
      }
    },
  );

test(
  "accepted transition retires startup before asynchronous native shutdown handlers finish",
  { timeout: 20000 },
  async (t) => {
    const files = await createFixture(),
      host = new DesktopHost(files.agentDir);
    const entered = join(files.root, "shutdown-entered"),
      release = join(files.root, "shutdown-release");
    const unblock = () => writeFile(release, "ready");
    let transition: Promise<unknown> | undefined;
    const onTimeout = () => {
      void unblock().catch(() => {});
      void host
        .action({ action: "sdk.cancel", args: { id: "startup-delayed" } })
        .catch(() => {});
    };
    t.signal.addEventListener("abort", onTimeout);
    try {
      await writeFile(
        join(files.agentDir, "extensions", "startup-shutdown.ts"),
        `
import { existsSync, writeFileSync } from "node:fs";
export default function(pi) {
  pi.on("session_shutdown", async ({ reason }) => {
    if (reason !== "new") return;
    writeFileSync(${JSON.stringify(entered)}, "ready");
    while (!existsSync(${JSON.stringify(release)})) await new Promise(done => setTimeout(done, 10));
  });
}`,
      );
      await host.initialize(files.cwd);
      const session = host.session,
        signal = host.sessionSignal;
      const pending = host.action({
        action: "startup.run",
        args: {
          id: "startup-delayed",
          initialMessage: "application-status-gate",
          initialMessages: ["Obsolete delayed successor"],
        },
      });
      const retired = assert.rejects(pending, { name: "AbortError" });
      while (!files.requests.length) {
        t.signal.throwIfAborted();
        await new Promise((done) => setTimeout(done, 10));
      }
      let replaced = false;
      transition = host
        .withSdk(({ runtime }) => runtime.newSession())
        .then((result) => {
          replaced = true;
          return result;
        });
      while (!(await readFile(entered, "utf8").catch(() => ""))) {
        t.signal.throwIfAborted();
        await new Promise((done) => setTimeout(done, 10));
      }
      await retired;
      assert.equal(replaced, false);
      assert.equal(host.session, session);
      assert.equal(
        signal.aborted,
        false,
        "Native shutdown retains its extension/session lifetime",
      );
      assert.equal(files.requests.length, 1);
      assert.equal(host.startup.snapshot().state, "retired");
      await unblock();
      assert.deepEqual(await transition, { cancelled: false });
      assert.notEqual(host.session, session);
    } finally {
      t.signal.removeEventListener("abort", onTimeout);
      await unblock();
      await host
        .action({ action: "sdk.cancel", args: { id: "startup-delayed" } })
        .catch(() => {});
      await transition?.catch(() => {});
      await host.dispose();
      await files.close();
    }
  },
);

for (const reason of ["cancelled", "invalid"] as const)
  test(
    `startup continues after ${reason} native transitions`,
    { timeout: 20000 },
    async (t) => {
      const files = await createFixture(),
        host = new DesktopHost(files.agentDir);
      let release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      const onTimeout = () => release();
      t.signal.addEventListener("abort", onTimeout);
      try {
        if (reason === "cancelled")
          await writeFile(
            join(files.agentDir, "extensions", "startup-cancel.ts"),
            `export default function(pi) { pi.on("session_before_switch", () => ({ cancel: true })); pi.on("session_before_fork", () => ({ cancel: true })); }`,
          );
        await host.initialize(files.cwd);
        const session = host.session,
          runtime = host.runtime!;
        const entry = session.sessionManager.appendMessage({
          role: "user",
          content: "Fork seed",
          timestamp: Date.now(),
        });
        session.refreshContext();
        const original = session.prompt,
          calls: string[] = [];
        session.prompt = async function (text, ...args) {
          calls.push(text);
          if (calls.length === 1) await gate;
          return original.call(this, text, ...args);
        };
        const pending = host.startup.run(
          {
            initialMessages: [
              "Native first retained",
              "Native successor retained",
            ],
          },
          t.signal,
        );
        void pending.catch(() => {});
        while (!calls.length) {
          t.signal.throwIfAborted();
          await new Promise((done) => setTimeout(done, 10));
        }
        const path = session.sessionFile!;
        const invalidPath = join(files.root, "invalid-cwd.jsonl");
        if (reason === "invalid") {
          const [header, ...rows] = (await readFile(path, "utf8")).split("\n");
          await writeFile(
            invalidPath,
            [
              JSON.stringify({
                ...JSON.parse(header),
                cwd: join(files.root, "missing-cwd"),
              }),
              ...rows,
            ].join("\n"),
          );
        }
        const results =
          reason === "cancelled"
            ? await Promise.all([
                runtime.newSession(),
                runtime.switchSession(path),
                runtime.fork(entry),
                runtime.importFromJsonl(path),
              ])
            : await Promise.allSettled([
                runtime.switchSession(invalidPath),
                runtime.fork("invalid-entry"),
                runtime.importFromJsonl(join(files.root, "missing.jsonl")),
              ]);
        if (reason === "cancelled")
          assert.deepEqual(results, Array(4).fill({ cancelled: true }));
        else
          assert.ok(
            results.every(
              (result) => "status" in result && result.status === "rejected",
            ),
          );
        assert.equal(host.session, session);
        assert.equal(host.sessionSignal.aborted, false);
        assert.equal(host.startup.snapshot().state, "running");
        release();
        assert.equal((await pending).completed, 2);
        assert.deepEqual(calls, [
          "Native first retained",
          "Native successor retained",
        ]);
        assert.equal(files.requests.length, 2);
      } finally {
        t.signal.removeEventListener("abort", onTimeout);
        release();
        await host.dispose();
        await files.close();
      }
    },
  );

test("startup abort observer preserves native Promises, receivers, failures and replacement descriptors", async () => {
  const promise = Promise.resolve(),
    failure = new Error("Native abort failure");
  const receivers: unknown[] = [];
  const session = {
    abort(this: unknown) {
      receivers.push(this);
      if (receivers.length === 3) throw failure;
      return promise;
    },
  } as unknown as AgentSession;
  const descriptor = Object.getOwnPropertyDescriptor(session, "abort");
  let observed = 0;
  const restore = bindSessionAbort(session, () => observed++),
    saved = session.abort;
  assert.equal(session.abort(), promise);
  const other = {} as AgentSession;
  assert.equal(saved.call(other), promise);
  assert.throws(
    () => session.abort(),
    (error) => error === failure,
  );
  assert.equal(observed, 2);
  assert.deepEqual(receivers, [session, other, session]);
  restore();
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(session, "abort"),
    descriptor,
  );
  assert.equal(saved.call(session), promise);
  assert.equal(observed, 2);
  const detach = bindSessionAbort(session, () => observed++),
    replacement = () => promise;
  session.abort = replacement;
  detach();
  assert.equal(session.abort, replacement);
});
test("invalid startup transport data never reaches the native model", async () => {
  const files = await createFixture(),
    host = new DesktopHost(files.agentDir);
  try {
    await host.initialize(files.cwd);
    for (const options of [
      { initialMessages: [1] },
      { initialMessage: 1 },
      { initialImages: [{ type: "image", data: 1, mimeType: "image/png" }] },
      { startupDiagnostics: [{ type: "unknown", message: "invalid" }] },
      { migratedProviders: [1] },
      { verbose: "true" },
    ])
      await assert.rejects(
        host.action({ action: "startup.run", args: { options } }),
        /Invalid/,
      );
    assert.equal(files.requests.length, 0);
  } finally {
    await host.dispose();
    await files.close();
  }
});
