import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { ComponentDisposal } from "../backend/component-disposal.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";
import type { PiComponent } from "../backend/component-runtime.ts";

test("reusing original components across factories preserves each mount's cleanup and descriptors", async (t) => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  try {
    await host.initialize(fixture.cwd);
    for (const mode of [
      "writable",
      "configurable",
      "inherited",
      "getter",
      "locked",
    ])
      await t.test(mode, async () => {
        const input = new api.Input({ prompt: "Reusable input" });
        let disposed = 0;
        const dispose = function (this: PiComponent) {
          assert.equal(this, input);
          disposed++;
        };
        if (mode === "inherited") {
          const prototype = Object.create(Object.getPrototypeOf(input));
          Object.defineProperty(prototype, "dispose", { value: dispose });
          Object.setPrototypeOf(input, prototype);
        } else
          Object.defineProperty(
            input,
            "dispose",
            mode === "getter"
              ? { configurable: true, get: () => dispose }
              : {
                  value: dispose,
                  writable: mode === "writable",
                  configurable: mode === "configurable",
                },
          );
        const descriptor = Object.getOwnPropertyDescriptor(input, "dispose");
        const submissions: string[] = [];
        input.onSubmit = (value: string) => submissions.push(value);
        for (const [index, slot] of [
          "header",
          "footer",
          "dialog",
          "header",
        ].entries()) {
          await registry.mount(
            () => input,
            slot as "header" | "footer" | "dialog",
            "reused",
          );
          input.setValue(`mount-${index}`);
          registry.focus("reused");
          await registry.input("reused", "\x05");
          await registry.input("reused", "!");
          await registry.input("reused", "\r");
          registry.close("reused");
          assert.equal(disposed, index + 1);
        }
        assert.deepEqual(
          Object.getOwnPropertyDescriptor(input, "dispose"),
          descriptor,
        );
        assert.deepEqual(submissions, [
          "mount-0!",
          "mount-1!",
          "mount-2!",
          "mount-3!",
        ]);
      });
    await t.test("frozen opaque root", async () => {
      let disposed = 0;
      const root = Object.freeze({
        render: () => ["Reusable frozen frame"],
        invalidate() {},
        dispose() {
          assert.equal(this, root);
          disposed++;
        },
      });
      for (let index = 0; index < 3; index++) {
        await registry.mount(() => root, "header", "frozen-reused");
        registry.close("frozen-reused");
        assert.equal(disposed, index + 1);
      }
    });
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});

test("overlapping factories do not recursively wrap each other's original cleanup", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const input = new api.Input({ prompt: "Shared factory input" });
  let disposed = 0;
  Object.defineProperty(input, "dispose", {
    value() {
      assert.equal(this, input);
      disposed++;
    },
    writable: true,
    configurable: true,
  });
  const descriptor = Object.getOwnPropertyDescriptor(input, "dispose");
  try {
    await host.initialize(fixture.cwd);
    await registry.mount(() => input, "header", "first");
    await registry.mount(() => input, "footer", "second");
    for (let index = 0; index < 4; index++) {
      assert.equal(registry.surfaces.length, 2);
      input.setValue(`shared-${index}`);
      registry.invalidate();
    }
    registry.close("first");
    assert.equal(disposed, 1);
    await registry.input("second", "\x05");
    await registry.input("second", "!");
    assert.equal(input.getValue(), "shared-3!");
    registry.close("second");
    assert.equal(disposed, 2);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(input, "dispose"),
      descriptor,
    );
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});

test("a retired guard cannot act on a later mount in the same disposal tracker", () => {
  const tracker = new ComponentDisposal<{ dispose(): void }>();
  let disposed = 0;
  const target = {
    dispose() {
      assert.equal(this, target);
      disposed++;
    },
  };
  const original = Object.getOwnPropertyDescriptor(target, "dispose");
  tracker.track(target);
  const retired = target.dispose;
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(disposed, 1);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(target, "dispose"),
    original,
  );
  tracker.track(target);
  retired();
  assert.equal(disposed, 1);
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(disposed, 2);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(target, "dispose"),
    original,
  );
});

