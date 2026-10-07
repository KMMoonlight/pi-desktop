import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import { componentFocus } from "../backend/component-runtime.ts";
import { ComponentDisposal } from "../backend/component-disposal.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import { createFixture } from "./fixture.ts";

function nodes(node: DesktopNode): DesktopNode[] {
  return [
    node,
    ...("children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : []
    ).flatMap(nodes),
  ];
}

for (const cleansChild of [true, false]) {
  test(`detached original owner reserves shared immutable child cleanup (${cleansChild})`, () => {
    const disposal = new ComponentDisposal<{ dispose?(): void }>();
    const events: string[] = [];
    const child = Object.freeze({
      dispose() {
        events.push("child");
      },
    });
    const detached = {
      dispose() {
        events.push("owner");
        if (cleansChild) child.dispose();
      },
    };
    const root = {},
      current = {};
    disposal.connect(root, [detached]);
    disposal.connect(detached, [child]);
    disposal.connect(current, [child]);
    disposal.connect(root, [current]);
    const release = (keep: Set<{ dispose?(): void }>) =>
      disposal.release(keep, (_target, dispose) => dispose?.());
    release(new Set([root, current, child]));
    assert.deepEqual(events, []);
    release(new Set());
    assert.deepEqual(events, cleansChild ? ["owner", "child"] : ["owner"]);
    release(new Set());
    assert.deepEqual(events, cleansChild ? ["owner", "child"] : ["owner"]);
  });
}
async function fixture() {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  await host.initialize(files.cwd);
  let changes = 0;
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => changes++,
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Container = Reflect.get(api, "Container");
  const Text = Reflect.get(api, "Text");
  const owner = () =>
    registry.surfaces.find((item) => item.id === "registered");
  const surface = () => {
    const surfaces = registry.surfaces;
    const hosted = surfaces.find((item) => item.id === "registered");
    const global = surfaces.find((item) => item.id === "tui:registrations");
    if (!global) return hosted!;
    return {
      ...hosted,
      ...global,
      overlay: hosted?.overlay,
      focusRequest: global.focusRequest ?? hosted?.focusRequest,
      view: {
        kind: "column",
        inert: global.view.inert,
        children: [global.view, ...(hosted ? [hosted.view] : [])],
      } as DesktopNode,
    };
  };
  const texts = () =>
    nodes(surface().view).flatMap((node) =>
      node.kind === "text" ? [node.text] : [],
    );
  return {
    api,
    host,
    registry,
    Container,
    Text,
    surface,
    owner,
    texts,
    changes: () => changes,
    async close() {
      registry.clearSurfaces();
      await host.dispose();
      await files.close();
    },
  };
}

test("TUI registrations retain native order and duplicates while global clear removes the application tree", async () => {
  const f = await fixture();
  const { registry, Text, Container } = f;
  const first = new Text("First registration");
  const second = new Text("Second registration");
  const root = new Text("Hosted root");
  let tui!: DesktopTui;
  try {
    await registry.mount(
      (value: DesktopTui) => {
        tui = value;
        tui.addChild(first);
        tui.addChild(second);
        tui.addChild(first);
        tui.addChild(root);
        return root;
      },
      "header",
      "registered",
    );
    assert.deepEqual(f.texts(), [
      "First registration",
      "Second registration",
      "First registration",
      "Hosted root",
      "Hosted root",
    ]);
    const occurrences = nodes(f.surface().view)
      .filter((node) => node.kind === "text")
      .map((node) => node.component!.occurrence);
    assert.equal(new Set(occurrences).size, 5);
    assert.deepEqual(
      tui.render(50),
      [root, first, second, first, root].flatMap((item) => item.render(50)),
    );
    const native = new Container();
    native.children = [...tui.children];
    const before = f.changes();
    assert.equal(tui.removeChild(first), native.removeChild(first));
    assert.deepEqual(tui.children, native.children);
    assert.equal(f.changes(), before);
    assert.deepEqual(f.texts(), [
      "Second registration",
      "First registration",
      "Hosted root",
      "Hosted root",
    ]);
    assert.equal(tui.removeChild(new Text("absent")), undefined);
    const old = tui.children;
    assert.equal(tui.clear(), native.clear());
    assert.notEqual(tui.children, old);
    assert.equal(old.length, 10);
    assert.deepEqual(f.texts(), []);
  } finally {
    await f.close();
  }
});

