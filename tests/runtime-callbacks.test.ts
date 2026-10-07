import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentSessionRuntime,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { bindRuntimeCallbacks } from "../backend/runtime-callbacks.ts";
import { createFixture } from "./fixture.ts";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((done) => (release = done));
  return { promise, release };
}

for (const mode of ["installed", "cleared", "rebind-failure", "before-failure"])
  test(
    `runtime callback ${mode} preserves SDK results and desktop ownership`,
    { timeout: 30000 },
    async () => {
      const fixture = await createFixture();
      const host = new DesktopHost(fixture.agentDir);
      try {
        await host.initialize(fixture.cwd);
        const path = join(fixture.agentDir, "desktop", "callbacks.mjs");
        await mkdir(join(fixture.agentDir, "desktop"), { recursive: true });
        await cp(
          new URL("./fixtures/runtime-callbacks.mjs", import.meta.url),
          path,
        );
        assert.deepEqual(
          await host.action({
            action: "sdk.run",
            args: { path, args: { mode } },
          }),
          {
            events:
              mode === "installed"
                ? ["before", "rebind", "options"]
                : mode === "cleared"
                  ? ["options"]
                  : mode === "before-failure"
                    ? ["before"]
                    : ["before", "rebind"],
            disposed: 1,
            receivers: true,
            preserved: mode.endsWith("failure"),
            optionsText:
              mode === "installed"
                ? "Callback draft"
                : mode === "cleared"
                  ? ""
                  : null,
            cancelled: false,
            replaced: true,
            hasUI: true,
            text: mode === "installed" ? "Callback draft" : "",
            hasEditor: true,
          },
        );
      } finally {
        await host.dispose();
        await fixture.close();
      }
    },
  );

for (const transition of [
  "newSession",
  "switchSession",
  "fork",
  "importFromJsonl",
] as const)
  test(
    `SDK ${transition} composes caller lifecycle hooks with desktop binding`,
    { timeout: 30000 },
    async () => {
      const fixture = await createFixture();
      const host = new DesktopHost(fixture.agentDir);
      try {
        await host.initialize(fixture.cwd);
        await host.withSdk(({ session }) => session.prompt("seed session"));
        const runtime = host.sdk.runtime;
        const session = runtime.session;
        const path = session.sessionFile!;
        const entry = session.sessionManager
          .getEntries()
          .find(
            (item) => item.type === "message" && item.message.role === "user",
          )!;
        const events: string[] = [];
        runtime.setBeforeSessionInvalidate(function (
          this: AgentSessionRuntime,
        ) {
          assert.equal(this, runtime);
          events.push("before");
          assert.ok(
            host.desktopUI.surfaces.some(({ slot }) => slot === "editor"),
          );
        });
        runtime.setRebindSession(async function (
          this: AgentSessionRuntime,
          next,
        ) {
          assert.equal(this, runtime);
          assert.equal(next, runtime.session);
          assert.notEqual(next, session);
          assert.ok(next.extensionRunner.hasUI());
          assert.ok(
            host.desktopUI.surfaces.some(({ slot }) => slot === "editor"),
          );
          next.extensionRunner
            .getUIContext()
            .setEditorText(`Caller ${transition}`);
          events.push("rebind");
        });
        const result =
          transition === "newSession"
            ? await runtime.newSession()
            : transition === "switchSession"
              ? await runtime.switchSession(path)
              : transition === "fork"
                ? await runtime.fork(entry.id)
                : await runtime.importFromJsonl(path);
        assert.equal(result.cancelled, false);
        assert.deepEqual(events, ["before", "rebind"]);
        assert.equal(host.snapshot().editor.text, `Caller ${transition}`);
        runtime.setBeforeSessionInvalidate(undefined);
        runtime.setRebindSession(undefined);
      } finally {
        host.runtime?.setBeforeSessionInvalidate(undefined);
        host.runtime?.setRebindSession(undefined);
        await host.dispose();
        await fixture.close();
      }
    },
  );

