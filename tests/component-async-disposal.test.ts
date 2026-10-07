import test from "node:test";
import assert from "node:assert/strict";
import { ComponentDisposal } from "../backend/component-disposal.ts";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("captured disposal callbacks retain their original asynchronous chain and result", async (t) => {
  for (const mode of [
    "microtask",
    "timer",
    "await",
    "nested",
    "frozen",
    "remount",
    "overlap",
  ])
    await t.test(mode, async () => {
      const first = new ComponentDisposal<{ dispose(): void }>();
      const second = new ComponentDisposal<{ dispose(): void }>();
      const events: string[] = [];
      const jobs: Promise<unknown>[] = [];
      const returned: unknown[] = [];
      const waiting = gate();
      const target: { dispose(): void } = {
        dispose() {
          assert.equal(this, target);
          events.push("original");
          return "base-result";
        },
      };
      first.track(target);
      const levels = mode === "nested" ? 3 : 1;
      for (let index = 0; index < levels; index++) {
        const previous = target.dispose;
        target.dispose = function () {
          assert.equal(this, target);
          events.push(`before-${index}`);
          const job = (async () => {
            if (mode === "timer")
              await new Promise<void>((done) => setTimeout(done, 0));
            else if (mode === "await") await waiting.promise;
            else await new Promise<void>((done) => queueMicrotask(done));
            const result = await previous.call(this);
            returned.push(result);
            events.push(`after-${index}`);
            return result;
          })();
          jobs.push(job);
          return job;
        };
        first.track(target);
      }
      const stale = target.dispose;
      if (mode === "frozen") Object.freeze(target);
      if (mode === "overlap") second.track(target);
      let result: unknown;
      first.release(new Set(), (_target, dispose) => {
        result = dispose?.();
      });
      assert.deepEqual(events, [`before-${levels - 1}`]);
      if (mode === "remount") second.track(target);
      if (mode === "overlap")
        second.release(new Set(), (_target, dispose) => dispose?.());
      waiting.resolve();
      await Promise.all(jobs);
      const expected = [
        ...Array.from(
          { length: levels },
          (_, index) => `before-${levels - index - 1}`,
        ),
        "original",
        ...Array.from({ length: levels }, (_, index) => `after-${index}`),
      ];
      if (mode === "overlap")
        assert.deepEqual(events, [
          "before-0",
          "before-0",
          "original",
          "original",
          "after-0",
          "after-0",
        ]);
      else assert.deepEqual(events, expected);
      assert.equal(await result, "base-result");
      assert.ok(returned.every((value) => value === "base-result"));
      if (mode === "remount" || mode === "frozen") {
        if (mode === "frozen") second.track(target);
        second.release(new Set(), (_target, dispose) => dispose?.());
        await Promise.all(jobs);
        assert.deepEqual(events, [...expected, ...expected]);
      }
      const count = events.length;
      stale();
      await Promise.resolve();
      assert.equal(events.length, count);
    });
});

test("an asynchronous original parent cannot clean a retained child after the release scope ends", async () => {
  const tracker = new ComponentDisposal<{ dispose(): void }>();
  const waiting = gate();
  const events: string[] = [];
  let completion!: Promise<void>;
  const child = {
    dispose() {
      events.push("child");
    },
  };
  tracker.track(child);
  const captured = child.dispose;
  const parent = {
    dispose() {
      completion = (async () => {
        await waiting.promise;
        captured.call(child);
        events.push("parent-finished");
      })();
      return completion;
    },
  };
  tracker.connect(parent, [child]);
  tracker.release(new Set([child]), (_target, dispose) => dispose?.());
  waiting.resolve();
  await completion;
  assert.deepEqual(events, ["parent-finished"]);
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["parent-finished", "child"]);
});

test("an asynchronous parent keeps its old ownership when another factory still uses the child", async () => {
  const first = new ComponentDisposal<{ dispose(): void }>();
  const second = new ComponentDisposal<{ dispose(): void }>();
  const waiting = gate();
  const events: string[] = [];
  let completion!: Promise<void>;
  const child = {
    dispose() {
      events.push("child");
    },
  };
  let captured!: () => void;
  const parent = {
    dispose() {
      completion = (async () => {
        await waiting.promise;
        captured.call(child);
        events.push("parent-finished");
      })();
      return completion;
    },
  };
  first.connect(parent, [child]);
  second.track(child);
  captured = child.dispose;
  first.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["child"]);
  waiting.resolve();
  await completion;
  assert.deepEqual(events, ["child", "parent-finished"]);
  second.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["child", "parent-finished", "child"]);
});

