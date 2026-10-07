import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import type { DesktopRenderSource } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import type { PiComponent } from "../backend/component-runtime.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import { createFixture } from "./fixture.ts";

type Disposable = PiComponent & {
  dispose(): void;
  setValue(value: string): void;
};
const nodes = (node: DesktopNode): DesktopNode[] => [
  node,
  ...("children" in node
    ? node.children
    : node.kind === "region"
      ? [node.child]
      : []
  ).flatMap(nodes),
];

function install(target: PiComponent, mode: string, dispose: () => void) {
  if (mode === "inherited") {
    const prototype = Object.create(Object.getPrototypeOf(target));
    Object.defineProperty(prototype, "dispose", { value: dispose });
    Object.setPrototypeOf(target, prototype);
  } else if (mode === "getter") {
    Object.defineProperty(target, "dispose", {
      configurable: true,
      get: () => dispose,
    });
  } else {
    Object.defineProperty(target, "dispose", {
      value: dispose,
      writable: mode === "writable",
      configurable: mode === "configurable",
    });
  }
}

test("Pi components with readonly disposal methods retain desktop editing and original cleanup", async (t) => {
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
        const input = new api.Input({ prompt: "Readonly lifecycle" });
        let disposed = 0;
        const submitted: string[] = [];
        const originalDispose = function (this: PiComponent) {
          assert.equal(this, input);
          disposed++;
        };
        install(input, mode, originalDispose);
        input.onSubmit = (value: string) => submitted.push(value);
        const descriptor = Object.getOwnPropertyDescriptor(input, "dispose");
        try {
          await registry.mount(() => input, "header", "readonly");
          const node = nodes(registry.surfaces[0].view).find(
            (node) => node.kind === "input",
          );
          assert.equal(node?.kind, "input");
          input.setValue("SDK change");
          await registry.input("readonly", "\x05");
          await registry.input("readonly", "!");
          await registry.input("readonly", "\r");
          assert.deepEqual(submitted, ["SDK change!"]);
          assert.equal(disposed, 0);
          if (mode === "locked")
            assert.deepEqual(
              Object.getOwnPropertyDescriptor(input, "dispose"),
              descriptor,
            );
          registry.close("readonly");
          registry.close("readonly");
          assert.equal(disposed, 1);
        } finally {
          registry.clearSurfaces();
        }
      });
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});

test("frozen opaque roots retain original input, receiver and cleanup", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  let text = "original",
    disposed = 0;
  const root = Object.freeze({
    render: () => [text],
    invalidate() {},
    handleInput(data: string) {
      text += data;
    },
    dispose() {
      assert.equal(this, root);
      disposed++;
    },
  });
  const descriptor = Object.getOwnPropertyDescriptor(root, "dispose");
  try {
    await host.initialize(fixture.cwd);
    await registry.mount(() => root, "header", "frozen");
    const node = nodes(registry.surfaces[0].view).find(
      (node) => node.kind === "terminal",
    )!;
    assert.equal(node.kind, "terminal");
    await registry.action("frozen", {
      action: node.kind === "terminal" ? node.action : "",
      value: { data: "!" },
    });
    assert.equal(text, "original!");
    assert.equal(disposed, 0);
    registry.close("frozen");
    registry.close("frozen");
    assert.equal(disposed, 1);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(root, "dispose"),
      descriptor,
    );
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});

test("immutable descendant disposers preserve the original parent's cleanup authority", async (t) => {
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
    for (const parentDisposal of ["children", "self", "none"])
      for (const presentation of ["desktop", "terminal"])
        await t.test(`${parentDisposal}/${presentation}`, async () => {
          const events: string[] = [];
          const child = new api.Input({
            prompt: "Immutable child",
          }) as Disposable;
          install(child, "locked", function (this: PiComponent) {
            assert.equal(this, child);
            events.push("child");
          });
          const descriptor = Object.getOwnPropertyDescriptor(child, "dispose");
          const root =
            presentation === "desktop"
              ? new (Reflect.get(api, "Container"))()
              : {
                  child,
                  render: (width: number) => child.render(width - 4),
                  invalidate: () => child.invalidate(),
                };
          if (presentation === "desktop") root.addChild(child);
          if (parentDisposal !== "none")
            install(root, "locked", function (this: PiComponent) {
              assert.equal(this, root);
              events.push("parent");
              if (parentDisposal === "children") child.dispose();
            });
          try {
            await registry.mount(() => root, "header", "immutable-tree");
            assert.ok(
              nodes(registry.surfaces[0].view).some(
                (node) =>
                  node.kind ===
                  (presentation === "desktop" ? "input" : "terminal"),
              ),
            );
            child.setValue("SDK replacement");
            registry.invalidate();
            assert.equal(events.length, 0);
            registry.close("immutable-tree");
            registry.close("immutable-tree");
            assert.deepEqual(
              events,
              parentDisposal === "children"
                ? ["parent", "child"]
                : parentDisposal === "self"
                  ? ["parent"]
                  : ["child"],
            );
            assert.deepEqual(
              Object.getOwnPropertyDescriptor(child, "dispose"),
              descriptor,
            );
          } finally {
            registry.clearSurfaces();
          }
        });
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});