test(
  "caller hook replacement and asynchronous before callbacks retain original SDK semantics",
  { timeout: 30000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const pending = barrier();
    try {
      await host.initialize(fixture.cwd);
      const runtime = host.sdk.runtime;
      const calls: string[] = [];
      runtime.setBeforeSessionInvalidate(() => {
        assert.fail("Retired before hook");
      });
      runtime.setRebindSession(async () => {
        assert.fail("Retired rebind hook");
      });
      runtime.setBeforeSessionInvalidate(() => {
        calls.push("before");
        return pending.promise;
      });
      runtime.setRebindSession(async (session) => {
        assert.ok(session.extensionRunner.hasUI());
        calls.push("rebind");
      });
      assert.equal((await runtime.newSession()).cancelled, false);
      assert.deepEqual(calls, ["before", "rebind"]);
      runtime.setBeforeSessionInvalidate(undefined);
      runtime.setRebindSession(undefined);
    } finally {
      pending.release();
      host.runtime?.setBeforeSessionInvalidate(undefined);
      host.runtime?.setRebindSession(undefined);
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "an in-flight rebind retains its caller hook when another hook is registered",
  { timeout: 30000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const entered = barrier(),
      release = barrier();
    let operation: Promise<unknown> | undefined;
    try {
      await host.initialize(fixture.cwd);
      const runtime = host.sdk.runtime;
      const calls: string[] = [];
      const load = Reflect.get(host, "loadKeybindings").bind(host);
      let held = false;
      Reflect.set(host, "loadKeybindings", async () => {
        await load();
        if (!held) {
          held = true;
          entered.release();
          await release.promise;
        }
      });
      runtime.setRebindSession(async () => {
        calls.push("original");
      });
      operation = runtime.newSession();
      void operation.catch(() => {});
      await Promise.race([
        entered.promise,
        operation.then(() => {
          throw new Error("Desktop rebind was skipped");
        }),
      ]);
      runtime.setRebindSession(async () => {
        calls.push("successor");
      });
      release.release();
      await operation;
      await runtime.newSession();
      assert.deepEqual(calls, ["original", "successor"]);
      runtime.setRebindSession(undefined);
    } finally {
      release.release();
      await operation?.catch(() => {});
      host.runtime?.setRebindSession(undefined);
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "a rebind caller can await host shutdown without reviving desktop surfaces",
  { timeout: 20000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      const runtime = host.sdk.runtime;
      runtime.setRebindSession(async (session) => {
        assert.ok(session.extensionRunner.hasUI());
        await host.dispose();
      });
      assert.deepEqual(await runtime.newSession(), { cancelled: false });
      assert.equal(host.runtime, undefined);
      assert.deepEqual(host.desktopUI.surfaces, []);
      assert.equal(
        runtime.setRebindSession,
        AgentSessionRuntime.prototype.setRebindSession,
      );
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "workspace retirement detaches runtime hooks and captured setters from its successor",
  { timeout: 30000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      const previous = host.sdk.runtime;
      const captured = previous.setBeforeSessionInvalidate;
      let calls = 0;
      previous.setBeforeSessionInvalidate(() => {
        calls++;
      });
      await host.initialize(fixture.root);
      assert.equal(calls, 1);
      assert.equal(
        previous.setRebindSession,
        AgentSessionRuntime.prototype.setRebindSession,
      );
      assert.equal(
        previous.setBeforeSessionInvalidate,
        AgentSessionRuntime.prototype.setBeforeSessionInvalidate,
      );
      const editor = host.desktopUI.surfaces.find(
        ({ slot }) => slot === "editor",
      )!.instanceId;
      host.session.extensionRunner
        .getUIContext()
        .setEditorText("Successor draft");
      captured.call(previous, () => {
        calls++;
      });
      await previous.dispose();
      assert.equal(calls, 2);
      assert.equal(
        host.desktopUI.surfaces.find(({ slot }) => slot === "editor")!
          .instanceId,
        editor,
      );
      assert.equal(host.snapshot().editor.text, "Successor draft");
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test("runtime callback setters retain receivers, returns, callbacks and own descriptors", async () => {
  const runtime: AgentSessionRuntime = Object.create(
    AgentSessionRuntime.prototype,
  );
  const native = AgentSessionRuntime.prototype.setRebindSession;
  const sentinel = {};
  const receivers: unknown[] = [];
  const original = function (
    this: AgentSessionRuntime,
    callback: Parameters<typeof native>[0],
  ) {
    receivers.push(this);
    native.call(this, callback);
    return sentinel;
  };
  Object.defineProperty(runtime, "setRebindSession", {
    value: original,
    configurable: true,
    writable: false,
    enumerable: true,
  });
  const descriptor = Object.getOwnPropertyDescriptor(
    runtime,
    "setRebindSession",
  );
  const calls: string[] = [];
  const restore = bindRuntimeCallbacks(runtime, {
    current: () => true,
    rebind: async () => {
      calls.push("host rebind");
    },
    beforeInvalidate: () => {
      calls.push("host cleanup");
    },
  });
  const callback = async function (
    this: AgentSessionRuntime,
    session: AgentSession,
  ) {
    assert.equal(this, runtime);
    assert.equal(session, value);
    calls.push("caller rebind");
  };
  const value: AgentSession = Object.create(null);
  const captured = runtime.setRebindSession;
  assert.equal(Reflect.apply(captured, runtime, [callback]), sentinel);
  const borrowed = {};
  assert.equal(Reflect.apply(captured, borrowed, [callback]), sentinel);
  assert.equal(Reflect.get(borrowed, "rebindSession"), callback);
  await Reflect.get(runtime, "rebindSession").call(runtime, value);
  assert.deepEqual(calls, ["host rebind", "caller rebind"]);
  const failure = {};
  runtime.setBeforeSessionInvalidate(() => {
    calls.push("caller cleanup");
    throw failure;
  });
  assert.throws(
    () => Reflect.get(runtime, "beforeSessionInvalidate").call(runtime),
    (error) => error === failure,
  );
  assert.deepEqual(calls.slice(-2), ["caller cleanup", "host cleanup"]);
  restore();
  restore();
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(runtime, "setRebindSession"),
    descriptor,
  );
  assert.equal(Reflect.get(runtime, "rebindSession"), callback);
  const next = async () => {};
  assert.equal(Reflect.apply(captured, runtime, [next]), sentinel);
  assert.equal(Reflect.get(runtime, "rebindSession"), next);
  assert.deepEqual(receivers, [runtime, runtime, borrowed, runtime, runtime]);
});

for (const frozen of [false, true])
  test(`runtime callback retirement respects ${frozen ? "frozen owned" : "replacement"} setters`, () => {
    const runtime: AgentSessionRuntime = Object.create(
      AgentSessionRuntime.prototype,
    );
    const calls: string[] = [];
    const restore = bindRuntimeCallbacks(runtime, {
      current: () => true,
      rebind: async () => {},
      beforeInvalidate: () => {
        calls.push("host");
      },
    });
    const captured = runtime.setBeforeSessionInvalidate;
    const callback = () => {
      calls.push("caller");
    };
    runtime.setBeforeSessionInvalidate(callback);
    const replacement = function (
      this: AgentSessionRuntime,
      next: Parameters<AgentSessionRuntime["setBeforeSessionInvalidate"]>[0],
    ) {
      AgentSessionRuntime.prototype.setBeforeSessionInvalidate.call(this, next);
    };
    if (frozen)
      Object.defineProperty(runtime, "setBeforeSessionInvalidate", {
        configurable: false,
        writable: false,
      });
    else {
      Object.defineProperty(runtime, "setBeforeSessionInvalidate", {
        value: replacement,
        configurable: true,
      });
      runtime.setBeforeSessionInvalidate(callback);
    }
    restore();
    assert.equal(
      runtime.setBeforeSessionInvalidate,
      frozen ? captured : replacement,
    );
    Reflect.get(runtime, "beforeSessionInvalidate").call(runtime);
    assert.deepEqual(calls, ["caller"]);
    captured.call(runtime, undefined);
    assert.equal(Reflect.get(runtime, "beforeSessionInvalidate"), undefined);
  });

test(
  "failed original runtime cleanup restores public callback setters without masking its error",
  { timeout: 20000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const failure = {};
    try {
      await host.initialize(fixture.cwd);
      const runtime = host.sdk.runtime;
      const callback = async () => {};
      runtime.setRebindSession(callback);
      const original = runtime.dispose.bind(runtime);
      runtime.dispose = async () => {
        await original();
        throw failure;
      };
      await assert.rejects(host.dispose(), (error) => error === failure);
      assert.equal(
        runtime.setRebindSession,
        AgentSessionRuntime.prototype.setRebindSession,
      );
      assert.equal(
        runtime.setBeforeSessionInvalidate,
        AgentSessionRuntime.prototype.setBeforeSessionInvalidate,
      );
      assert.equal(Reflect.get(runtime, "rebindSession"), callback);
    } finally {
      await host.dispose().catch(() => {});
      await fixture.close();
    }
  },
);
