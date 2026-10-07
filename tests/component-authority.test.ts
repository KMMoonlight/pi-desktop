import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadComponentRuntime } from "../backend/component-runtime.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import type { DesktopNode, DesktopMouseEvent } from "../shared/desktop-ui.ts";
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
function textControl(
  node: DesktopNode,
): Extract<DesktopNode, { kind: "input" | "textarea" }> {
  const control = nodes(node).find(
    (child) => child.kind === "input" || child.kind === "textarea",
  );
  assert.ok(
    control && (control.kind === "input" || control.kind === "textarea"),
  );
  return control;
}

test("versioned browser input preserves original SDK text and caret changes", async (t) => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  const api = await loadTuiApi();
  const runtime = await loadComponentRuntime();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  try {
    await host.initialize(setup.cwd);
    for (const kind of ["Input", "Editor", "CustomEditor"])
      for (const hooks of [false, true])
        await t.test(`${kind}, input listeners ${hooks}`, async () => {
          const Base =
            Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
          const calls: string[] = [];
          const observed: string[] = [];
          class OriginalControl extends Base {
            constructor(...args: unknown[]) {
              super(...args);
            }
            handleInput(data: string) {
              calls.push(data);
              if (data === "mutateThrow") {
                write("SDK failed callback");
                super.handleInput("\x1b[F");
                throw new Error("Original input failed after mutation");
              }
              if (data === "throw") throw new Error("Original input failed");
              super.handleInput(data);
            }
          }
          let original!: OriginalControl;
          const read = () => original.getText?.() ?? original.getValue();
          const write = (text: string) =>
            original.setText ? original.setText(text) : original.setValue(text);
          try {
            await registry.mount(
              (tui: DesktopTui) => {
                original = new OriginalControl(
                  ...(kind === "Input"
                    ? []
                    : [
                        tui,
                        {
                          borderColor: (text: string) => text,
                          selectList: host.sdk.sdk.getSelectListTheme(),
                        },
                        ...(kind === "CustomEditor"
                          ? [
                              runtime.keys.KeybindingsManager.create(
                                setup.agentDir,
                              ),
                            ]
                          : []),
                      ]),
                );
                write("browser");
                original.handleInput("\x1b[F");
                if (hooks)
                  tui.addInputListener(() => {
                    observed.push(read());
                    return undefined;
                  });
                return original;
              },
              "dialog",
              "authority",
            );
            const view = () => textControl(registry.surfaces[0].view);
            const before = view();
            write("SDK value");
            original.handleInput("\x1b[F");
            calls.length = 0;
            const edited = await registry.input(
              "authority",
              "!",
              undefined,
              { start: 1, end: 3 },
              {
                controlAction: before.action,
                controlText: before.value,
                controlVersion: before.controlVersion ?? 0,
                selection: { start: 1, end: 3 },
              },
            );
            assert.equal(read(), "SDK value!");
            assert.equal(edited.editor?.text, "SDK value!");
            assert.deepEqual(calls, ["!"]);
            if (hooks) assert.equal(observed.at(-1), "SDK value");

            write("abcdef");
            original.handleInput("\x1b[F");
            const caretBefore = view();
            original.handleInput("\x1b[D");
            original.handleInput("\x1b[D");
            original.handleInput("\x1b[D");
            await registry.input(
              "authority",
              "!",
              undefined,
              { start: 2, end: 5 },
              {
                controlAction: caretBefore.action,
                controlText: "abcdef",
                controlVersion: caretBefore.controlVersion ?? 0,
                selection: { start: 2, end: 5 },
              },
            );
            assert.equal(read(), "abc!def");

            const current = view();
            const version = current.controlVersion;
            assert.ok(version !== undefined);
            for (const data of ["x", "y"])
              await registry.input("authority", data, undefined, undefined, {
                controlAction: current.action,
                controlText: read(),
                controlVersion: version,
                selection: view().selection,
              });
            assert.equal(read(), "abc!xydef");
            assert.equal(view().controlVersion, version);

            write("abcdef");
            original.handleInput("\x1b[F");
            const selectedBefore = view();
            for (let i = 0; i < 3; i++) original.handleInput("\x1b[D");
            await registry.action("authority", {
              action: selectedBefore.selectionAction!,
              value: {
                start: 0,
                end: 2,
                text: "abcdef",
                controlVersion: selectedBefore.controlVersion,
              },
            });
            assert.deepEqual(
              view().selection && {
                start: view().selection!.start,
                end: view().selection!.end,
              },
              { start: 3, end: 3 },
            );

            const replacedBefore = view();
            write("SDK replacement");
            original.handleInput("\x1b[F");
            await registry.action("authority", {
              action: replacedBefore.action,
              value: {
                text: "obsolete browser replacement",
                controlVersion: replacedBefore.controlVersion,
              },
            });
            assert.equal(read(), "SDK replacement");
            const native = await registry.input(
              "authority",
              "\x01",
              undefined,
              undefined,
              {
                controlAction: replacedBefore.action,
                controlText: "abcdef",
                controlVersion: replacedBefore.controlVersion,
                selection: { start: 0, end: 2 },
              },
            );
            assert.equal(native.consume, false);
            assert.equal(native.editor?.text, "SDK replacement");

            const failedBefore = view();
            await assert.rejects(
              registry.input("authority", "mutateThrow", undefined, undefined, {
                controlAction: failedBefore.action,
                controlVersion: failedBefore.controlVersion,
              }),
              /Original input failed after mutation/,
            );
            await registry.input("authority", "!", undefined, undefined, {
              controlAction: failedBefore.action,
              controlText: failedBefore.value,
              controlVersion: failedBefore.controlVersion,
              selection: failedBefore.selection,
            });
            assert.equal(read(), "SDK failed callback!");

            await assert.rejects(
              registry.input("authority", "throw", undefined, undefined, {
                controlAction: current.action,
                controlVersion: version,
              }),
              /Original input failed/,
            );
            write("SDK after exception");
            original.handleInput("\x1b[F");
            await registry.input("authority", "!", undefined, undefined, {
              controlAction: current.action,
              controlText: "abc!xydef",
              controlVersion: version,
              selection: { start: 0, end: 3 },
            });
            assert.equal(read(), "SDK after exception!");
            assert.equal(
              original.handleInput,
              OriginalControl.prototype.handleInput,
            );
          } finally {
            registry.clearSurfaces();
          }
        });
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});

