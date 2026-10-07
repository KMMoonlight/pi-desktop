import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import type { PiComponent } from "../backend/component-runtime.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import { createFixture } from "./fixture.ts";

function presented(node: DesktopNode): DesktopNode[] {
  if (node.rendered?.replacement !== undefined) return [node];
  const children =
    "children" in node
      ? node.rendered?.composition
        ? node.rendered.composition.flatMap((part) =>
            "child" in part ? [node.children[part.child]] : [],
          )
        : node.children
      : node.kind === "region"
        ? [node.child]
        : [];
  return [node, ...children.flatMap(presented)];
}

test("delegated frames retain original desktop controls through wrapper transformations", async (t) => {
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
    for (const shape of ["decorated", "transparent", "nested"])
      for (const depth of [1, 3])
        for (const kind of [
          "Input",
          "Editor",
          "CustomEditor",
          "SelectList",
          "SettingsList",
        ])
          await t.test(`${shape}/${depth}/${kind}`, async () => {
            let mode = "heading",
              submitted = "";
            const inputs: number[] = [],
              changes: string[] = [];
            const disposed = new Map<string, number>();
            const own = <T extends PiComponent>(name: string, value: T) => {
              disposed.set(name, 0);
              Reflect.set(value, "dispose", () =>
                disposed.set(name, disposed.get(name)! + 1),
              );
              return value;
            };
            let field!: PiComponent;
            let peer: InstanceType<typeof api.Input> | undefined;
            await registry.mount(
              (tui: DesktopTui, _theme: unknown, keys: unknown) => {
                const Base =
                  Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
                if (kind === "SelectList") {
                  field = new Base(
                    [
                      { value: "alpha", label: "secret alpha" },
                      { value: "beta", label: "secret beta" },
                    ],
                    3,
                    theme,
                  );
                  Reflect.set(field, "onSelect", (item: { value: string }) => {
                    submitted = item.value;
                  });
                } else if (kind === "SettingsList") {
                  field = new Base(
                    [
                      {
                        id: "alpha",
                        label: "secret alpha",
                        currentValue: "off",
                        values: ["off", "on"],
                      },
                      {
                        id: "beta",
                        label: "secret beta",
                        currentValue: "off",
                        values: ["off", "on"],
                      },
                    ],
                    3,
                    theme,
                    (id: string, value: string) =>
                      changes.push(`${id}:${value}`),
                    () => {},
                  );
                } else {
                  field =
                    kind === "Input"
                      ? new Base({ prompt: "Wrapped field" })
                      : new Base(
                          tui,
                          { borderColor: identity, selectList: theme },
                          ...(kind === "CustomEditor" ? [keys] : []),
                        );
                  (
                    Reflect.get(field, "setText") ??
                    Reflect.get(field, "setValue")
                  ).call(field, "secret value");
                  field.handleInput?.("\x05");
                  Reflect.set(field, "onSubmit", (value: string) => {
                    submitted = value;
                  });
                }
                own("field", field);
                let child: PiComponent = field;
                if (shape !== "decorated") {
                  const Box = Reflect.get(api, "Box");
                  const body = own("body", new Box(1, 1)) as PiComponent & {
                    addChild(child: PiComponent): void;
                  };
                  body.addChild(field);
                  peer = own("peer", new api.Input({ prompt: "Wrapped peer" }));
                  peer.setValue("Peer value");
                  body.addChild(peer);
                  child = body;
                }
                for (let index = 0; index < depth; index++) {
                  const body = child;
                  child = own(`wrapper ${index}`, {
                    body,
                    render(width: number): string[] {
                      if (mode === "empty") return [];
                      const lines = this.body.render(width);
                      if (mode === "normal" || shape === "transparent")
                        return lines;
                      const drawing =
                        mode === "mask"
                          ? lines.map((line) =>
                              line.replaceAll("secret", "hidden"),
                            )
                          : lines;
                      return [
                        `Wrapper ${index} heading`,
                        ...drawing,
                        `Wrapper ${index} footer`,
                      ];
                    },
                    handleInput(data: string) {
                      inputs.push(index);
                      (body.handleInput ? body : field).handleInput?.(data);
                    },
                    invalidate() {
                      body.invalidate();
                    },
                  });
                }
                if (shape !== "decorated") {
                  const Box = Reflect.get(api, "Box");
                  class Outer extends Box {
                    constructor(...args: unknown[]) {
                      super(...args);
                    }
                    render(width: number): string[] {
                      const lines: string[] = super.render(width);
                      return [
                        "Enclosing heading",
                        ...lines.map((line) =>
                          (mode === "mask"
                            ? line.replaceAll("secret", "hidden")
                            : line
                          ).replaceAll("Wrapper", "Enclosing wrapper"),
                        ),
                        "Enclosing footer",
                      ];
                    }
                  }
                  const outer = own(
                    "outer",
                    new Outer(1, 1) as unknown as PiComponent & {
                      addChild(child: PiComponent): void;
                    },
                  );
                  outer.addChild(child);
                  child = outer;
                }
                tui.setFocus(field);
                return child;
              },
              "dialog",
              "delegated-frame",
            );
            try {
              const tree = () => presented(registry.surfaces[0].view);
              const native = () =>
                tree().find(
                  (node) =>
                    (node.kind === "input" && node.value.includes("secret")) ||
                    (node.kind === "textarea" &&
                      node.value.includes("secret")) ||
                    (node.kind === "select" &&
                      node.options.some((option) =>
                        option.label.includes("secret"),
                      )),
                );
              assert.ok(
                !tree().some((node) => node.kind === "terminal"),
                "one original delegated frame maps to desktop components",
              );
              if (kind !== "SettingsList")
                assert.ok(native(), "unchanged wrapped controls remain native");
              if (peer)
                assert.ok(
                  tree().some(
                    (node) =>
                      node.kind === "input" && node.value === "Peer value",
                  ),
                );
              const focus = registry.surfaces[0].focusRequest?.action;
              assert.ok(
                focus &&
                  tree().some((node) => node.component?.action === focus),
                "the original child focus request belongs to its wrapped surface",
              );
              mode = "mask";
              await registry.input("delegated-frame", "");
              const control = tree().find((node) => node.rendered?.control)
                ?.rendered?.control;
              assert.ok(
                control,
                `transformed content retains the original input target: ${JSON.stringify(registry.surfaces[0].view)}`,
              );
              assert.equal(
                native(),
                undefined,
                "the original editable value is not visibly duplicated",
              );
              assert.ok(!tree().some((node) => node.kind === "terminal"));
              if (peer)
                assert.ok(
                  tree().some(
                    (node) =>
                      node.kind === "input" && node.value === "Peer value",
                  ),
                );
              const action = control.action;
              const input = (data: string) =>
                registry.input("delegated-frame", data, undefined, undefined, {
                  controlAction: action,
                  raw: true,
                });
              inputs.length = 0;
              if (["Input", "Editor", "CustomEditor"].includes(kind)) {
                await input("!");
                assert.deepEqual(
                  inputs,
                  Array.from(
                    { length: depth },
                    (_, index) => depth - index - 1,
                  ),
                );
                await input("\r");
                assert.equal(submitted, "secret value!");
                (
                  Reflect.get(field, "setText") ??
                  Reflect.get(field, "setValue")
                ).call(field, "SDK update");
              } else {
                await input("\x1b[B");
                await input("\r");
                if (kind === "SelectList") assert.equal(submitted, "beta");
                else assert.deepEqual(changes, ["beta:on"]);
              }
              mode = "empty";
              await input("");
              const hidden = tree();
              assert.ok(
                [...disposed.values()].every((count) => count === 0),
                JSON.stringify([...disposed]),
              );
              assert.ok(
                !hidden.some(
                  (node) =>
                    node.kind === "input" ||
                    node.kind === "textarea" ||
                    node.kind === "select" ||
                    node.kind === "terminal" ||
                    node.rendered?.control,
                ),
              );
              if (["Input", "Editor", "CustomEditor"].includes(kind))
                (
                  Reflect.get(field, "setText") ??
                  Reflect.get(field, "setValue")
                ).call(field, "Hidden SDK update");
              mode = "normal";
              await input("");
              assert.ok(
                !tree().some(
                  (node) => node.rendered?.control || node.kind === "terminal",
                ),
              );
              if (["Input", "Editor", "CustomEditor"].includes(kind))
                assert.ok(
                  tree().some(
                    (node) =>
                      (node.kind === "input" || node.kind === "textarea") &&
                      node.value === "Hidden SDK update",
                  ),
                );
              assert.ok([...disposed.values()].every((count) => count === 0));
            } finally {
              registry.clearSurfaces();
            }
            assert.ok(
              [...disposed.values()].every((count) => count === 1),
              JSON.stringify([...disposed]),
            );
          });
    await t.test(
      "replacing the delegated instance retires the old child exactly once",
      async () => {
        const first = new api.Input(),
          second = new api.Input();
        let firstDisposed = 0,
          secondDisposed = 0;
        Reflect.set(first, "dispose", () => firstDisposed++);
        Reflect.set(second, "dispose", () => secondDisposed++);
        const wrapper = {
          body: first,
          render(width: number) {
            return ["Replacement heading", ...this.body.render(width)];
          },
          handleInput(data: string) {
            this.body.handleInput(data);
          },
          invalidate() {
            this.body.invalidate();
          },
        };
        try {
          await registry.mount(wrapper, "dialog", "delegated-replacement");
          await registry.input("delegated-replacement", "a");
          assert.equal(first.getValue(), "a");
          assert.equal(firstDisposed, 0);
          wrapper.body = second;
          await registry.input("delegated-replacement", "");
          assert.ok(
            presented(registry.surfaces[0].view).some(
              (node) => node.kind === "input" && node.value === "",
            ),
          );
          assert.equal(firstDisposed, 1);
          assert.equal(secondDisposed, 0);
          await registry.input("delegated-replacement", "b");
          assert.equal(second.getValue(), "b");
          assert.equal(first.getValue(), "a");
        } finally {
          registry.clearSurfaces();
        }
        assert.equal(firstDisposed, 1);
        assert.equal(secondDisposed, 1);
      },
    );
    await t.test(
      "terminal wrappers retain and dispose every observed original child",
      async () => {
        const first = new api.Input(),
          second = new api.Input();
        let firstDisposed = 0,
          secondDisposed = 0;
        Reflect.set(first, "dispose", () => firstDisposed++);
        Reflect.set(second, "dispose", () => secondDisposed++);
        const wrapper = {
          first,
          second,
          render(width: number) {
            return this.first.render(width).concat(this.second.render(width));
          },
          invalidate() {
            this.first.invalidate();
            this.second.invalidate();
          },
        };
        try {
          await registry.mount(wrapper, "dialog", "delegated-terminal");
          assert.ok(
            presented(registry.surfaces[0].view).some(
              (node) => node.kind === "terminal",
            ),
          );
          assert.equal(firstDisposed, 0);
          assert.equal(secondDisposed, 0);
        } finally {
          registry.clearSurfaces();
        }
        assert.equal(firstDisposed, 1);
        assert.equal(secondDisposed, 1);
      },
    );
    for (const storage of [
      "symbol",
      "array",
      "map-value",
      "map-key",
      "set",
      "record",
    ])
      await t.test(
        `${storage} references retain hidden children and retire replacements`,
        async () => {
          const first = new api.Input({ prompt: "Collection field" });
          const second = new api.Input({ prompt: "Collection field" });
          const disposed = [0, 0];
          Reflect.set(first, "dispose", () => disposed[0]++);
          Reflect.set(second, "dispose", () => disposed[1]++);
          const key = Symbol("body");
          let field = first,
            hidden = false;
          const wrapper: PiComponent & { holder: object } = {
            holder: {},
            render(width: number) {
              return hidden
                ? []
                : ["Collection heading", ...field.render(width)];
            },
            handleInput(data: string) {
              field.handleInput(data);
            },
            invalidate() {
              field.invalidate();
            },
          };
          const hold = () => {
            wrapper.holder =
              storage === "symbol"
                ? { [key]: field }
                : storage === "array"
                  ? [field]
                  : storage === "map-value"
                    ? new Map([["field", field]])
                    : storage === "map-key"
                      ? new Map([[field, "field"]])
                      : storage === "set"
                        ? new Set([field])
                        : { content: { field } };
            Reflect.set(wrapper.holder, "self", wrapper.holder);
          };
          const view = () => presented(registry.surfaces[0].view);
          try {
            hold();
            await registry.mount(wrapper, "dialog", "delegated-collection");
            assert.ok(
              view().some((node) => node.kind === "input"),
              storage,
            );
            await registry.input("delegated-collection", "a");
            assert.equal(first.getValue(), "a");
            hidden = true;
            await registry.input("delegated-collection", "");
            assert.ok(
              !view().some(
                (node) => node.kind === "input" || node.kind === "terminal",
              ),
            );
            assert.deepEqual(
              disposed,
              [0, 0],
              "a hidden held child stays alive",
            );
            first.setValue("Hidden SDK value");
            hidden = false;
            await registry.input("delegated-collection", "");
            assert.ok(
              view().some(
                (node) =>
                  node.kind === "input" && node.value === "Hidden SDK value",
              ),
            );
            field = second;
            hold();
            await registry.input("delegated-collection", "");
            assert.ok(
              view().some((node) => node.kind === "input" && node.value === ""),
            );
            assert.deepEqual(disposed, [1, 0]);
            await registry.input("delegated-collection", "b");
            assert.equal(second.getValue(), "b");
            assert.equal(first.getValue(), "Hidden SDK value");
          } finally {
            registry.clearSurfaces();
          }
          assert.deepEqual(disposed, [1, 1]);
        },
      );
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await fixture.close();
  }
});
