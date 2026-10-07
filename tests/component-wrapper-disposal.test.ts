import test from "node:test";
import assert from "node:assert/strict";
import { ComponentDisposal } from "../backend/component-disposal.ts";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";

test("extension disposal wrappers preserve their captured original callback across mounted lifecycles", async (t) => {
  for (const mode of [
    "single",
    "chain",
    "remount",
    "overlap",
    "existing-peer",
    "frozen",
    "frozen-wrapper",
  ])
    await t.test(mode, () => {
      const first = new ComponentDisposal<{ dispose(): void }>();
      const second = new ComponentDisposal<{ dispose(): void }>();
      const events: string[] = [];
      const target = {
        dispose() {
          assert.equal(this, target);
          events.push("original");
        },
      };
      first.track(target);
      if (mode === "existing-peer") second.track(target);
      let replacement = target.dispose;
      const levels = mode === "chain" ? 3 : 1;
      for (let index = 0; index < levels; index++) {
        const previous = target.dispose;
        target.dispose = function () {
          assert.equal(this, target);
          events.push(`before-${index}`);
          previous.call(this);
          events.push(`after-${index}`);
        };
        replacement = target.dispose;
        if (mode === "frozen-wrapper") Object.freeze(target);
        first.track(target);
      }
      const wrapper = target.dispose;
      if (mode === "overlap") second.track(target);
      if (mode === "frozen") Object.freeze(target);
      const expected = [
        ...Array.from(
          { length: levels },
          (_, index) => `before-${levels - index - 1}`,
        ),
        "original",
        ...Array.from({ length: levels }, (_, index) => `after-${index}`),
      ];
      first.release(new Set(), (_target, dispose) => dispose?.());
      assert.deepEqual(events, expected);
      if (mode === "remount") {
        second.track(target);
        second.release(new Set(), (_target, dispose) => dispose?.());
        assert.deepEqual(events, [...expected, ...expected]);
      } else if (mode === "overlap" || mode === "existing-peer") {
        second.release(new Set(), (_target, dispose) => dispose?.());
        assert.deepEqual(events, [...expected, ...expected]);
      }
      if (mode !== "frozen") assert.equal(target.dispose, replacement);
      if (mode !== "frozen-wrapper") wrapper();
      assert.deepEqual(
        events,
        ["overlap", "existing-peer", "remount"].includes(mode)
          ? [...expected, ...expected]
          : expected,
      );
    });
});

test("captured guard chains suppress duplicate calls without swallowing the original cleanup", () => {
  const tracker = new ComponentDisposal<{ dispose(): void }>();
  const events: string[] = [];
  const target = {
    dispose() {
      assert.equal(this, target);
      events.push("original");
    },
  };
  tracker.track(target);
  const captured = target.dispose;
  target.dispose = function () {
    assert.equal(this, target);
    events.push("before");
    captured.call(this);
    captured.call(this);
    target.dispose();
    events.push("after");
  };
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["before", "original", "after"]);
});

test("throwing original callbacks unwind captured wrappers and restore their next lifecycle", () => {
  const tracker = new ComponentDisposal<{ dispose(): void }>();
  const events: string[] = [];
  const failure = new Error("Original wrapper failure");
  const target: { dispose(): void } = {
    dispose() {
      assert.equal(this, target);
      events.push("original");
      throw failure;
    },
  };
  tracker.track(target);
  const captured = target.dispose;
  const replacement = function (this: typeof target) {
    events.push("before");
    try {
      captured.call(this);
    } finally {
      events.push("after");
    }
  };
  target.dispose = replacement;
  for (let index = 0; index < 2; index++) {
    tracker.track(target);
    assert.throws(
      () => tracker.release(new Set(), (_target, dispose) => dispose?.()),
      failure,
    );
    assert.equal(target.dispose, replacement);
  }
  assert.deepEqual(events, [
    "before",
    "original",
    "after",
    "before",
    "original",
    "after",
  ]);
  captured();
  assert.equal(events.length, 6);
});

test("a real Pi input can install a disposal wrapper during its original input callback", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const input = new api.Input({ prompt: "Wrapped cleanup" });
  const events: string[] = [];
  input.dispose = function () {
    assert.equal(this, input);
    events.push("original");
  };
  const originalInput = input.handleInput.bind(input);
  let wrapped = false;
  input.handleInput = (data: string) => {
    originalInput(data);
    if (!wrapped) {
      wrapped = true;
      const previous = input.dispose;
      assert.ok(previous);
      input.dispose = function () {
        assert.equal(this, input);
        events.push("before");
        previous.call(this);
        events.push("after");
      };
    }
  };
  try {
    await host.initialize(fixture.cwd);
    for (let index = 0; index < 3; index++) {
      await registry.mount(() => input, "dialog", "wrapped-cleanup");
      await registry.input("wrapped-cleanup", "x");
      assert.equal(input.getValue(), "x".repeat(index + 1));
      registry.close("wrapped-cleanup");
      assert.deepEqual(
        events,
        Array.from({ length: index + 1 }, () => [
          "before",
          "original",
          "after",
        ]).flat(),
      );
    }
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});