test("the stable TUI proxy binds borrowed methods and preserves native mutation failures", async () => {
  const f = await fixture();
  let tui!: DesktopTui;
  const child = new f.Text("Borrowed child");
  let disposed = 0;
  child.dispose = () => disposed++;
  try {
    await f.registry.mount(
      (value: DesktopTui) => {
        tui = value;
        return new f.Text("Root");
      },
      "header",
      "registered",
    );
    const receiver = new f.Container();
    const original = [...tui.children];
    assert.equal(tui.addChild.call(receiver, child), undefined);
    assert.deepEqual(receiver.children, []);
    assert.deepEqual(tui.children, [...original, child]);
    assert.equal(tui.removeChild.call(receiver, child), undefined);
    tui.addChild.call(receiver, child);
    assert.equal(tui.clear.call(receiver), undefined);
    Object.freeze(receiver.children);
    assert.equal(tui.addChild.call(receiver, child), undefined);
    Object.freeze(tui.children);
    assert.throws(() => tui.removeChild(child), TypeError);
    f.registry.close("registered");
    assert.equal(disposed, 0);
    f.registry.close("registered");
    tui.clear();
    tui.renderNow();
    assert.equal(disposed, 1);
  } finally {
    await f.close();
  }
});

test("registered original wrappers own input, listener redirection, focus and cancellation", async () => {
  const f = await fixture();
  const { registry, api } = f;
  const first = new api.Input({ prompt: "Registered first" });
  const second = new api.Input({ prompt: "Registered second" });
  const calls: string[] = [];
  const wrapper = {
    child: second,
    render(width: number) {
      return second.render(width);
    },
    invalidate() {
      second.invalidate();
    },
    handleInput(data: string) {
      calls.push(data);
      second.handleInput(data);
    },
  };
  let tui!: DesktopTui;
  try {
    await registry.mount(
      (value: DesktopTui) => {
        tui = value;
        tui.addChild(first);
        tui.addChild(wrapper);
        tui.setFocus(second);
        return new f.Text("Hosted passive root");
      },
      "header",
      "registered",
    );
    const fields = nodes(f.surface().view).filter(
      (node): node is Extract<DesktopNode, { kind: "input" | "textarea" }> =>
        node.kind === "input",
    );
    assert.equal(fields.length, 2);
    assert.equal(f.surface().focusRequest?.action, fields[1].action);
    await registry.input("registered", "a");
    assert.equal(second.getValue(), "a");
    assert.deepEqual(calls, ["a"]);
    tui.addInputListener((data) => {
      if (data === "redirect") {
        tui.setFocus(first);
        return { data: "b" };
      }
    });
    await registry.input("registered", "redirect", undefined, undefined, {
      controlAction: fields[1].action,
    });
    assert.equal(first.getValue(), "b");
    assert.equal(second.getValue(), "a");
    tui.setFocus(second);
    registry.cancelInput(f.surface().id);
    assert.equal(calls.at(-1), "\x1b");
    tui.removeChild(wrapper);
    const after = f.surface();
    assert.equal(
      nodes(after.view).filter((node) => node.kind === "input").length,
      1,
    );
    assert.equal(componentFocus(tui), undefined);
    assert.equal(after.focusRequest, undefined);
    await assert.rejects(
      registry.action(f.surface().id, {
        action: fields[1].action,
        value: "retired",
      }),
      /unavailable|no longer active/,
    );
    assert.equal(second.getValue(), "a");
  } finally {
    await f.close();
  }
});

test("direct TUI children mutations retain shared original instances and dispose once", async () => {
  const f = await fixture();
  const shared = new f.api.Input();
  const root = new f.Container();
  const registered = new f.Container();
  const disposals: string[] = [];
  shared.dispose = () => {
    disposals.push("shared");
  };
  registered.dispose = () => {
    disposals.push("registered");
    shared.dispose?.();
  };
  root.dispose = () => {
    disposals.push("root");
    shared.dispose?.();
  };
  root.addChild(shared);
  registered.addChild(shared);
  let tui!: DesktopTui;
  try {
    await f.registry.mount(
      (value: DesktopTui) => {
        tui = value;
        tui.children.push(registered, registered);
        return root;
      },
      "header",
      "registered",
    );
    assert.equal(
      nodes(f.surface().view).filter((node) => node.kind === "input").length,
      3,
    );
    tui.children.splice(tui.children.indexOf(registered), 1);
    f.surface();
    assert.deepEqual(disposals, []);
    tui.children = tui.children.filter((child) => child !== registered);
    f.surface();
    assert.deepEqual(disposals, ["registered"]);
    assert.equal(shared.getValue(), "");
    const control = nodes(f.surface().view).find(
      (node) => node.kind === "input",
    )!;
    assert.equal(control.kind, "input");
    await f.registry.input("registered", "z", undefined, undefined, {
      controlAction: control.action,
    });
    assert.equal(shared.getValue(), "z");
    f.registry.close("registered");
    assert.deepEqual(disposals, ["registered", "root", "shared"]);
  } finally {
    await f.close();
  }
});

