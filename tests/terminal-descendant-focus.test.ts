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

test("opaque terminal frames retain original descendant focus and keyboard semantics", async (t) => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const identity = (value: string) => value;
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
    for (const mode of ["multiple", "width", "locked", "closure"])
      for (const kind of [
        "Input",
        "Editor",
        "CustomEditor",
        "SelectList",
        "SettingsList",
      ])
        await t.test(`${mode}/${kind}`, async () => {
          let tui!: DesktopTui,
            active = 0;
          const fields: PiComponent[] = [],
            disposed = [0, 0];
          const calls: string[] = [],
            submitted: string[] = [];
          const editing = ["Input", "Editor", "CustomEditor"].includes(kind);
          const value = (field: PiComponent) =>
            (
              Reflect.get(field, "getText") ?? Reflect.get(field, "getValue")
            ).call(field);
          await registry.mount(
            (screen: DesktopTui, _theme: unknown, keys: unknown) => {
              tui = screen;
              for (let index = 0; index < 2; index++) {
                const Base =
                  Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
                const field: PiComponent =
                  kind === "Input"
                    ? new Base({ prompt: `Field ${index}` })
                    : kind === "SelectList"
                      ? new Base(
                          [
                            { value: "alpha", label: `Alpha ${index}` },
                            { value: "beta", label: `Beta ${index}` },
                          ],
                          3,
                          theme,
                        )
                      : kind === "SettingsList"
                        ? new Base(
                            [
                              {
                                id: "alpha",
                                label: `Alpha ${index}`,
                                currentValue: "off",
                                values: ["off", "on"],
                              },
                              {
                                id: "beta",
                                label: `Beta ${index}`,
                                currentValue: "off",
                                values: ["off", "on"],
                              },
                            ],
                            3,
                            theme,
                            (id: string, selected: string) =>
                              submitted.push(`${index}:${id}:${selected}`),
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
                  ).call(field, index ? "two" : "one");
                  field.handleInput?.("\x05");
                  Reflect.set(field, "onSubmit", (text: string) =>
                    submitted.push(`${index}:${text}`),
                  );
                } else if (kind === "SelectList")
                  Reflect.set(field, "onSelect", (item: { value: string }) =>
                    submitted.push(`${index}:${item.value}`),
                  );
                const original = field.handleInput!.bind(field);
                field.handleInput = (data: string) => {
                  calls.push(`${index}:${data}`);
                  original(data);
                };
                Reflect.set(field, "dispose", () => disposed[index]++);
                if (mode === "locked")
                  Object.defineProperty(field, "render", {
                    value: field.render,
                    configurable: false,
                    writable: false,
                  });
                fields.push(field);
              }
              tui.addInputListener((data) => {
                if (data === "switch") {
                  active = 1;
                  tui.setFocus(fields[1]);
                  return { data: editing ? "b" : "\x1b[B" };
                }
                if (data === "consume") return { consume: true };
                if (data === "clear") {
                  tui.setFocus(null);
                  return { data: "z" };
                }
              });
              tui.setFocus(fields[0]);
              return {
                ...(mode === "closure" ? {} : { fields }),
                ...(mode === "closure"
                  ? {
                      dispose() {
                        fields.forEach((field) =>
                          Reflect.get(field, "dispose").call(field),
                        );
                      },
                    }
                  : {}),
                render(width: number) {
                  return [
                    "Opaque heading",
                    ...(mode === "multiple"
                      ? fields.flatMap((field) => field.render(width))
                      : fields[active].render(
                          mode === "width" ? width - 4 : width,
                        )),
                  ];
                },
                invalidate() {
                  fields.forEach((field) => field.invalidate());
                },
              };
            },
            "dialog",
            "terminal-descendant",
          );
          try {
            const frame = () => terminal(registry.surfaces[0].view)!;
            assert.ok(
              frame(),
              "the original ambiguous/locked frame stays on xterm",
            );
            const input = (data: string) =>
              registry.action("terminal-descendant", {
                action: frame().action,
                value: { data },
              });
            await input(editing ? "a" : "\x1b[B");
            assert.deepEqual(
              calls,
              [editing ? "0:a" : "0:\x1b[B"],
              "xterm input reaches the originally focused child",
            );
            assert.equal(
              registry.surfaces[0].focusRequest?.action,
              frame().action,
              "hidden descendant focus is projected onto its visible terminal",
            );
            if (editing) {
              assert.equal(value(fields[0]), "onea");
              await input("\x01");
              await input("!");
              assert.equal(
                value(fields[0]),
                "!onea",
                "terminal Ctrl+A keeps Pi line-start semantics",
              );
            }
            await input("switch");
            assert.equal(calls.at(-1), editing ? "1:b" : "1:\x1b[B");
            if (editing) assert.equal(value(fields[1]), "twob");
            await input("\r");
            assert.deepEqual(submitted, [
              editing
                ? "1:twob"
                : kind === "SelectList"
                  ? "1:beta"
                  : "1:beta:on",
            ]);
            const before = [...calls];
            await input("consume");
            await input("clear");
            await registry.input("terminal-descendant", "after-clear");
            assert.deepEqual(
              calls,
              before,
              "consumption and cleared focus stop downstream handling",
            );
            assert.equal(registry.surfaces[0].focusRequest?.action, null);
            tui.setFocus(fields[0]);
            await input(editing ? "q" : "\r");
            assert.equal(calls.at(-1), editing ? "0:q" : "0:\r");
            assert.deepEqual(disposed, [0, 0]);
          } finally {
            registry.clearSurfaces();
          }
          assert.deepEqual(
            disposed,
            [1, 1],
            "original descendants dispose once",
          );
        });
    await t.test(
      "an original wrapper handler keeps input ownership without replacing descendant focus",
      async () => {
        let tui!: DesktopTui;
        const field = new api.Input();
        const calls: string[] = [];
        await registry.mount(
          (screen: DesktopTui) => {
            tui = screen;
            tui.setFocus(field);
            return {
              field,
              render(width: number) {
                return field.render(width).concat(field.render(width));
              },
              handleInput(data: string) {
                calls.push(data);
                field.handleInput(`root:${data}`);
              },
              invalidate() {
                field.invalidate();
              },
            };
          },
          "dialog",
          "terminal-owned",
        );
        try {
          const frame = terminal(registry.surfaces[0].view)!;
          await registry.action("terminal-owned", {
            action: frame.action,
            value: { data: "x" },
          });
          assert.deepEqual(calls, ["x"]);
          assert.equal(field.getValue(), "root:x");
          assert.equal(
            componentFocus(tui),
            field,
            "the visual emitter does not take the original child's focus",
          );
        } finally {
          registry.clearSurfaces();
        }
      },
    );
    await t.test(
      "multiple opaque regions project focus to the correct surface and keep global Pi keyboard ownership",
      async () => {
        let tui!: DesktopTui;
        const first = new api.Input(),
          second = new api.Input();
        await registry.mount(
          (screen: DesktopTui) => {
            tui = screen;
            const Container = Reflect.get(api, "Container");
            const body = new Container();
            for (const field of [first, second])
              body.addChild({
                field,
                render(width: number) {
                  return field.render(width - 2);
                },
                invalidate() {
                  field.invalidate();
                },
              });
            tui.setFocus(second);
            return body;
          },
          "dialog",
          "terminal-regions",
        );
        try {
          const view = registry.surfaces[0].view;
          assert.ok("children" in view);
          const frames = view.children.map((child) => terminal(child)!);
          assert.equal(
            registry.surfaces[0].focusRequest?.action,
            frames[1].action,
          );
          await registry.action("terminal-regions", {
            action: frames[0].action,
            value: { data: "b" },
          });
          assert.equal(first.getValue(), "");
          assert.equal(second.getValue(), "b");
          tui.setFocus(first);
          assert.equal(
            registry.surfaces[0].focusRequest?.action,
            frames[0].action,
          );
          await registry.action("terminal-regions", {
            action: frames[1].action,
            value: { data: "a" },
          });
          assert.equal(first.getValue(), "a");
          assert.equal(second.getValue(), "b");
        } finally {
          registry.clearSurfaces();
        }
      },
    );
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await fixture.close();
  }
});