test("delayed captured callbacks cannot dispose a successor with a different original method", async () => {
  const tracker = new ComponentDisposal<{ dispose(): void }>();
  const waiting = gate();
  const events: string[] = [];
  let completion!: Promise<void>;
  const target = {
    dispose() {
      events.push("old");
    },
  };
  tracker.track(target);
  const captured = target.dispose;
  target.dispose = function () {
    completion = (async () => {
      await waiting.promise;
      captured.call(this);
    })();
    return completion;
  };
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  target.dispose = () => {
    events.push("new");
  };
  tracker.track(target);
  waiting.resolve();
  await completion;
  assert.deepEqual(events, ["old"]);
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["old", "new"]);
});

test("an original callback cannot consume a rearmed mount in the same tracker", () => {
  const tracker = new ComponentDisposal<{ dispose(): void }>();
  let calls = 0;
  const target = {
    dispose() {
      calls++;
      if (calls === 1) {
        tracker.track(target);
        target.dispose();
      }
    },
  };
  tracker.track(target);
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(calls, 1);
  assert.equal(tracker.has(target), true);
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(calls, 2);
  assert.equal(tracker.has(target), false);
});

test("reentrant asynchronous retirement runs both factories when their original method is shared", async () => {
  const first = new ComponentDisposal<{ dispose(): void }>();
  const second = new ComponentDisposal<{ dispose(): void }>();
  const waiting = gate();
  const events: string[] = [];
  const jobs: Promise<void>[] = [];
  let calls = 0;
  const target = {
    dispose() {
      const index = calls++;
      events.push(`before-${index}`);
      const job = (async () => {
        await waiting.promise;
        if (index === 0) {
          let result: unknown;
          second.release(new Set(), (_target, dispose) => {
            result = dispose?.();
          });
          await result;
        }
        events.push(`after-${index}`);
      })();
      jobs.push(job);
      return job;
    },
  };
  first.track(target);
  second.track(target);
  first.release(new Set(), (_target, dispose) => dispose?.());
  waiting.resolve();
  await Promise.all(jobs);
  assert.deepEqual(events, ["before-0", "before-1", "after-1", "after-0"]);
});

test("asynchronous cleanup errors retain their returned promise and leave the next mount independent", async () => {
  const tracker = new ComponentDisposal<{ dispose(): void }>();
  const failure = new Error("Original delayed cleanup failure");
  const target: { dispose(): void } = {
    dispose() {
      throw failure;
    },
  };
  tracker.track(target);
  const captured = target.dispose;
  target.dispose = async function () {
    await Promise.resolve();
    captured.call(this);
  };
  let result: unknown;
  tracker.release(new Set(), (_target, dispose) => {
    result = dispose?.();
  });
  await assert.rejects(Promise.resolve(result), failure);
  let calls = 0;
  target.dispose = () => {
    calls++;
  };
  tracker.track(target);
  assert.doesNotThrow(captured);
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(calls, 1);
});

test("real Pi Input cleanup can defer its captured callback until after the original dialog closes", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const input = new api.Input({ prompt: "Delayed cleanup" });
  const events: string[] = [];
  const jobs: Promise<void>[] = [];
  input.dispose = function () {
    assert.equal(this, input);
    events.push("original");
  };
  const handleInput = input.handleInput.bind(input);
  let wrapped = false;
  input.handleInput = (data: string) => {
    handleInput(data);
    if (wrapped) return;
    wrapped = true;
    const previous = input.dispose;
    assert.ok(previous);
    input.dispose = function () {
      const job = (async () => {
        await new Promise<void>((done) => setTimeout(done, 0));
        previous.call(this);
        events.push("after");
      })();
      jobs.push(job);
      return job;
    };
  };
  try {
    await host.initialize(fixture.cwd);
    for (let index = 0; index < 3; index++) {
      await registry.mount(() => input, "dialog", "async-cleanup");
      await registry.input("async-cleanup", "x");
      assert.equal(input.getValue(), "x".repeat(index + 1));
      registry.close("async-cleanup");
      await Promise.all(jobs);
      assert.deepEqual(
        events,
        Array.from({ length: index + 1 }, () => ["original", "after"]).flat(),
      );
    }
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});