test("disposal accessors retain their descriptor and read the current original callback only during cleanup", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const input = new api.Input({ prompt: "Getter input" });
  let reads = 0,
    originalCalls = 0,
    replacementCalls = 0;
  let cleanup = () => {
    originalCalls++;
  };
  Object.defineProperty(input, "dispose", {
    configurable: true,
    get: () => {
      reads++;
      return cleanup;
    },
    set: () => {
      throw new Error("Original disposal setter must not run");
    },
  });
  const descriptor = Object.getOwnPropertyDescriptor(input, "dispose");
  try {
    await host.initialize(fixture.cwd);
    await registry.mount(() => input, "header", "getter");
    registry.invalidate();
    assert.equal(reads, 0);
    cleanup = function (this: PiComponent) {
      assert.equal(this, input);
      replacementCalls++;
    };
    registry.close("getter");
    registry.close("getter");
    assert.equal(reads, 1);
    assert.equal(originalCalls, 0);
    assert.equal(replacementCalls, 1);
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

test("renderer replacement defers original cleanup while an immutable child is still in use", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const Container = Reflect.get(api, "Container");
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const child = new api.Input({
    prompt: "Shared immutable input",
  }) as Disposable;
  let childCalls = 0,
    parentCalls = 0;
  install(child, "locked", () => {
    childCalls++;
  });
  const first = new Container();
  first.addChild(child);
  install(first, "locked", () => {
    parentCalls++;
    child.dispose();
  });
  const second = new Container();
  second.addChild(child);
  const renderer = (value: string) => (value === "first" ? first : second);
  const source = (value: string): DesktopRenderSource => ({
    kind: "message",
    renderer,
    value,
    context: {
      expanded: false,
      isStreaming: false,
      isPartial: false,
      isError: false,
      argsComplete: true,
      executionStarted: false,
      cwd: fixture.cwd,
      state: {},
    },
  });
  const reconcile = (value: string) =>
    registry.reconcile([
      {
        id: "shared-disposal",
        slot: "message",
        source: source(value),
        target: { messageId: "shared" },
      },
    ]);
  const until = async (probe: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!probe()) {
      if (Date.now() > deadline)
        throw new Error("Renderer replacement timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    await host.initialize(fixture.cwd);
    child.setValue("first");
    reconcile("first");
    await until(() =>
      nodes(registry.surfaces[0]?.view ?? { kind: "spacer", lines: 0 }).some(
        (node) => node.kind === "input" && node.value === "first",
      ),
    );
    child.setValue("second");
    reconcile("second");
    await until(() =>
      nodes(registry.surfaces[0].view).some(
        (node) => node.kind === "input" && node.value === "second",
      ),
    );
    assert.equal(parentCalls, 0);
    assert.equal(childCalls, 0);
    await registry.input("shared-disposal", "\x05");
    await registry.input("shared-disposal", "!");
    assert.equal(Reflect.get(child, "getValue").call(child), "second!");
    registry.close("shared-disposal");
    registry.close("shared-disposal");
    assert.equal(parentCalls, 1);
    assert.equal(childCalls, 1);
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});

test("a cached immutable child remains reusable after its original parent disposes only itself", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const Container = Reflect.get(api, "Container"),
    Text = Reflect.get(api, "Text");
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const child = new api.Input({
    prompt: "Cached immutable input",
  }) as Disposable;
  let childCalls = 0,
    parentCalls = 0;
  install(child, "locked", () => {
    childCalls++;
  });
  const parent = new Container();
  parent.addChild(child);
  install(parent, "locked", () => {
    parentCalls++;
  });
  const replacement = new Text("Replacement frame");
  const renderer = (value: string) =>
    value === "parent" ? parent : value === "replacement" ? replacement : child;
  const source = (value: string): DesktopRenderSource => ({
    kind: "message",
    renderer,
    value,
    context: {
      expanded: false,
      isStreaming: false,
      isPartial: false,
      isError: false,
      argsComplete: true,
      executionStarted: false,
      cwd: fixture.cwd,
      state: {},
    },
  });
  const reconcile = (value: string) =>
    registry.reconcile([
      {
        id: "cached-disposal",
        slot: "message",
        source: source(value),
        target: { messageId: "cached" },
      },
    ]);
  const until = async (probe: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!probe()) {
      if (Date.now() > deadline)
        throw new Error("Cached renderer replacement timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    await host.initialize(fixture.cwd);
    child.setValue("cached");
    reconcile("parent");
    await until(() =>
      JSON.stringify(registry.surfaces).includes("Cached immutable input"),
    );
    reconcile("replacement");
    await until(() =>
      JSON.stringify(registry.surfaces).includes("Replacement frame"),
    );
    assert.equal(parentCalls, 1);
    assert.equal(childCalls, 0);
    child.setValue("restored");
    reconcile("child");
    await until(() =>
      nodes(registry.surfaces[0].view).some(
        (node) => node.kind === "input" && node.value === "restored",
      ),
    );
    await registry.input("cached-disposal", "\x05");
    await registry.input("cached-disposal", "!");
    assert.equal(Reflect.get(child, "getValue").call(child), "restored!");
    registry.close("cached-disposal");
    assert.equal(parentCalls, 1);
    assert.equal(childCalls, 1);
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});

test("a throwing disposal getter retains original cleanup side effects without repeating immutable child calls", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const Container = Reflect.get(api, "Container");
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const events: string[] = [],
    notices: string[] = [];
  host.on("event", (event) => {
    if (event.type === "notice") notices.push(event.message);
  });
  const child = new api.Input({ prompt: "Getter-owned input" }) as Disposable;
  install(child, "locked", () => {
    events.push("child");
  });
  const root = new Container();
  root.addChild(child);
  Object.defineProperty(root, "dispose", {
    get: () => {
      events.push("lookup");
      child.dispose();
      throw new Error("Original getter cleanup failure");
    },
  });
  try {
    await host.initialize(fixture.cwd);
    await registry.mount(() => root, "header", "getter-failure");
    assert.deepEqual(events, []);
    registry.close("getter-failure");
    registry.close("getter-failure");
    assert.deepEqual(events, ["lookup", "child"]);
    assert.deepEqual(
      notices.filter((message) =>
        message.includes("Original getter cleanup failure"),
      ),
      ["Original getter cleanup failure"],
    );
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});
