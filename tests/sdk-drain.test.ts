import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { awaitSdkDrainFile, prepareSdkDrain } from "./sdk-drain-workflows.ts";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((done) => (release = done));
  return { promise, release };
}

for (const mode of ["result", "rejection", "package"] as const)
  test(
    `closing joins an invoked withSdk ${mode} without losing its native context`,
    { timeout: 20000 },
    async () => {
      const fixture = await createFixture();
      const host = new DesktopHost(fixture.agentDir);
      const entered = barrier(),
        release = barrier(),
        aborted = barrier();
      const value = { callback: () => 42 };
      const failure = {};
      const order: string[] = [];
      let pending: Promise<unknown> | undefined;
      try {
        if (mode !== "package") {
          await host.initialize(fixture.cwd);
          host.runtime!.setBeforeSessionInvalidate(() => order.push("dispose"));
        }
        pending = host.withSdk(async (context) => {
          context.signal!.addEventListener("abort", aborted.release, {
            once: true,
          });
          entered.release();
          await release.promise;
          assert.equal(context.signal!.aborted, true);
          assert.equal(context.sdk.VERSION, "1.0.0");
          if (mode !== "package") assert.equal(context.session, host.session);
          order.push("operation");
          if (mode === "rejection") throw failure;
          return value;
        });
        void pending.catch(() => {});
        await entered.promise;
        let closed = false;
        const shutdown = host.dispose().then(() => {
          closed = true;
        });
        await aborted.promise;
        await new Promise((done) => setImmediate(done));
        assert.equal(
          closed,
          false,
          "a running callback still owns native SDK resources",
        );
        release.release();
        if (mode === "rejection")
          await assert.rejects(pending, (error) => error === failure);
        else assert.equal(await pending, value);
        await shutdown;
        assert.deepEqual(
          order,
          mode === "package" ? ["operation"] : ["operation", "dispose"],
        );
        assert.equal(host.runtime, undefined);
      } finally {
        release.release();
        await pending?.catch(() => {});
        await host.dispose();
        await fixture.close();
      }
    },
  );

test(
  "nested withSdk shutdown excludes its own ancestry while joining a concurrent callback",
  { timeout: 20000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const entered = barrier(),
      release = barrier(),
      closing = barrier();
    let first: Promise<unknown> | undefined,
      second: Promise<unknown> | undefined;
    try {
      await host.initialize(fixture.cwd);
      first = host.withSdk(async ({ signal, session }) => {
        entered.release();
        await release.promise;
        assert.equal(signal!.aborted, true);
        assert.equal(session, host.session);
        return "sibling finished";
      });
      await entered.promise;
      second = host.withSdk(({ host }) =>
        host.withSdk(async ({ sdk }) => {
          const shutdown = host.dispose();
          closing.release();
          await shutdown;
          return sdk.VERSION;
        }),
      );
      void second.catch(() => {});
      await closing.promise;
      await new Promise((done) => setImmediate(done));
      assert.ok(
        host.runtime,
        "the sibling callback must keep the session alive",
      );
      release.release();
      assert.equal(await first, "sibling finished");
      assert.equal(await second, "1.0.0");
      assert.equal(host.runtime, undefined);
    } finally {
      release.release();
      await Promise.allSettled([first, second]);
      await host.dispose();
      await fixture.close();
    }
  },
);

for (const mode of ["own", "external"] as const)
  test(
    `withSdk ${mode} shutdown retains the caller's rejection`,
    { timeout: 20000 },
    async () => {
      const fixture = await createFixture();
      const host = new DesktopHost(fixture.agentDir);
      const entered = barrier(),
        release = barrier();
      const failure = Symbol("original SDK callback rejection");
      let pending: Promise<unknown> | undefined;
      try {
        await host.initialize(fixture.cwd);
        pending = host.withSdk(async () => {
          entered.release();
          await release.promise;
          await host.dispose();
          throw failure;
        });
        void pending.catch(() => {});
        await entered.promise;
        const shutdown = mode === "external" ? host.dispose() : undefined;
        release.release();
        await assert.rejects(pending, (error) => error === failure);
        await shutdown;
        assert.equal(host.runtime, undefined);
      } finally {
        release.release();
        await pending?.catch(() => {});
        await host.dispose();
        await fixture.close();
      }
    },
  );

