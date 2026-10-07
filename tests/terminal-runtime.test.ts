import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import { createDetachedTui } from "../backend/detached-tui.ts";
import { componentFocus } from "../backend/component-runtime.ts";
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
async function fixture() {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  await host.initialize(files.cwd);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text");
  const Container = Reflect.get(api, "Container");
  async function mount(
    id: string,
    factory: (tui: DesktopTui) => unknown,
    slot: "header" | "footer" = "header",
  ) {
    let tui!: DesktopTui;
    await host.desktopUI.mount(
      (value: DesktopTui) => {
        tui = value;
        return factory(value);
      },
      slot,
      id,
    );
    return tui;
  }
  const surface = (id: string) =>
    host.desktopUI.surfaces.find((value) => value.id === id)!;
  const allText = () =>
    host.desktopUI.surfaces
      .flatMap((surface) => nodes(surface.view))
      .flatMap((node) => (node.kind === "text" ? [node.text] : []));
  return {
    host,
    api,
    Text,
    Container,
    mount,
    surface,
    allText,
    async close() {
      await host.dispose();
      await files.close();
    },
  };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("factories and retained callbacks share TUI and terminal identity with native reference semantics", async () => {
  const f = await fixture();
  try {
    const first = await f.mount("first", () => new f.Text("First"));
    const second = await f.mount(
      "second",
      () => new f.Text("Second"),
      "footer",
    );
    assert.equal(first, second);
    assert.equal(first.terminal, second.terminal);
    assert.ok(first instanceof f.api.TuiMainScreen);
    assert.equal(Object.getPrototypeOf(first), f.api.TuiMainScreen.prototype);
    const native = await createDetachedTui(() => {});
    const { createInteractiveTuiReference } = await import(
      pathToFileURL(
        join(getPackageDir(), "dist/modes/interactive/tui-renderer.js"),
      ).href
    );
    const reference = createInteractiveTuiReference(() => native);
    for (const tui of [first, reference]) {
      const before = [...tui.children];
      const borrowed = { children: [] };
      const child = new f.Text("Borrowed registration");
      const add = tui.addChild;
      assert.equal(add.call(borrowed, child), undefined);
      assert.deepEqual(borrowed.children, []);
      assert.deepEqual(tui.children, [...before, child]);
      const remove = tui.removeChild;
      remove(child);
      assert.deepEqual(tui.children, before);
    }
    f.host.desktopUI.close("first");
    first.terminal.setTitle("Retained shared TUI");
    assert.equal(
      f.host.snapshot().extensionUI.windowTitle,
      "Retained shared TUI",
    );
  } finally {
    await f.close();
  }
});

test("global focus redirects transformed input across factories once and preserves original receivers", async () => {
  const f = await fixture();
  try {
    const first = new f.api.Input({ prompt: "First" });
    const second = new f.api.Input({ prompt: "Second" });
    const tui = await f.mount("first", (value) => {
      value.setFocus(first);
      return first;
    });
    await f.mount("second", () => second, "footer");
    let hits = 0;
    const off = tui.addInputListener((data) => {
      hits++;
      if (data === "x") {
        tui.setFocus(second);
        return { data: "y" };
      }
    });
    const source = f.surface("first");
    const input = nodes(source.view).find((node) => node.kind === "input")!;
    assert.equal(input.kind, "input");
    const result = await f.host.desktopUI.input(
      "first",
      "x",
      undefined,
      undefined,
      {
        controlAction: input.action,
        controlText: "",
        selection: { start: 0, end: 0 },
      },
    );
    assert.equal(result.consume, true);
    assert.equal(hits, 1);
    assert.equal(first.getValue(), "");
    assert.equal(second.getValue(), "y");
    assert.equal(componentFocus(tui), second);
    assert.ok(f.surface("second").focusRequest?.action);
    off();
    await f.host.desktopUI.input("first", "z", undefined, undefined, {
      raw: true,
    });
    assert.equal(second.getValue(), "yz");
  } finally {
    await f.close();
  }
});

test("late desktop focus notifications cannot replace a newer explicit Pi focus", async () => {
  const f = await fixture();
  try {
    const first = new f.api.Input();
    const second = new f.api.Input();
    const tui = await f.mount("first", (value) => {
      value.setFocus(first);
      return first;
    });
    await f.mount("second", () => second, "footer");
    const version = f.surface("first").terminalFocusRevision!;
    tui.setFocus(second);
    f.host.desktopUI.focus("first", version);
    assert.equal(componentFocus(tui), second);
    f.host.desktopUI.focus("first", f.surface("first").terminalFocusRevision);
    assert.equal(componentFocus(tui), first);
  } finally {
    await f.close();
  }
});

for (const kind of ["custom", "direct"] as const) {
  test(`${kind} overlay DOM focus retains the leaf and supersedes old SDK requests`, async () => {
    const f = await fixture();
    let complete: ((value?: string) => void) | undefined;
    let result: Promise<string | undefined> | undefined;
    try {
      const tui = await f.mount("owner", () => new f.Text("Owner"));
      const root = new f.Container();
      const first = new f.api.Input({ prompt: "First" });
      const second = new f.api.Input({ prompt: "Second" });
      root.addChild(first);
      root.addChild(second);
      tui.setFocus(first);
      let handle: ReturnType<DesktopTui["showOverlay"]> | undefined;
      if (kind === "direct") {
        handle = tui.showOverlay(root, { nonCapturing: true });
      } else {
        result = f.host.desktopUI.custom<string>(
          (
            _tui: DesktopTui,
            _theme: unknown,
            _keys: unknown,
            done: (value?: string) => void,
          ) => {
            complete = done;
            return root;
          },
          {
            overlay: true,
            overlayOptions: { nonCapturing: true },
            onHandle: (value) => {
              handle = value;
            },
          },
        );
      }
      await until(
        () =>
          !!handle &&
          f.host.desktopUI.surfaces.some(
            (surface) =>
              surface.slot === "dialog" &&
              nodes(surface.view).some(
                (node) => node.kind === "input" && node.label === "Second",
              ),
          ),
      );
      const source = f.host.desktopUI.surfaces.find(
        (surface) => surface.slot === "dialog",
      )!;
      const secondNode = nodes(source.view).find(
        (node) => node.kind === "input" && node.label === "Second",
      )!;
      assert.equal(secondNode.kind, "input");
      const control = {
        action: secondNode.action,
        instanceId: source.instanceId,
      };
      const version = source.terminalFocusRevision!;
      f.host.desktopUI.focus(source.id, version, control);
      assert.equal(componentFocus(tui), second);
      assert.equal(f.surface(source.id).focusRequest, undefined);

      const browserVersion = f.surface(source.id).terminalFocusRevision!;
      tui.setFocus(first);
      f.host.desktopUI.focus(source.id, browserVersion, control);
      assert.equal(componentFocus(tui), first);
      const current = f.surface(source.id).terminalFocusRevision!;
      f.host.desktopUI.focus(source.id, current, {
        ...control,
        instanceId: "retired",
      });
      f.host.desktopUI.focus(source.id, current, {
        ...control,
        action: "component:999999",
      });
      assert.equal(componentFocus(tui), first);
      root.removeChild(second);
      tui.renderNow();
      f.host.desktopUI.focus(
        source.id,
        f.surface(source.id).terminalFocusRevision,
        control,
      );
      assert.equal(componentFocus(tui), first);
      handle!.focus();
      assert.equal(componentFocus(tui), root);
      complete?.("done");
      if (result) assert.equal(await result, "done");
      else handle!.hide();
    } finally {
      complete?.();
      await f.close();
    }
  });
}

test("retired factories can render and invalidate current peer components", async () => {
  const f = await fixture();
  let redraws = 0;
  try {
    const label = new f.Text("Old label");
    const render = label.render.bind(label);
    label.render = (width: number) => {
      redraws++;
      return render(width);
    };
    const tui = await f.mount("owner", () => new f.Text("Owner"));
    await f.mount("peer", () => label, "footer");
    f.host.desktopUI.close("owner");
    const before = redraws;
    label.setText("Updated through retained TUI");
    tui.renderNow();
    assert.ok(redraws > before);
    assert.ok(f.allText().includes("Updated through retained TUI"));
    let invalidations = 0;
    const invalidate = label.invalidate.bind(label);
    label.invalidate = () => {
      invalidations++;
      invalidate();
    };
    tui.invalidate();
    assert.equal(invalidations, 1);
    const request = tui.requestRender;
    request();
    await until(() => redraws > before + 1);
  } finally {
    await f.close();
  }
});

test("global stop and retained start pause all mapped regions and default editor without replacing instances", async () => {
  const f = await fixture();
  try {
    const input = new f.api.Input({ prompt: "Shared pause" });
    const tui = await f.mount("owner", (value) => {
      value.setFocus(input);
      return input;
    });
    await f.mount("peer", () => new f.Text("Peer"), "footer");
    const original = f.host.desktopUI.surfaces.map((surface) => [
      surface.id,
      surface.instanceId,
    ]);
    tui.stop();
    for (const surface of f.host.desktopUI.surfaces)
      assert.equal(surface.view.inert, true);
    assert.equal((await f.host.desktopUI.input("owner", "x")).consume, true);
    assert.equal((await f.host.desktopUI.input("editor", "x")).consume, true);
    assert.equal(input.getValue(), "");
    tui.start();
    assert.deepEqual(
      f.host.desktopUI.surfaces.map((surface) => [
        surface.id,
        surface.instanceId,
      ]),
      original,
    );
    await f.host.desktopUI.input("owner", "y", undefined, undefined, {
      raw: true,
    });
    assert.equal(input.getValue(), "y");
    f.host.desktopUI.close("owner");
    tui.stop();
    tui.start();
    assert.equal(f.surface("peer").view.inert, undefined);
  } finally {
    await f.close();
  }
});

test("global registered children retain order, duplicates and lifetime independently of their factory", async () => {
  const f = await fixture();
  const calls: string[] = [];
  try {
    const child = new f.Text("Shared registration");
    child.dispose = () => calls.push("child");
    const tui = await f.mount("owner", (value) => {
      value.addChild(child);
      value.addChild(child);
      return new f.Text("Owner");
    });
    tui.renderNow();
    assert.equal(
      f.allText().filter((value) => value === "Shared registration").length,
      2,
    );
    f.host.desktopUI.close("owner");
    assert.deepEqual(calls, []);
    assert.equal(
      f.allText().filter((value) => value === "Shared registration").length,
      2,
    );
    tui.removeChild(child);
    tui.renderNow();
    assert.equal(
      f.allText().filter((value) => value === "Shared registration").length,
      1,
    );
    assert.deepEqual(calls, []);
    tui.removeChild(child);
    tui.renderNow();
    assert.deepEqual(calls, ["child"]);
    assert.equal(
      f.allText().filter((value) => value === "Shared registration").length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("native application containers expose mapped originals and global clear removes their presentation", async () => {
  const f = await fixture();
  try {
    const header = new f.Text("Application header");
    const footer = new f.Text("Application footer");
    const tui = await f.mount("header", () => header);
    await f.mount("footer", () => footer, "footer");
    assert.ok(tui.render(80).join("\n").includes("Application header"));
    const document = tui.children[0];
    const container = Reflect.get(document, "children").find((child: object) =>
      Reflect.get(child, "children")?.includes(header),
    )!;
    assert.ok(container);
    Reflect.get(container, "removeChild").call(container, header);
    tui.renderNow();
    assert.ok(!f.allText().includes("Application header"));
    await f.mount("unrelated", () => new f.Text("Unrelated"), "footer");
    assert.ok(!f.allText().includes("Application header"));
    tui.clear();
    tui.renderNow();
    assert.ok(!f.allText().includes("Application footer"));
    assert.deepEqual(tui.render(80), []);
  } finally {
    await f.close();
  }
});

test("direct overlays share native stack and survive their creating factory", async () => {
  const f = await fixture();
  try {
    const base = new f.api.Input({ prompt: "Base" });
    const tui = await f.mount("owner", (value) => {
      value.setFocus(base);
      return base;
    });
    const peer = await f.mount("peer", () => new f.Text("Peer"), "footer");
    const first = new f.api.Input({ prompt: "First overlay" });
    const second = new f.api.Input({ prompt: "Second overlay" });
    const one = tui.showOverlay(first, { width: 40 });
    const two = peer.showOverlay(second, { width: 30 });
    await until(
      () =>
        f.host.desktopUI.surfaces.filter((surface) => surface.slot === "dialog")
          .length === 2,
    );
    assert.equal(one.isFocused(), false);
    assert.equal(two.isFocused(), true);
    assert.equal(tui.hasOverlay(), true);
    assert.equal(componentFocus(tui), second);
    f.host.desktopUI.close("owner");
    assert.equal(two.isFocused(), true);
    assert.equal(
      f.host.desktopUI.surfaces.filter((surface) => surface.slot === "dialog")
        .length,
      2,
    );
    peer.hideOverlay();
    assert.equal(two.isFocused(), false);
    assert.equal(one.isFocused(), true);
    assert.equal(
      f.host.desktopUI.surfaces.filter((surface) => surface.slot === "dialog")
        .length,
      1,
    );
    one.setHidden(true);
    assert.equal(one.isHidden(), true);
    one.setHidden(false);
    assert.equal(one.isFocused(), true);
    one.hide();
    assert.equal(tui.hasOverlay(), false);
  } finally {
    await f.close();
  }
});

test("custom and direct overlays use one native focus stack and preserve original custom results", async () => {
  const f = await fixture();
  try {
    const tui = await f.mount("owner", () => new f.Text("Owner"));
    let complete!: (value?: string) => void;
    let custom!: ReturnType<DesktopTui["showOverlay"]>;
    const result = f.host.desktopUI.custom(
      (
        _tui: DesktopTui,
        _theme: unknown,
        _keys: unknown,
        done: typeof complete,
      ) => {
        assert.equal(_tui, tui);
        complete = done;
        return new f.Text("Custom overlay");
      },
      {
        overlay: true,
        onHandle: (value) => {
          custom = value;
        },
      },
    );
    await until(() => !!custom);
    assert.equal(tui.hasOverlay(), true);
    const direct = tui.showOverlay(new f.Text("Direct overlay"));
    await until(
      () =>
        f.host.desktopUI.surfaces.filter((surface) => surface.slot === "dialog")
          .length === 2,
    );
    assert.equal(custom.isFocused(), false);
    assert.equal(direct.isFocused(), true);
    tui.hideOverlay();
    assert.equal(custom.isFocused(), true);
    complete("original result");
    assert.equal(await result, "original result");
    assert.equal(tui.hasOverlay(), false);
  } finally {
    await f.close();
  }
});

test("external focused receivers get native release filtering and old generation handles cannot change successors", async () => {
  const f = await fixture();
  try {
    const tui = await f.mount("owner", () => new f.Text("Owner"));
    const received: string[] = [];
    const target = {
      render: () => [],
      invalidate() {},
      handleInput(data: string) {
        assert.equal(this, target);
        received.push(data);
      },
      wantsKeyRelease: false,
    };
    tui.setFocus(target);
    await f.host.desktopUI.input("owner", "\x1b[120;1:3u");
    assert.deepEqual(received, []);
    target.wantsKeyRelease = true;
    await f.host.desktopUI.input("owner", "\x1b[120;1:3u");
    assert.deepEqual(received, ["\x1b[120;1:3u"]);
    f.host.desktopUI.clearSurfaces();
    const next = await f.mount("next", () => new f.Text("Next"));
    assert.notEqual(next, tui);
    const previous = componentFocus(next);
    tui.setFocus(target);
    tui.stop();
    tui.addChild(new f.Text("Retired child"));
    assert.equal(componentFocus(next), previous);
    assert.equal(f.surface("next").view.inert, undefined);
    assert.ok(!f.allText().includes("Retired child"));
  } finally {
    await f.close();
  }
});
