import test from "node:test";
import assert from "node:assert/strict";
import {
  InteractiveMode,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";

type Factory = Parameters<ExtensionUIContext["custom"]>[0];

async function closeTrace(
  open: (factory: Factory) => Promise<unknown>,
  mounted: () => boolean,
  terminal: boolean,
  depth: number,
  wrapped = false,
) {
  const api = await loadTuiApi();
  const events: string[] = [];
  let close!: (value: unknown) => void;
  let cleanup = Promise.resolve();
  let stage = 0;
  const present = wrapped
    ? async (factory: Factory) => {
        try {
          return await open(factory);
        } finally {
          /* Same subscription helper as the browser fixture. */
        }
      }
    : open;
  const pending = present((_tui, _theme, _keys, done) => {
    close = done;
    const component: Awaited<ReturnType<Factory>> = terminal
      ? {
          render: () => ["Original terminal frame"],
          handleInput() {},
          invalidate() {},
        }
      : new (Reflect.get(api, "Input"))();
    component.dispose = () => {
      events.push("dispose");
      if (depth < 0) throw new Error("Original cleanup failure");
      for (let index = 1; index <= depth; index++)
        cleanup = cleanup.then(() => {
          stage = index;
          events.push(`cleanup:${index}`);
        });
      return cleanup;
    };
    return component;
  }).then((value) => {
    assert.equal(value, "original-result");
    events.push(`result:${stage}`);
  });
  for (let attempt = 0; !mounted(); attempt++) {
    assert.ok(attempt < 100, "Original component must mount");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  close("original-result");
  events.push("done-return");
  await pending;
  await cleanup;
  return events;
}

async function originalTrace(
  runner: object,
  terminal: boolean,
  depth: number,
  overlay: boolean,
  wrapped = false,
) {
  let mounted = false;
  const mode = {
    editor: { getText: () => "draft", setText() {} },
    editorContainer: {
      clear() {},
      addChild() {
        mounted = true;
      },
    },
    disposeActiveSelector() {},
    ui: {
      setFocus() {},
      requestRender() {},
      hideOverlay() {},
      showOverlay() {
        mounted = true;
        return {};
      },
    },
  };
  const show = Reflect.get(InteractiveMode.prototype, "showExtensionCustom");
  const wrap = Reflect.get(runner, "wrapUIPromptContext");
  const ui = wrap.call(runner, {
    custom: (factory: Factory) => show.call(mode, factory, { overlay }),
  });
  return closeTrace(
    (factory) => ui.custom(factory),
    () => mounted,
    terminal,
    depth,
    wrapped,
  );
}

test("public custom UI close preserves Pi result and asynchronous cleanup ordering", async (t) => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    for (const terminal of [false, true])
      for (const overlay of [false, true])
        for (const [depth, wrapped] of [
          ...[-1, 0, 1, 2, 5, 8, 32].map((depth) => [depth, false] as const),
          [8, true] as const,
        ])
          await t.test(
            `${terminal ? "xterm" : "native"} ${overlay ? "overlay" : "dialog"} cleanup depth ${depth}${wrapped ? " with presentation helper" : ""}`,
            async () => {
              const expected = await originalTrace(
                host.session.extensionRunner,
                terminal,
                depth,
                overlay,
                wrapped,
              );
              const ui = host.session.extensionRunner.getUIContext();
              const actual = await closeTrace(
                (factory) => ui.custom(factory, { overlay }),
                () =>
                  host.desktopUI.surfaces.some(
                    (surface) => surface.slot === "dialog",
                  ),
                terminal,
                depth,
                wrapped,
              );
              assert.deepEqual(actual, expected);
            },
          );
    for (const asynchronous of [false, true])
      await t.test(
        asynchronous ? "factory rejection" : "factory throw",
        async () => {
          const failure = new Error("Original factory failure");
          const ui = host.session.extensionRunner.getUIContext();
          await assert.rejects(
            ui.custom(() => {
              if (asynchronous) return Promise.reject(failure);
              throw failure;
            }),
            (error) => error === failure,
          );
          assert.equal(
            host.desktopUI.surfaces.some(
              (surface) => surface.slot === "dialog",
            ),
            false,
          );
          assert.equal(
            Reflect.get(host.session.extensionRunner, "uiPromptDepth"),
            0,
          );
        },
      );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("a throwing desktop close callback still aborts, disposes and publishes removal", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const events: string[] = [];
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => events.push("changed"),
  );
  const failure = new Error("Original close failure");
  registry.registerAdapter({
    id: "close-callback-probe",
    matches: () => true,
    create: ({ signal }) => {
      signal.addEventListener("abort", () => events.push("abort"));
      return {
        view: () => ({ kind: "text", text: "Original close callback" }),
        handleAction() {},
        dispose() {
          events.push("dispose");
        },
      };
    },
  });
  try {
    await host.initialize(fixture.cwd);
    await registry.mount(undefined, "dialog", "close-callback", () => {
      events.push("done");
      throw failure;
    });
    events.length = 0;
    assert.throws(
      () => registry.close("close-callback"),
      (error) => error === failure,
    );
    assert.deepEqual(events, ["done", "abort", "dispose", "changed"]);
    assert.equal(registry.surfaces.length, 0);
    registry.close("close-callback");
    assert.equal(events.length, 4);
  } finally {
    registry.dispose();
    await host.dispose();
    await fixture.close();
  }
});