for (const operation of [
  "generateImages",
  "classify",
  "cancelDeferred",
] as const)
  test(
    `closing joins the original provider's ${operation} callback`,
    { timeout: 20000 },
    async () => {
      const fixture = await createFixture();
      const host = new DesktopHost(fixture.agentDir);
      const entered = barrier(),
        release = barrier(),
        aborted = barrier();
      const order: string[] = [];
      let pending: Promise<unknown> | undefined;
      try {
        await host.initialize(fixture.cwd);
        host.runtime!.setBeforeSessionInvalidate(() => order.push("dispose"));
        const runtime = host.sdk.modelRuntime;
        type Provider = Parameters<typeof runtime.registerNativeProvider>[0];
        const base = runtime.getProvider("desktop-test")!;
        const chat = {
          ...runtime.getModel("desktop-test", "desktop-test")!,
          provider: "sdk-drain",
        };
        const image: Parameters<NonNullable<Provider["generateImages"]>>[0] = {
          ...chat,
          type: "image",
          id: "image",
          api: "fixture-images",
          output: ["image"],
        };
        const classifier: Parameters<NonNullable<Provider["classify"]>>[0] = {
          ...chat,
          type: "classifier",
          id: "classifier",
          api: "fixture-classifier",
        };
        const finish = async (signal?: AbortSignal) => {
          assert.ok(signal);
          signal.addEventListener("abort", aborted.release, { once: true });
          entered.release();
          await release.promise;
          assert.equal(signal.aborted, true);
          assert.equal(host.sdk.modelRuntime, runtime);
          order.push("operation");
        };
        runtime.registerNativeProvider({
          ...base,
          id: "sdk-drain",
          name: "SDK drain provider",
          auth: {
            apiKey: {
              name: "Fixture",
              resolve: async () => ({
                auth: { apiKey: "fixture-only" },
                source: "fixture",
              }),
            },
          },
          getModels: () => [chat],
          getAllModels: () => [chat, image, classifier],
          generateImages: async (model, _context, options) => {
            await finish(options?.signal);
            return {
              api: model.api,
              provider: model.provider,
              model: model.id,
              output: [],
              stopReason: "stop",
              timestamp: 1,
            };
          },
          classify: async (model, _context, options) => {
            await finish(options?.signal);
            return {
              api: model.api,
              provider: model.provider,
              model: model.id,
              answers: {},
              stopReason: "stop",
              timestamp: 1,
            };
          },
          cancelDeferred: async (_model, _handle, options) =>
            finish(options?.signal),
        });
        pending = host.action({
          action: "models.request",
          args: {
            id: "sdk-drain-provider",
            operation,
            model: {
              provider: "sdk-drain",
              id:
                operation === "generateImages"
                  ? "image"
                  : operation === "classify"
                    ? "classifier"
                    : "desktop-test",
            },
            context:
              operation === "generateImages"
                ? { input: [] }
                : { state: {}, questions: {} },
            handle: {
              provider: "sdk-drain",
              modelId: "desktop-test",
              api: chat.api,
              id: "fixture",
            },
          },
        });
        void pending.catch(() => {});
        await entered.promise;
        const shutdown = host.dispose();
        await aborted.promise;
        await new Promise((done) => setImmediate(done));
        assert.deepEqual(
          order,
          [],
          "provider completion precedes runtime disposal",
        );
        release.release();
        const result = await pending;
        if (operation !== "cancelDeferred")
          assert.equal((result as { stopReason: string }).stopReason, "stop");
        await shutdown;
        assert.deepEqual(order, ["operation", "dispose"]);
      } finally {
        release.release();
        await pending?.catch(() => {});
        await host.dispose();
        await fixture.close();
      }
    },
  );

test(
  "closing joins a registered autocomplete provider and retains its result",
  { timeout: 20000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const entered = barrier(),
      release = barrier(),
      aborted = barrier();
    const result = {
      prefix: "n",
      items: [{ value: "native", label: "Native" }],
    };
    let pending: Promise<unknown> | undefined;
    try {
      await host.initialize(fixture.cwd);
      host.session.extensionRunner
        .getUIContext()
        .addAutocompleteProvider((original) => ({
          ...original,
          applyCompletion: original.applyCompletion.bind(original),
          getSuggestions: async (_lines, _line, _column, options) => {
            options!.signal!.addEventListener("abort", aborted.release, {
              once: true,
            });
            entered.release();
            await release.promise;
            assert.equal(options!.signal!.aborted, true);
            assert.ok(host.runtime);
            return result;
          },
        }));
      pending = host.action({
        action: "autocomplete.suggest",
        args: { id: "drain-completion", lines: ["n"], line: 0, column: 1 },
      });
      void pending.catch(() => {});
      await entered.promise;
      const shutdown = host.dispose();
      await aborted.promise;
      await new Promise((done) => setImmediate(done));
      assert.ok(host.runtime);
      release.release();
      assert.equal(await pending, result);
      await shutdown;
    } finally {
      release.release();
      await pending?.catch(() => {});
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "an invoked SDK module finishes with live objects before shutdown",
  { timeout: 20000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const { path } = await prepareSdkDrain(fixture.agentDir);
    let pending: Promise<unknown> | undefined;
    try {
      await host.initialize(fixture.cwd);
      pending = host.action({
        action: "sdk.run",
        args: { path, args: { directory: fixture.root } },
      });
      void pending.catch(() => {});
      await awaitSdkDrainFile(join(fixture.root, "sdk-drain-ready.txt"));
      const shutdown = host.dispose();
      await awaitSdkDrainFile(join(fixture.root, "sdk-drain-aborted.txt"));
      assert.ok(host.runtime);
      await writeFile(join(fixture.root, "sdk-drain-release.txt"), "release");
      assert.deepEqual(await pending, {
        aborted: true,
        sessionAlive: true,
        version: "1.0.0",
      });
      await shutdown;
      assert.equal(host.runtime, undefined);
    } finally {
      await writeFile(join(fixture.root, "sdk-drain-release.txt"), "release");
      await pending?.catch(() => {});
      await host.dispose();
      await fixture.close();
    }
  },
);
