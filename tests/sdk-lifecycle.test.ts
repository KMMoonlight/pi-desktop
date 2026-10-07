import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import {
  RuntimeLifecycle,
  bindRuntimeTransitions,
} from "../backend/runtime-lifecycle.ts";
import { createFixture } from "./fixture.ts";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((done) => (release = done));
  return { promise, release };
}
async function waitForFile(path: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await readFile(path, "utf8").catch(() => "")) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Module preparation barrier timed out");
}
async function preparingModule(root: string, directory: string) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, "preparing.mjs");
  const entered = join(root, "module-entered.txt");
  const released = join(root, "module-released.txt");
  const invoked = join(root, "operation-invoked.txt");
  await writeFile(
    path,
    `import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(entered)}, "entered");
while (!existsSync(${JSON.stringify(released)})) await new Promise(done => setTimeout(done, 10));
export default async function({ signal }) {
  await writeFile(${JSON.stringify(invoked)}, "invoked");
  return signal.aborted ? "aborted" : "complete";
}`,
  );
  return {
    path,
    entered,
    invoked,
    release: () => writeFile(released, "release"),
  };
}

for (const mode of [
  "cancel",
  "duplicate ID",
  "shutdown",
  "new session",
  "workspace replacement",
  "trust revoked",
])
  test(
    `SDK module preparation retains ownership through ${mode}`,
    { timeout: 20000 },
    async () => {
      const fixture = await createFixture();
      const host = new DesktopHost(fixture.agentDir);
      const project = mode === "trust revoked";
      let operation: Promise<unknown> | undefined;
      const module = await preparingModule(
        fixture.root,
        project
          ? join(fixture.cwd, ".pi", "desktop")
          : join(fixture.agentDir, "desktop"),
      );
      try {
        await host.initialize(fixture.cwd);
        if (project) host.session.settingsManager.setProjectTrusted(true);
        operation = host.action({
          action: "sdk.run",
          args: { path: module.path, id: "preparing" },
        });
        void operation.catch(() => {});
        await waitForFile(module.entered);
        if (mode === "duplicate ID") {
          await assert.rejects(
            host.action({
              action: "sdk.run",
              args: {
                path: module.path,
                id: "preparing",
              },
            }),
            /already in use/,
          );
        } else if (mode === "cancel") {
          await host.action({
            action: "sdk.cancel",
            args: { id: "preparing" },
          });
        } else if (mode === "shutdown") await host.dispose();
        else if (mode === "new session")
          await host.action({ action: "session.new" });
        else if (mode === "workspace replacement")
          await host.initialize(fixture.root);
        else host.session.settingsManager.setProjectTrusted(false);
        await module.release();
        if (mode === "duplicate ID") {
          assert.equal(await operation, "complete");
          assert.equal(
            await host.action({
              action: "sdk.run",
              args: {
                path: module.path,
                id: "preparing",
              },
            }),
            "complete",
            "settled IDs must be reusable",
          );
        } else {
          await assert.rejects(operation, { name: "AbortError" });
          await assert.rejects(readFile(module.invoked), { code: "ENOENT" });
        }
      } finally {
        await module.release();
        await operation?.catch(() => {});
        await host.dispose();
        await fixture.close();
      }
    },
  );