test("duplicate registered wrappers keep separate desktop occurrences with one original input owner", async () => {
  const f = await fixture();
  const field = new f.api.Input();
  const calls: string[] = [];
  let disposed = 0;
  const wrapper = {
    body: field,
    render: (width: number) => field.render(width),
    invalidate: () => field.invalidate(),
    handleInput(data: string) {
      calls.push(data);
      field.handleInput(data);
    },
    dispose() {
      disposed++;
    },
  };
  let tui!: DesktopTui;
  try {
    await f.registry.mount(
      (value: DesktopTui) => {
        tui = value;
        tui.addChild(wrapper);
        tui.addChild(wrapper);
        return new f.Text("Hosted root");
      },
      "header",
      "registered",
    );
    const fields = nodes(f.surface().view).filter(
      (node): node is Extract<DesktopNode, { kind: "input" | "textarea" }> =>
        node.kind === "input",
    );
    assert.equal(fields.length, 2);
    const occurrences = nodes(f.surface().view).flatMap((node) =>
      node.component && node.component.action === fields[0].action
        ? [node.component.occurrence]
        : [],
    );
    assert.equal(new Set(occurrences).size, 2);
    await f.registry.input(f.surface().id, "a", undefined, undefined, {
      controlAction: fields[1].action,
    });
    assert.equal(field.getValue(), "a");
    assert.deepEqual(calls, ["a"]);
    tui.removeChild(wrapper);
    assert.equal(
      nodes(f.surface().view).filter((node) => node.kind === "input").length,
      1,
    );
    assert.equal(disposed, 0);
    tui.clear();
    tui.renderNow();
    f.surface();
    assert.equal(disposed, 1);
  } finally {
    await f.close();
  }
});

test("paused global registrations resume with original state and release on generation close", async () => {
  const f = await fixture();
  const input = new f.api.Input();
  let calls = 0,
    disposed = 0;
  const render = input.render;
  input.render = function (width) {
    calls++;
    return render.call(this, width);
  };
  input.dispose = () => {
    disposed++;
  };
  let tui!: DesktopTui;
  try {
    await f.registry.mount(
      (value: DesktopTui) => {
        tui = value;
        tui.addChild(input);
        tui.setFocus(input);
        return new f.Text("Root");
      },
      "header",
      "registered",
    );
    tui.stop();
    const before = calls;
    input.setValue("Updated while paused");
    assert.equal(f.surface().view.inert, true);
    await f.registry.input("registered", "ignored");
    assert.equal(calls, before);
    assert.equal(input.getValue(), "Updated while paused");
    assert.equal(disposed, 0);
    tui.start();
    const node = nodes(f.surface().view).find((node) => node.kind === "input");
    assert.ok(node?.kind === "input");
    assert.equal(node.value, "Updated while paused");
    tui.stop();
    tui.clear();
    f.registry.close("registered");
    f.registry.clearSurfaces();
    assert.equal(disposed, 1);
  } finally {
    await f.close();
  }
});

test("global registrations render at application width independently of custom overlay bounds", async () => {
  const f = await fixture();
  const widths: number[] = [];
  const child = {
    render(width: number) {
      widths.push(width);
      return ["one", "two", "three"];
    },
    invalidate() {},
  };
  let tui!: DesktopTui;
  try {
    await f.registry.mount(
      (value: DesktopTui) => {
        tui = value;
        tui.addChild(child);
        return new f.Text("Root", 0, 0);
      },
      "dialog",
      "registered",
      undefined,
      { options: { overlay: true, overlayOptions: { width: 40 } } },
    );
    assert.equal(f.surface().overlay?.bounds?.height, 1);
    assert.ok(widths.includes(120));
    tui.clear();
    assert.equal(f.surface().overlay?.bounds?.height, 1);
    assert.equal(
      nodes(f.surface().view).some((node) => node.kind === "terminal"),
      false,
    );
  } finally {
    await f.close();
  }
});

