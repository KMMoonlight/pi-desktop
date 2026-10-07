import test from "node:test";
import assert from "node:assert/strict";
import {
  InteractiveMode,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";

type Factory = Parameters<ExtensionUIContext["custom"]>[0];
type Options = NonNullable<Parameters<ExtensionUIContext["custom"]>[1]>;
type Handle = ReturnType<DesktopTui["showOverlay"]>;

async function originalTui() {
  const api = await loadTuiApi();
  return new api.TuiMainScreen({
    columns: 120,
    rows: 40,
    kittyProtocolActive: false,
    start() {},
    stop() {},
    async drainInput() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
  });
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; !predicate(); attempt++) {
    assert.ok(attempt < 100, "Original overlay must mount");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function customTrace(
  open: (factory: Factory, options: Options) => Promise<unknown>,
  visible: () => boolean,
  terminal: boolean,
  operation: "remove" | "toggle" | "invisible" | "non-capturing",
) {
  const api = await loadTuiApi();
  let handle: Handle | undefined;
  let done!: (value: unknown) => void;
  let settled = false;
  let disposed = 0;
  const pending = open(
    (_tui, _theme, _keys, close) => {
      done = close;
      const component: Awaited<ReturnType<Factory>> = terminal
        ? {
            render: () => ["Original opaque overlay"],
            handleInput() {},
            invalidate() {},
          }
        : new api.Input({ prompt: "Original native overlay" });
      component.dispose = () => disposed++;
      return component;
    },
    {
      overlay: true,
      overlayOptions: {
        visible: () => operation !== "invisible",
        nonCapturing: operation === "non-capturing",
      },
      onHandle: (value) => {
        handle = value;
      },
    },
  ).then((value) => {
    settled = true;
    return value;
  });
  const states: object[] = [];
  const observe = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    states.push({
      visible: visible(),
      settled,
      disposed,
      hidden: handle!.isHidden(),
      focused: handle!.isFocused(),
    });
  };
  try {
    await until(() => !!handle);
    await observe();
    if (operation === "remove") {
      handle!.hide();
      await observe();
      handle!.hide();
      handle!.focus();
      await observe();
    } else {
      handle!.setHidden(true);
      handle!.focus();
      await observe();
      handle!.setHidden(false);
      await observe();
    }
    done("original-result");
    const result = await pending;
    await observe();
    return { result, states };
  } finally {
    done?.("cleanup-result");
    await pending;
  }
}

async function originalCustomTrace(
  runner: object,
  terminal: boolean,
  operation: Parameters<typeof customTrace>[3],
) {
  const tui = await originalTui();
  const api = await loadTuiApi();
  const editor = new api.Input();
  tui.addChild(editor);
  tui.setFocus(editor);
  const mode = { ui: tui, editor: { getText: () => "draft" } };
  const show = Reflect.get(InteractiveMode.prototype, "showExtensionCustom");
  const wrap = Reflect.get(runner, "wrapUIPromptContext");
  const ui = wrap.call(runner, {
    custom: (factory: Factory, options: Options) =>
      show.call(mode, factory, options),
  });
  try {
    return await customTrace(
      (factory, options) => ui.custom(factory, options),
      () => tui.hasOverlay(),
      terminal,
      operation,
    );
  } finally {
    tui.stop();
  }
}

test("public overlay handles preserve original Pi visibility, result and component lifetime", async (t) => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    for (const terminal of [false, true])
      for (const operation of [
        "remove",
        "toggle",
        "invisible",
        "non-capturing",
      ] as const)
        await t.test(
          `${terminal ? "xterm" : "native"} ${operation}`,
          async () => {
            const expected = await originalCustomTrace(
              host.session.extensionRunner,
              terminal,
              operation,
            );
            const ui = host.session.extensionRunner.getUIContext();
            const actual = await customTrace(
              (factory, options) => ui.custom(factory, options),
              () =>
                host.desktopUI.surfaces.some(
                  (surface) => surface.overlay && !surface.overlay.hidden,
                ),
              terminal,
              operation,
            );
            assert.deepEqual(actual, expected);
          },
        );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("direct overlay removal preserves original component until shared generation teardown", async (t) => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    for (const terminal of [false, true])
      for (const method of ["handle", "stack"])
        await t.test(`${terminal ? "xterm" : "native"} ${method}`, async () => {
          const api = await loadTuiApi();
          const reference = await originalTui();
          const registry = new DesktopUIRegistry(
            () => host.sdk,
            () => {},
          );
          registerComponentMappings(registry);
          const run = async (
            tui: DesktopTui,
            refresh: () => void | Promise<void>,
          ) => {
            let disposed = 0;
            const overlay = terminal
              ? {
                  render: () => ["Original direct opaque overlay"],
                  invalidate() {},
                  dispose() {
                    disposed++;
                  },
                }
              : new api.Input({ prompt: "Original direct native overlay" });
            overlay.dispose = () => {
              disposed++;
            };
            const handle = tui.showOverlay(overlay);
            await refresh();
            const before = { disposed, visible: tui.hasOverlay() };
            if (method === "handle") handle.hide();
            else tui.hideOverlay();
            await refresh();
            const after = { disposed, visible: tui.hasOverlay() };
            return { before, after, disposed: () => disposed };
          };
          try {
            let desktopTui!: DesktopTui;
            await registry.mount(
              (instance: DesktopTui) => {
                desktopTui = instance;
                return new api.Input();
              },
              "dialog",
              "direct-parent",
            );
            const expected = await run(reference, () => reference.renderNow());
            let mounted = false;
            const actual = await run(desktopTui, async () => {
              if (!mounted) {
                const deadline = Date.now() + 10000;
                while (!registry.surfaces.some((surface) => surface.overlay)) {
                  assert.ok(Date.now() < deadline);
                  await new Promise((resolve) => setTimeout(resolve, 10));
                }
                mounted = true;
              } else void registry.surfaces;
            });
            assert.deepEqual(
              { before: actual.before, after: actual.after },
              { before: expected.before, after: expected.after },
            );
            registry.close("direct-parent");
            assert.equal(actual.disposed(), 0);
            assert.deepEqual(registry.surfaces, []);
            registry.dispose();
            assert.equal(actual.disposed(), 1);
          } finally {
            registry.dispose();
            reference.stop();
          }
        });
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("removed overlays reject queued input, actions and stale measurements without completing their result", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  let handle!: Handle;
  let resume!: () => void;
  let entered = false;
  let completed = false;
  let disposed = 0;
  const events: string[] = [];
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  try {
    await host.initialize(fixture.cwd);
    await registry.mount(
      undefined,
      "dialog",
      "queued-overlay",
      () => {
        completed = true;
      },
      {
        component: {
          view: () => ({
            kind: "input",
            action: "edit",
            label: "Queued original input",
            value: "",
          }),
          async handleInput(data) {
            events.push(data);
            entered = true;
            await gate;
            return { consume: true };
          },
          handleAction() {
            events.push("action");
          },
          dispose() {
            disposed++;
          },
        },
        options: {
          overlay: true,
          onHandle: (value) => {
            handle = value;
          },
        },
      },
    );
    const surface = registry.surfaces[0];
    const first = registry.input(surface.id, "accepted-before-removal");
    await until(() => entered);
    const lateInput = registry.input(surface.id, "queued-before-removal");
    const lateAction = registry.action(surface.id, {
      action: "edit",
      value: "late",
    });
    handle.hide();
    resume();
    await Promise.all([first, lateInput, lateAction]);
    assert.deepEqual(events, ["accepted-before-removal"]);
    assert.equal(completed, false);
    assert.equal(disposed, 0);
    assert.equal(handle.getBounds(), undefined);
    assert.equal(
      registry.measureOverlay(
        surface.id,
        surface.instanceId,
        surface.overlay!.layoutKey!,
        2,
      ),
      false,
    );
    await assert.rejects(
      registry.action(surface.id, { action: "edit", value: "after-removal" }),
      /hidden/,
    );
    await registry.input(surface.id, "after-removal");
    assert.deepEqual(events, ["accepted-before-removal"]);
    registry.close(surface.id);
    assert.equal(completed, true);
    assert.equal(disposed, 1);
  } finally {
    resume();
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});