test("withSdk provides owner cancellation, preserves explicit reasons and rejects closed entry", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    const reason = new Error("Caller cancellation reason");
    const controller = new AbortController();
    controller.abort(reason);
    let called = false;
    await assert.rejects(
      host.withSdk(() => (called = true), {}, controller.signal),
      (error) => error === reason,
    );
    assert.equal(called, false);
    assert.equal(
      await host.withSdk(({ sdk, signal }) => {
        assert.equal(signal!.aborted, false);
        return sdk.VERSION;
      }),
      host.sdk.sdk.VERSION,
      "package APIs work without initializing a workspace",
    );
    const entered = barrier();
    const pending = host.withSdk(({ signal }) => {
      entered.release();
      return new Promise<string>((done) =>
        signal!.addEventListener("abort", () => done("owner cancelled"), {
          once: true,
        }),
      );
    });
    await entered.promise;
    await host.dispose();
    assert.equal(await pending, "owner cancelled");
    await assert.rejects(
      host.withSdk(() => (called = true)),
      /已关闭/,
    );
    assert.equal(called, false);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("a running SDK module keeps live context across its own original session replacement", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const path = join(fixture.agentDir, "desktop", "replace.mjs");
  await writeFile(
    path,
    `export default async context => {
  const before = context.session.sessionId;
  const result = await context.runtime.newSession({
    setup: async manager => manager.appendCustomEntry("SDK-lifetime", {original:true}),
  });
  return {before, after:context.session.sessionId, cancelled:result.cancelled,
    aborted:context.signal.aborted,
    entry:context.sessionManager.getEntries().find(entry => entry.customType === "SDK-lifetime")};
}`,
  );
  try {
    await host.initialize(fixture.cwd);
    const context = host.sdk;
    const result = (await host.action({
      action: "sdk.run",
      args: { path },
    })) as any;
    assert.notEqual(result.before, result.after);
    assert.equal(result.after, context.session.sessionId);
    assert.equal(result.cancelled, false);
    assert.equal(result.aborted, false);
    assert.deepEqual(result.entry.data, { original: true });
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

for (const name of [
  "newSession",
  "switchSession",
  "fork",
  "importFromJsonl",
] as const)
  test(
    `shutdown joins direct SDK ${name} construction and restores original methods`,
    { timeout: 20000 },
    async () => {
      const fixture = await createFixture();
      const marker = join(fixture.root, "runtime-shutdown.txt");
      await writeFile(
        join(fixture.agentDir, "extensions", "lifecycle.ts"),
        `
import { appendFile } from "node:fs/promises";
export default function(pi) {
  pi.on("session_shutdown", async event => {
    await appendFile(${JSON.stringify(marker)}, event.reason + "\\n");
  });
}`,
      );
      const entered = barrier(),
        release = barrier();
      let calls = 0;
      const host = new DesktopHost(fixture.agentDir, {
        runtimeFactory: async (options, original) => {
          const result = await original(options);
          if (++calls === 2) {
            entered.release();
            await release.promise;
          }
          return result;
        },
      });
      let operation: Promise<unknown> | undefined;
      try {
        await host.initialize(fixture.cwd);
        await host.withSdk(({ session }) => session.prompt("seed session"));
        const runtime = host.sdk.runtime;
        const path = host.session.sessionFile!;
        const entry = host.session.sessionManager
          .getEntries()
          .find(
            (item) => item.type === "message" && item.message.role === "user",
          )!;
        const context = host.sdk;
        operation =
          name === "newSession"
            ? runtime.newSession()
            : name === "switchSession"
              ? runtime.switchSession(path)
              : name === "fork"
                ? runtime.fork(entry.id)
                : runtime.importFromJsonl(path);
        void operation.catch(() => {});
        await Promise.race([
          entered.promise,
          operation.then(() => {
            throw new Error(
              "SDK transition finished without constructing a runtime",
            );
          }),
        ]);
        let disposed = false;
        const shutdown = host.dispose().then(() => (disposed = true));
        await new Promise((done) => setImmediate(done));
        assert.equal(disposed, false);
        release.release();
        const result = (await operation) as { cancelled: boolean };
        assert.equal(result.cancelled, false);
        await shutdown;
        const reasons = (await readFile(marker, "utf8")).trim().split("\n");
        assert.deepEqual(reasons, [
          name === "newSession" ? "new" : name === "fork" ? "fork" : "resume",
          "quit",
        ]);
        assert.equal(host.runtime, undefined);
        assert.throws(() => context.session, /未初始化/);
        assert.deepEqual(host.desktopUI.surfaces, []);
        for (const method of [
          "newSession",
          "switchSession",
          "fork",
          "importFromJsonl",
        ] as const)
          assert.equal(runtime[method], AgentSessionRuntime.prototype[method]);
      } finally {
        release.release();
        await operation?.catch(() => {});
        await host.dispose();
        await fixture.close();
      }
    },
  );

for (const external of [false, true])
  test(
    `SDK replacement callback joins ${external ? "existing" : "self-requested"} shutdown without a cycle`,
    { timeout: 15000 },
    async () => {
      const fixture = await createFixture();
      const host = new DesktopHost(fixture.agentDir);
      const entered = barrier(),
        release = barrier();
      let operation: Promise<unknown> | undefined;
      try {
        await host.initialize(fixture.cwd);
        operation = host.sdk.runtime.newSession({
          withSession: async () => {
            entered.release();
            await release.promise;
            await host.dispose();
          },
        });
        await entered.promise;
        const shutdown = external ? host.dispose() : undefined;
        release.release();
        assert.deepEqual(await operation, { cancelled: false });
        await shutdown;
        assert.equal(host.runtime, undefined);
        assert.deepEqual(host.desktopUI.surfaces, []);
      } finally {
        release.release();
        await operation?.catch(() => {});
        await host.dispose();
        await fixture.close();
      }
    },
  );

for (const initial of [true, false])
  test(
    `SDK ${initial ? "initial" : "replacement"} factory can await shutdown without reviving the host`,
    { timeout: 15000 },
    async () => {
      const fixture = await createFixture();
      let host!: DesktopHost;
      let calls = 0;
      let created:
        Awaited<ReturnType<CreateAgentSessionRuntimeFactory>> | undefined;
      host = new DesktopHost(fixture.agentDir, {
        runtimeFactory: async (options, original) => {
          if (++calls === (initial ? 1 : 2)) {
            await host.dispose();
            created = await original(options);
            return created;
          }
          return original(options);
        },
      });
      try {
        if (!initial) await host.initialize(fixture.cwd);
        const operation = initial
          ? host.initialize(fixture.cwd)
          : host.sdk.runtime.newSession();
        await assert.rejects(operation, { name: "AbortError" });
        assert.equal(host.runtime, undefined);
        assert.ok(created);
        assert.throws(
          () => created!.session.extensionRunner.createContext().shutdown(),
          /stale/i,
        );
        assert.deepEqual(host.desktopUI.surfaces, []);
      } finally {
        await host.dispose();
        await fixture.close();
      }
    },
  );

test("runtime binding retains original Promise, errors, receiver and own descriptors", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const runtime = host.sdk.runtime;
    const original = barrier();
    const result = original.promise.then(() => ({ cancelled: true }));
    const receivers: unknown[] = [];
    const method: AgentSessionRuntime["newSession"] = function (
      this: AgentSessionRuntime,
    ) {
      receivers.push(this);
      return result;
    };
    Object.defineProperty(runtime, "newSession", {
      value: method,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    const descriptor = Object.getOwnPropertyDescriptor(runtime, "newSession");
    const lifecycle = new RuntimeLifecycle();
    let current = true;
    const restore = bindRuntimeTransitions(runtime, lifecycle, () => current);
    const captured = runtime.newSession;
    assert.equal(runtime.newSession(), result);
    const borrowed = {};
    assert.equal(Reflect.apply(captured, borrowed, []), result);
    assert.deepEqual(receivers, [runtime, borrowed]);
    original.release();
    await result;
    current = false;
    await assert.rejects(captured.call(runtime), { name: "AbortError" });
    restore();
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(runtime, "newSession"),
      descriptor,
    );
    assert.equal(AgentSessionRuntime.prototype.newSession === method, false);
    const failure = new Error("Original SDK method failure");
    Object.defineProperty(runtime, "newSession", {
      value: () => Promise.reject(failure),
      configurable: true,
    });
    const failedLifecycle = new RuntimeLifecycle();
    const restoreFailed = bindRuntimeTransitions(
      runtime,
      failedLifecycle,
      () => true,
    );
    await assert.rejects(runtime.newSession(), (error) => error === failure);
    await failedLifecycle.close();
    restoreFailed();
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