test("a desktop callback retires sibling context and failed source context", async (t) => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  const api = await loadTuiApi();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  try {
    await host.initialize(setup.cwd);
    for (const mode of ["keyboard", "action", "mouse"] as const)
      for (const fail of [false, true])
        await t.test(`${mode}, failed callback ${fail}`, async () => {
          const sibling = new api.Input();
          sibling.setValue("browser sibling");
          sibling.handleInput("\x1b[F");
          const mutate = () => {
            source.setValue("SDK source");
            source.handleInput("\x1b[F");
            sibling.setValue("SDK sibling");
            sibling.handleInput("\x1b[F");
            if (fail) throw new Error("Original callback failed");
          };
          class Source extends api.Input {
            handleInput(data: string) {
              if (data === "mutate" || data === "\r") mutate();
              else super.handleInput(data);
            }
            handleMouse() {
              mutate();
              return { handled: true, render: false };
            }
          }
          const source = new Source();
          source.onSubmit = () => {};
          source.setValue("browser source");
          source.handleInput("\x1b[F");
          try {
            await registry.mount(
              (tui: DesktopTui) => {
                const root = new (Reflect.get(api, "Container"))();
                root.addChild(source);
                root.addChild(sibling);
                tui.setFocus(source);
                return root;
              },
              "dialog",
              "siblings",
            );
            const before = nodes(registry.surfaces[0].view).filter(
              (
                node,
              ): node is Extract<DesktopNode, { kind: "input" | "textarea" }> =>
                node.kind === "input",
            );
            assert.equal(before.length, 2);
            const [first, second] = before;
            const context = (node: typeof first) => ({
              controlAction: node.action,
              controlText: node.value,
              controlVersion: node.controlVersion,
              selection: node.selection,
            });
            const event: DesktopMouseEvent = {
              pointerId: 1,
              type: "press",
              button: "left",
              x: 0,
              y: 0,
              screenX: 0,
              screenY: 0,
              width: 80,
              height: 1,
              shift: false,
              alt: false,
              ctrl: false,
              nativeControl: {
                action: first.action,
                kind: "input",
                text: first.value,
                selection: first.selection,
              },
            };
            const operation = () =>
              mode === "keyboard"
                ? registry.input(
                    "siblings",
                    "mutate",
                    undefined,
                    undefined,
                    context(first),
                  )
                : mode === "action"
                  ? registry.action("siblings", {
                      action: `${first.action}:submit`,
                    })
                  : registry.mouse("siblings", first.action, event);
            if (fail)
              await assert.rejects(operation(), /Original callback failed/);
            else await operation();
            await registry.input(
              "siblings",
              "!",
              undefined,
              undefined,
              context(second),
            );
            assert.equal(sibling.getValue(), "SDK sibling!");
            const after = nodes(registry.surfaces[0].view).filter(
              (
                node,
              ): node is Extract<DesktopNode, { kind: "input" | "textarea" }> =>
                node.kind === "input",
            );
            assert.notEqual(after[1].controlVersion, second.controlVersion);
            if (fail) {
              assert.notEqual(after[0].controlVersion, first.controlVersion);
              await registry.input(
                "siblings",
                "!",
                undefined,
                undefined,
                context(first),
              );
              assert.equal(source.getValue(), "SDK source!");
            } else assert.equal(after[0].controlVersion, first.controlVersion);
          } finally {
            registry.clearSurfaces();
          }
        });
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});