test("registered terminal mouse metadata retains original coordinates, focus and input receiver", async () => {
  const f = await fixture();
  const events: { type: string; x: number; y: number }[] = [];
  const input: string[] = [];
  const child = {
    render: () => ["Registered mouse target"],
    invalidate() {},
    handleInput(data: string) {
      input.push(data);
    },
    handleMouse(event: { type: string; x: number; y: number }) {
      events.push(event);
      return { handled: true, focus: true };
    },
  };
  try {
    await f.registry.mount(
      (tui: DesktopTui) => {
        tui.addChild(child);
        return new f.Text("Root");
      },
      "header",
      "registered",
    );
    const terminal = nodes(f.surface().view).find(
      (node) => node.kind === "terminal",
    );
    assert.ok(terminal?.kind === "terminal");
    const identity = nodes(f.surface().view).find(
      (node) => node.component?.action === terminal.action,
    )?.component;
    assert.ok(identity);
    const result = await f.registry.mouse(f.surface().id, terminal.action, {
      pointerId: 1,
      type: "press",
      button: "left",
      x: 3,
      y: 0,
      screenX: 13,
      screenY: 5,
      width: terminal.cols,
      height: terminal.rows,
      shift: false,
      alt: false,
      ctrl: false,
      hitPath: [
        {
          action: terminal.action,
          occurrence: identity.occurrence,
          x: 3,
          y: 0,
          width: terminal.cols,
          height: terminal.rows,
        },
      ],
    });
    assert.equal(result.handled, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].x, 3);
    assert.equal(events[0].y, 0);
    await f.registry.input("registered", "mouse-focused");
    assert.deepEqual(input, ["mouse-focused"]);
  } finally {
    await f.close();
  }
});

for (const failure of [
  "factory",
  "removed",
  "cleared",
  "direct",
  "render",
  "render-added",
] as const) {
  test(`registered ownership survives ${failure} failure before mounting completes`, async () => {
    const f = await fixture();
    let disposed = 0,
      rootDisposed = 0;
    const child = new f.Text("Registered before failure");
    child.dispose = () => {
      disposed++;
    };
    try {
      await assert.rejects(
        f.registry.mount(
          (tui: DesktopTui) => {
            if (failure === "direct") tui.children.push(child);
            else tui.addChild(child);
            if (failure === "removed") tui.removeChild(child);
            if (failure === "cleared") tui.clear();
            if (failure === "render" || failure === "render-added") {
              if (failure === "render-added") tui.removeChild(child);
              return {
                render() {
                  if (failure === "render-added") tui.children.push(child);
                  throw new Error("Registration failure");
                },
                invalidate() {},
                dispose() {
                  rootDisposed++;
                },
              };
            }
            throw new Error("Registration failure");
          },
          "header",
          "registered",
        ),
        /Registration failure/,
      );
      f.registry.surfaces;
      assert.equal(disposed, ["removed", "cleared"].includes(failure) ? 1 : 0);
      assert.equal(rootDisposed, failure.startsWith("render") ? 1 : 0);
      assert.equal(f.owner(), undefined);
    } finally {
      await f.close();
    }
    assert.equal(disposed, 1);
  });
}

for (const outcome of ["resolve", "reject"] as const) {
  test(`retired async factory ${outcome} releases early and late registered trees once`, async () => {
    const f = await fixture();
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let early = 0,
      late = 0,
      hosted = 0;
    let tui!: DesktopTui;
    const initial = new f.Text("Early");
    const added = new f.Text("Late");
    const root = new f.Text("Hosted");
    initial.dispose = () => {
      early++;
    };
    added.dispose = () => {
      late++;
    };
    root.dispose = () => {
      hosted++;
    };
    try {
      const pending = f.registry.mount(
        async (value: DesktopTui) => {
          tui = value;
          tui.addChild(initial);
          entered();
          await gate;
          tui.children.push(added);
          if (outcome === "reject") throw new Error("Late failure");
          return root;
        },
        "header",
        "registered",
      );
      await ready;
      f.registry.close("registered");
      assert.equal(early, 0);
      finish();
      // The registry intentionally suppresses errors from a retired mount.
      await pending;
      assert.deepEqual(
        [early, late, hosted],
        [0, 0, outcome === "resolve" ? 1 : 0],
      );
      tui.addChild(added);
      tui.clear();
      tui.renderNow();
      assert.equal(late, 1);
      const final = new f.Text("After retirement");
      let finalDisposed = 0;
      final.dispose = () => {
        finalDisposed++;
      };
      tui.addChild(final);
      assert.equal(finalDisposed, 0);
      assert.equal(f.owner(), undefined);
      f.registry.clearSurfaces();
      assert.equal(finalDisposed, 1);
    } finally {
      finish?.();
      await f.close();
    }
  });
}
