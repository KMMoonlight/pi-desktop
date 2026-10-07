import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import {
  componentFocus,
  type PiComponent,
} from "../backend/component-runtime.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import { createFixture } from "./fixture.ts";

function terminal(
  node: DesktopNode,
): Extract<DesktopNode, { kind: "terminal" }> | undefined {
  if (node.kind === "terminal") return node;
  if (node.kind === "region") return terminal(node.child);
  if ("children" in node) return node.children.map(terminal).find(Boolean);
}

test("desktop and opaque presentation transitions retain a privately held focused Pi instance", async (t) => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const identity = (text: string) => text;
  const theme = {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
    label: identity,
    value: identity,
    cursor: "> ",
    hint: identity,
  };
  try {
    await host.initialize(fixture.cwd);
    for (const holder of ["closure", "weakmap", "private"])
      for (const kind of [
        "Input",
        "Editor",
        "CustomEditor",
        "SelectList",
        "SettingsList",
      ])
        await t.test(`${holder}/${kind}`, async () => {
          let tui!: DesktopTui,
            field!: PiComponent,
            opaque = false,
            disposed = 0;
          const submitted: string[] = [],
            calls: string[] = [];
          const editing = ["Input", "Editor", "CustomEditor"].includes(kind);
          await registry.mount(
            (screen: DesktopTui, _theme: unknown, keys: unknown) => {
              tui = screen;
              const Base =
                Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
              field =
                kind === "Input"
                  ? new Base({ prompt: "Transition field" })
                  : kind === "SelectList"
                    ? new Base(
                        [
                          { value: "alpha", label: "Alpha" },
                          { value: "beta", label: "Beta" },
                        ],
                        3,
                        theme,
                      )
                    : kind === "SettingsList"
                      ? new Base(
                          [
                            {
                              id: "alpha",
                              label: "Alpha",
                              currentValue: "off",
                              values: ["off", "on"],
                            },
                            {
                              id: "beta",
                              label: "Beta",
                              currentValue: "off",
                              values: ["off", "on"],
                            },
                          ],
                          3,
                          theme,
                          (id: string, value: string) =>
                            submitted.push(`${id}:${value}`),
                          () => {},
                        )
                      : new Base(
                          tui,
                          { borderColor: identity, selectList: theme },
                          ...(kind === "CustomEditor" ? [keys] : []),
                        );
              if (editing) {
                (
                  Reflect.get(field, "setText") ??
                  Reflect.get(field, "setValue")
                ).call(field, "one");
                field.handleInput!("\x05");
                Reflect.set(field, "onSubmit", (text: string) =>
                  submitted.push(text),
                );
              } else if (kind === "SelectList") {
                Reflect.set(field, "onSelect", (item: { value: string }) =>
                  submitted.push(item.value),
                );
              }
              const original = field.handleInput!.bind(field);
              field.handleInput = (data: string) => {
                calls.push(data);
                original(data);
              };
              Reflect.set(field, "dispose", () => disposed++);
              const hidden = new WeakMap<object, PiComponent>();
              class Wrapper {
                field?: PiComponent = field;
                #field = field;
                constructor() {
                  hidden.set(this, field);
                }
                child() {
                  return holder === "closure"
                    ? field
                    : holder === "weakmap"
                      ? hidden.get(this)!
                      : this.#field;
                }
                render(width: number) {
                  return this.child().render(opaque ? width - 4 : width);
                }
                invalidate() {
                  this.child().invalidate();
                }
                dispose() {
                  Reflect.get(this.child(), "dispose").call(this.child());
                }
              }
              const wrapper = new Wrapper();
              tui.addInputListener((data) => {
                if (data === "opaque" || data === "desktop") {
                  opaque = data === "opaque";
                  if (opaque) delete wrapper.field;
                  else wrapper.field = field;
                  return { consume: true };
                }
              });
              tui.setFocus(field);
              return wrapper;
            },
            "dialog",
            "terminal-transition",
          );
          try {
            assert.equal(terminal(registry.surfaces[0].view), undefined);
            assert.equal(componentFocus(tui), field);
            for (let round = 0; round < 2; round++) {
              await registry.input("terminal-transition", "opaque");
              const frame = terminal(registry.surfaces[0].view)!;
              assert.ok(frame, "changed-width private drawing uses xterm");
              assert.equal(
                componentFocus(tui),
                field,
                "switching presentation must retain original focus",
              );
              assert.equal(
                disposed,
                0,
                "a component still held and rendered by the extension must remain alive",
              );
              assert.equal(
                registry.surfaces[0].focusRequest?.action,
                frame.action,
              );
              await registry.action("terminal-transition", {
                action: frame.action,
                value: { data: editing ? "x" : "\x1b[B" },
              });
              assert.equal(calls.at(-1), editing ? "x" : "\x1b[B");
              await registry.action("terminal-transition", {
                action: frame.action,
                value: { data: "\r" },
              });
              assert.deepEqual(
                submitted,
                Array.from({ length: round + 1 }, (_, index) =>
                  editing
                    ? index
                      ? "SDK update 0x"
                      : "onex"
                    : kind === "SelectList"
                      ? "beta"
                      : "beta:on",
                ),
              );
              if (editing) {
                (
                  Reflect.get(field, "setText") ??
                  Reflect.get(field, "setValue")
                ).call(field, `SDK update ${round}`);
                await registry.action("terminal-transition", {
                  action: frame.action,
                  value: { data: "\x05" },
                });
              } else if (kind === "SelectList")
                Reflect.get(field, "setSelectedIndex").call(field, 0);
              else {
                Reflect.get(field, "selectItem").call(field, "alpha");
                Reflect.get(field, "updateValue").call(field, "beta", "off");
              }
              await registry.input("terminal-transition", "desktop");
              assert.equal(terminal(registry.surfaces[0].view), undefined);
              assert.equal(componentFocus(tui), field);
              assert.equal(disposed, 0);
              if (editing)
                assert.equal(
                  (
                    Reflect.get(field, "getText") ??
                    Reflect.get(field, "getValue")
                  ).call(field),
                  `SDK update ${round}`,
                );
            }
          } finally {
            registry.clearSurfaces();
          }
          assert.equal(disposed, 1);
        });
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await fixture.close();
  }
});