test("original parent cleanup claims a shared child in its own factory", () => {
  const first = new ComponentDisposal<{ dispose(): void }>();
  const second = new ComponentDisposal<{ dispose(): void }>();
  const events: string[] = [];
  const child = {
    dispose() {
      events.push("child");
    },
  };
  const parent = {
    dispose() {
      events.push("parent");
      child.dispose();
    },
  };
  first.connect(parent, [child]);
  second.track(child);
  parent.dispose();
  assert.deepEqual(events, ["parent", "child"]);
  first.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["parent", "child"]);
  second.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["parent", "child", "child"]);
});

test("factory retirement retains replacement methods and restores guards even after an original error", () => {
  const tracker = new ComponentDisposal<{ dispose(): void }>();
  const failure = new Error("Original cleanup failure");
  const target: { dispose(): void } = {
    dispose() {
      throw failure;
    },
  };
  const original = Object.getOwnPropertyDescriptor(target, "dispose");
  tracker.track(target);
  const retired = target.dispose;
  assert.throws(
    () => tracker.release(new Set(), (_target, dispose) => dispose?.()),
    failure,
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(target, "dispose"),
    original,
  );
  assert.doesNotThrow(retired);
  let calls = 0;
  const replacement = function (this: typeof target) {
    assert.equal(this, target);
    calls++;
  };
  tracker.track(target);
  target.dispose = replacement;
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(calls, 1);
  assert.equal(target.dispose, replacement);
  tracker.track(target);
  tracker.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(calls, 2);
});

test("cleanup-installed replacements survive overlapping factory retirement", () => {
  const first = new ComponentDisposal<{ dispose(): void }>();
  const second = new ComponentDisposal<{ dispose(): void }>();
  const events: string[] = [];
  const replacement = function (this: typeof target) {
    assert.equal(this, target);
    events.push("replacement");
  };
  const target = {
    dispose() {
      events.push("original");
      target.dispose = replacement;
    },
  };
  first.track(target);
  second.track(target);
  first.track(target);
  first.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(target.dispose, replacement);
  second.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["original", "replacement"]);
  assert.equal(target.dispose, replacement);
});

test("reentrant factory retirement keeps each original cleanup scope and a still-active guard", () => {
  const first = new ComponentDisposal<{ dispose(): void }>();
  const second = new ComponentDisposal<{ dispose(): void }>();
  const events: string[] = [];
  let phase = "before";
  const child = {
    dispose() {
      events.push(phase);
    },
  };
  const original = Object.getOwnPropertyDescriptor(child, "dispose");
  const parent = {
    dispose() {
      events.push("parent");
      child.dispose();
      phase = "second-factory";
      second.release(new Set(), (_target, dispose) => dispose?.());
      phase = "after";
      child.dispose();
    },
  };
  first.connect(parent, [child]);
  second.track(child);
  first.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["parent", "before", "second-factory"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(child, "dispose"), original);
});

test("a cleaned live guard still delegates another factory's original parent call", () => {
  const first = new ComponentDisposal<{ dispose(): void }>();
  const second = new ComponentDisposal<{ dispose(): void }>();
  const events: string[] = [];
  let phase = "second-factory";
  const child = {
    dispose() {
      events.push(phase);
    },
  };
  const parent = {
    dispose() {
      child.dispose();
    },
  };
  first.connect(parent, [child]);
  second.track(child);
  child.dispose();
  phase = "first-parent";
  parent.dispose();
  assert.deepEqual(events, ["second-factory", "first-parent"]);
  phase = "retirement";
  first.release(new Set(), (_target, dispose) => dispose?.());
  second.release(new Set(), (_target, dispose) => dispose?.());
  assert.deepEqual(events, ["second-factory", "first-parent"]);
});

test("a component frozen after mounting retains original cleanup when another factory reuses it", () => {
  const first = new ComponentDisposal<{ dispose(): void }>();
  const second = new ComponentDisposal<{ dispose(): void }>();
  let calls = 0;
  const target = {
    dispose() {
      assert.equal(this, target);
      calls++;
    },
  };
  first.track(target);
  Object.freeze(target);
  const frozen = Object.getOwnPropertyDescriptor(target, "dispose");
  first.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(calls, 1);
  second.track(target);
  second.release(new Set(), (_target, dispose) => dispose?.());
  assert.equal(calls, 2);
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "dispose"), frozen);
});
