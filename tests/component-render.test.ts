import test from "node:test";
import assert from "node:assert/strict";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import {
  mappedComponentTypes,
  registerComponentMappings,
} from "../backend/component-mapping.ts";
import {
  loadComponentRuntime,
  componentRenderBaseline,
  componentRenderBaselineFrame,
  type PiComponent,
} from "../backend/component-runtime.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
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
function additions(view: DesktopNode) {
  return nodes(view).flatMap((node) => [
    ...(node.rendered?.before ?? []),
    ...(node.rendered?.after ?? []),
  ]);
}
function presentedNodes(node: DesktopNode): DesktopNode[] {
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
  return [node, ...children.flatMap(presentedNodes)];
}
function assertNestedDecorations(view: DesktopNode, innerKinds: string[]) {
  const lines = presentedNodes(view).flatMap((node) => [
    ...(node.rendered?.before ?? []),
    ...(node.rendered?.after ?? []),
    ...(node.rendered?.replacement ?? []),
    ...(node.rendered?.composition?.flatMap((part) =>
      "lines" in part ? part.lines : [],
    ) ?? []),
  ]);
  for (const kind of innerKinds.filter((name) => !name.startsWith("plain:")))
    for (const label of [`Nested ${kind} heading`, `Nested ${kind} ending`])
      assert.equal(
        lines.filter((line) => line.text.trim() === label).length,
        1,
        label,
      );
}

const nestedContainerPaths = [
  [],
  ["Container"],
  ["Box"],
  ["VStack"],
  ["plain:Container"],
  ["plain:Box"],
  ["plain:VStack"],
  ["Container", "Box", "VStack"],
];
function nestComponent(
  api: Awaited<ReturnType<typeof loadTuiApi>>,
  field: PiComponent,
  kinds: string[],
  disposed: () => void,
) {
  let child = field;
  for (const name of [...kinds].reverse()) {
    const plain = name.startsWith("plain:");
    const kind = plain ? name.slice(6) : name;
    const Base = Reflect.get(api, kind);
    class Nested extends Base {
      constructor(...args: unknown[]) {
        super(...args);
      }
      render(width: number): string[] {
        return [
          `Nested ${kind} heading`,
          ...super.render(width),
          `Nested ${kind} ending`,
        ];
      }
    }
    const Constructor = plain ? Base : Nested;
    const parent = kind === "Box" ? new Constructor(1, 1) : new Constructor();
    const sibling = new api.Input({ prompt: `Nested ${kind} sibling` });
    sibling.setValue("Nested sibling value");
    sibling.dispose = disposed;
    parent.addChild(child);
    parent.addChild(sibling);
    parent.dispose = disposed;
    child = parent as PiComponent;
  }
  return child;
}

test("horizontal and scroll frames retain original controls without stale native values", async (t) => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  const api = await loadTuiApi();
  const runtime = await loadComponentRuntime();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const maskFrameText = (line: string) => {
    const replacement = api
      .stripTerminalSequences(line)
      .replace(/secret/g, "hidden");
    let result = "",
      offset = 0;
    for (let index = 0; index < line.length;) {
      const ansi = runtime.text.extractAnsiCode(line, index);
      if (ansi) {
        result += ansi.code;
        index += ansi.length;
      } else {
        result += replacement[offset++];
        index++;
      }
    }
    return result;
  };
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
    await host.initialize(setup.cwd);
    for (const parentKind of ["HStack", "ScrollView"])
      for (const innerKinds of [[], ["Box"], ["Container", "Box", "VStack"]])
        for (const kind of [
          "Input",
          "Editor",
          "CustomEditor",
          "SelectList",
          "SettingsList",
        ])
          await t.test(
            `${parentKind}/${innerKinds.join("/")}/${kind}`,
            async () => {
              const ParentBase = Reflect.get(api, parentKind);
              const FieldBase =
                Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
              let mode = "mask",
                submitted = "",
                disposed = 0;
              const changes: string[] = [];
              class Parent extends ParentBase {
                constructor(...args: unknown[]) {
                  super(...args);
                }
                render(width: number): string[] {
                  const body: string[] = super.render(width);
                  if (mode === "normal") return body;
                  const masked = body.map(maskFrameText);
                  if (mode === "cut")
                    return masked.filter(
                      (line) =>
                        !api
                          .stripTerminalSequences(line)
                          .includes("tail suffix"),
                    );
                  if (mode === "insert" && kind !== "Input") {
                    const row = masked.findIndex((line) =>
                      line.includes("hidden"),
                    );
                    masked.splice(
                      row + 1,
                      0,
                      "\x1b[38;2;11;122;99mInserted child line\x1b[0m",
                    );
                  }
                  return masked;
                }
              }
              let field: PiComponent & {
                setText?(text: string): void;
                setValue?(text: string): void;
                getText?(): string;
                getValue?(): string;
                onSubmit?: (value: string) => void;
                onSelect?: (item: { value: string }) => void;
                searchInput?: { getValue(): string };
              };
              let parent: PiComponent;
              await registry.mount(
                (tui: DesktopTui, _theme: unknown, keys: unknown) => {
                  if (kind === "SelectList") {
                    field = new FieldBase(
                      [
                        { value: "alpha", label: "Alpha secret" },
                        { value: "beta", label: "Beta tail suffix" },
                      ],
                      5,
                      theme,
                    );
                    field.onSelect = (item: { value: string }) => {
                      submitted = item.value;
                    };
                  } else if (kind === "SettingsList") {
                    field = new FieldBase(
                      [
                        {
                          id: "alpha",
                          label: "Alpha secret",
                          currentValue: "off",
                          values: ["off", "on"],
                        },
                        {
                          id: "beta",
                          label: "Beta tail suffix",
                          currentValue: "off",
                          values: ["off", "on"],
                        },
                      ],
                      5,
                      theme,
                      (id: string, value: string) =>
                        changes.push(`${id}:${value}`),
                      () => {},
                      { enableSearch: true },
                    );
                  } else {
                    field =
                      kind === "Input"
                        ? new FieldBase({ prompt: "Nested field" })
                        : new FieldBase(
                            tui,
                            { borderColor: identity, selectList: theme },
                            ...(kind === "CustomEditor" ? [keys] : []),
                          );
                    (field.setText ?? field.setValue)!.call(
                      field,
                      kind === "Input"
                        ? "original-secret"
                        : "original-secret\ntail suffix",
                    );
                    field.onSubmit = (value: string) => {
                      submitted = value;
                    };
                  }
                  const sibling = new api.Input({ prompt: "Other field" });
                  sibling.setValue("Sibling value");
                  const nested = nestComponent(
                    api,
                    field,
                    innerKinds,
                    () => disposed++,
                  );
                  if (parentKind === "ScrollView") {
                    const Content = Reflect.get(api, "Container");
                    const content = new Content();
                    content.addChild(nested);
                    content.addChild(sibling);
                    content.dispose = () => disposed++;
                    parent = new Parent(content, {
                      scrollbar: "always",
                    }) as PiComponent;
                  } else {
                    const horizontal = new Parent([], { gap: 2 });
                    horizontal.addChild(nested, { basis: 0, grow: 3 });
                    horizontal.addChild(sibling, { basis: 0, grow: 1 });
                    parent = horizontal as PiComponent;
                  }
                  for (const component of [parent, field, sibling])
                    Reflect.set(component, "dispose", () => disposed++);
                  tui.setFocus(field);
                  return parent;
                },
                "dialog",
                "layout-frame",
              );
              const view = () => registry.surfaces[0].view;
              const custom = () =>
                presentedNodes(view()).find((node) => node.rendered?.control);
              assert.ok(
                custom()?.rendered?.control,
                "transformed layout must retain original control input",
              );
              const action = custom()!.rendered!.control!.action;
              const input = (data: string) =>
                registry.input("layout-frame", data, undefined, undefined, {
                  controlAction: action,
                  raw: true,
                });
              if (kind === "Input") {
                for (const cursor of [11, 0]) {
                  Reflect.set(field!, "cursor", cursor);
                  await registry.input("layout-frame", "");
                  assert.ok(
                    custom()?.rendered?.replacement?.some((line) =>
                      line.text.includes("hidden"),
                    ),
                    "masking must survive cursor escapes within the original text",
                  );
                }
              }
              for (const next of ["mask", "cut", "insert"]) {
                mode = next;
                await registry.input("layout-frame", "");
                if (next === "insert" && kind !== "Input") {
                  const inserted = custom()?.rendered?.replacement?.find(
                    (line) => line.text.trim() === "Inserted child line",
                  );
                  assert.ok(
                    inserted,
                    "new text must not be cropped as Box padding",
                  );
                  assert.equal(
                    inserted.runs?.[0].style?.color,
                    "rgb(11, 122, 99)",
                  );
                }
                assert.ok(
                  custom()?.rendered?.replacement?.some((line) =>
                    line.text.includes("hidden"),
                  ),
                );
                assert.ok(
                  !custom()?.rendered?.replacement?.some((line) =>
                    line.text.includes("secret"),
                  ),
                );
                assert.ok(
                  !presentedNodes(view()).some(
                    (node) =>
                      (node.kind === "input" ||
                        node.kind === "textarea" ||
                        node.kind === "select") &&
                      "action" in node &&
                      node.action === action,
                  ),
                );
                assert.ok(
                  presentedNodes(view()).some(
                    (node) =>
                      node.kind === "input" &&
                      node.label === "Other field" &&
                      node.value === "Sibling value",
                  ),
                );
                assertNestedDecorations(view(), innerKinds);
                if (parentKind === "HStack" && !innerKinds.length) {
                  const width = view().component?.columns ?? 100;
                  assert.equal(
                    custom()?.rendered?.replacement?.length,
                    parent!.render(width).length,
                    "unframed child drawing must retain the complete original body",
                  );
                }
              }
              if (["Input", "Editor", "CustomEditor"].includes(kind)) {
                await input("\x01");
                await input("!");
                assert.ok(
                  (field!.getText ?? field!.getValue)!
                    .call(field!)
                    .includes("!"),
                );
                await input("\r");
                assert.ok(submitted.includes("secret"));
                (field!.setText ?? field!.setValue)!.call(field!, "SDK update");
              } else {
                await input("\x1b[B");
                await input("\r");
                if (kind === "SelectList") assert.equal(submitted, "beta");
                else {
                  assert.deepEqual(changes, ["beta:on"]);
                  await input("alpha");
                  assert.equal(field!.searchInput!.getValue(), "alpha");
                }
              }
              mode = "normal";
              await registry.input("layout-frame", "");
              assert.equal(custom(), undefined);
              if (["Input", "Editor", "CustomEditor"].includes(kind))
                assert.ok(
                  presentedNodes(view()).some(
                    (node) =>
                      (node.kind === "input" || node.kind === "textarea") &&
                      node.value === "SDK update",
                  ),
                );
              assert.equal(disposed, 0);
              registry.clearSurfaces();
              assert.equal(
                disposed,
                3 +
                  innerKinds.length * 2 +
                  (parentKind === "ScrollView" ? 1 : 0),
              );
            },
          );
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});

test("interactive custom frames hide native values and keep original SDK input", async (t) => {
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
    for (const kind of ["Input", "Editor", "CustomEditor"])
      await t.test(kind, async () => {
        const Base = Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
        let mode = "mask",
          submitted = "",
          disposed = 0;
        class Masked extends Base {
          constructor(...args: unknown[]) {
            super(...args);
          }
          render(width: number): string[] {
            const body: string[] = super.render(width);
            if (mode === "normal") return body;
            if (mode === "partial")
              return body.map((line) => line.replace(/secret/g, "hidden"));
            return ["\x1b[38;2;11;122;99mMasked field\x1b[0m", "********"];
          }
        }
        let original!: PiComponent & {
          setValue?(text: string): void;
          setText?(text: string): void;
          getValue?(): string;
          getText?(): string;
          onSubmit?: (text: string) => void;
          dispose?(): void;
        };
        await registry.mount(
          (tui: DesktopTui, _theme: unknown, keys: unknown) => {
            original = (
              kind === "Input"
                ? new Masked({ prompt: "Private field" })
                : new Masked(
                    tui,
                    {
                      borderColor: (text: string) => text,
                      selectList: host.sdk.sdk.getSelectListTheme(),
                    },
                    ...(kind === "CustomEditor" ? [keys] : []),
                  )
            ) as typeof original;
            (original.setText ?? original.setValue)!.call(
              original,
              "original-secret",
            );
            original.onSubmit = (text: string) => {
              submitted = text;
            };
            original.dispose = () => {
              disposed++;
            };
            tui.setFocus(original);
            return original;
          },
          "dialog",
          "interactive-frame",
        );
        const view = () => {
          const root = registry.surfaces[0].view;
          return root.kind === "region" ? root.child : root;
        };
        const field = nodes(view()).find(
          (node) => node.kind === "input" || node.kind === "textarea",
        )!;
        assert.ok(field.kind === "input" || field.kind === "textarea");
        assert.deepEqual(
          view().rendered?.replacement?.map((line) => line.text),
          ["Masked field", "********"],
        );
        assert.equal(view().rendered?.control?.action, field.action);
        assert.equal(
          presentedNodes(view()).some(
            (node) => node.kind === "input" || node.kind === "textarea",
          ),
          false,
        );
        const input = (data: string) =>
          registry.input("interactive-frame", data, undefined, undefined, {
            controlAction: field.action,
            raw: true,
          });
        // Ctrl+A retains Pi's line-start binding when no native text is displayed.
        assert.equal((await input("\x01")).consume, true);
        assert.equal((await input("!")).editor, undefined);
        assert.equal(
          (original!.getText ?? original!.getValue)!.call(original),
          "!original-secret",
        );
        await input("\x7f");
        mode = "partial";
        await input("");
        assert.ok(
          view().rendered?.replacement?.some((line) =>
            line.text.includes("hidden"),
          ),
        );
        assert.ok(
          !view().rendered?.replacement?.some((line) =>
            line.text.includes("original-secret"),
          ),
        );
        await input("\r");
        assert.equal(submitted, "original-secret");
        (original!.setText ?? original!.setValue)!.call(
          original,
          "SDK replacement",
        );
        mode = "normal";
        await input("");
        assert.equal(view().rendered?.replacement, undefined);
        const restored = presentedNodes(view()).find(
          (node) => node.kind === "input" || node.kind === "textarea",
        );
        assert.ok(restored && "value" in restored);
        assert.equal(restored.value, "SDK replacement");
        assert.equal(disposed, 0);
        registry.clearSurfaces();
        assert.equal(disposed, 1);
      });
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});

test("custom list frames replace stale options and retain original SDK operations", async (t) => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
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
    await host.initialize(setup.cwd);
    for (const kind of ["SelectList", "SettingsList"])
      for (const helper of [false, true])
        await t.test(`${kind}, inherited helper ${helper}`, async () => {
          const Base = Reflect.get(api, kind);
          let mode = "replace",
            disposed = 0,
            confirmed = "",
            cancelled = 0;
          const changed: string[] = [];
          const handled: string[] = [];
          const transform = (body: string[]) =>
            mode === "normal"
              ? body
              : mode === "partial"
                ? body.map((line) => line.replace(/Original/g, "Displayed"))
                : [
                    "\x1b[38;2;11;122;99mList frame\x1b[0m",
                    "Visible selection",
                  ];
          class Reframed extends Base {
            constructor(...args: unknown[]) {
              super(...args);
            }
            handleInput(data: string) {
              handled.push(data);
              Reflect.apply(Base.prototype.handleInput, this, [data]);
            }
          }
          if (helper) {
            const method =
              kind === "SelectList" ? "renderItem" : "renderMainList";
            const originalMethod = Reflect.get(Base.prototype, method);
            Reflect.set(
              Reframed.prototype,
              method,
              function (this: PiComponent, ...args: unknown[]) {
                const body = Reflect.apply(originalMethod, this, args);
                if (kind === "SelectList") {
                  assert.ok(typeof body === "string");
                  return transform([body]).join("\n");
                }
                assert.ok(Array.isArray(body));
                return transform(body);
              },
            );
          } else {
            Reflect.set(
              Reframed.prototype,
              "render",
              function (this: PiComponent, width: number) {
                return transform(
                  Reflect.apply(Base.prototype.render, this, [width]),
                );
              },
            );
          }
          type List = PiComponent & {
            onSelect?: (item: { value: string }) => void;
            onSelectionChange?: (item: { value: string }) => void;
            setFilter?(value: string): void;
            getSelectedItem?(): { value: string } | null;
            updateValue?(id: string, value: string): void;
            selectItem?(id: string): void;
            items: { id?: string; currentValue?: string }[];
            searchInput?: { getValue(): string };
            dispose?(): void;
          };
          const options =
            kind === "SelectList"
              ? [
                  { value: "alpha", label: "Original alpha" },
                  { value: "beta", label: "Original beta" },
                ]
              : [
                  {
                    id: "alpha",
                    label: "Original alpha",
                    currentValue: "off",
                    values: ["off", "on"],
                  },
                  {
                    id: "beta",
                    label: "Original beta",
                    currentValue: "off",
                    values: ["off", "on"],
                  },
                ];
          const original = new Reframed(
            options,
            5,
            theme,
            ...(kind === "SettingsList"
              ? [
                  (id: string, value: string) => {
                    changed.push(`${id}:${value}`);
                  },
                  () => {
                    cancelled++;
                  },
                  { enableSearch: true },
                ]
              : []),
          ) as List;
          if (kind === "SelectList") {
            original.onSelect = (item) => {
              confirmed = item.value;
            };
            original.onSelectionChange = (item) => {
              changed.push(item.value);
            };
          }
          original.dispose = () => {
            disposed++;
          };
          await registry.mount(
            (tui: DesktopTui) => {
              tui.setFocus(original);
              return original;
            },
            "dialog",
            "list-frame",
          );
          const view = () => registry.surfaces[0].view;
          const frame = () =>
            nodes(view()).find(
              (node) => node.rendered?.replacement !== undefined,
            )!;
          assert.ok(
            frame()?.rendered?.replacement?.some((line) =>
              line.text.includes("List frame"),
            ),
          );
          const action = view().component!.action;
          assert.equal(frame().rendered?.control?.action, action);
          assert.equal(
            presentedNodes(view()).some(
              (node) => node.kind === "select" || node.kind === "input",
            ),
            false,
          );
          assert.equal(
            nodes(view()).some((node) => node.kind === "terminal"),
            false,
          );
          const input = (data: string) =>
            registry.input("list-frame", data, undefined, undefined, {
              controlAction: action,
              raw: true,
            });
          await input("\x1b[B");
          await input("\r");
          if (kind === "SelectList") {
            assert.equal(confirmed, "beta");
            original.setFilter!("alpha");
            await input("\r");
            assert.equal(confirmed, "alpha");
            original.setFilter!("");
          } else {
            assert.deepEqual(changed, ["beta:on"]);
            await input("alpha");
            assert.equal(original.searchInput!.getValue(), "alpha");
            await input("\r");
            assert.deepEqual(changed, ["beta:on", "alpha:on"]);
            original.updateValue!("alpha", "off");
          }
          mode = "partial";
          await input("");
          assert.ok(
            frame().rendered?.replacement?.some((line) =>
              line.text.includes("Displayed"),
            ),
          );
          assert.ok(
            !frame().rendered?.replacement?.some((line) =>
              line.text.includes("Original"),
            ),
          );
          mode = "normal";
          await input("");
          assert.ok(
            presentedNodes(view()).some(
              (node) => node.kind === "select" || node.kind === "button",
            ),
          );
          assert.equal(
            nodes(view()).some((node) => node.rendered?.control),
            false,
          );
          if (kind === "SettingsList") {
            const search = presentedNodes(view()).find(
              (node) => node.kind === "input",
            );
            assert.ok(search?.kind === "input");
            const previous = handled.length;
            await registry.input("list-frame", "zzzz", undefined, undefined, {
              controlAction: search.action,
              controlText: "alpha",
              selection: { start: 0, end: 5 },
            });
            assert.deepEqual(handled.slice(previous), ["zzzz"]);
            assert.equal(original.searchInput!.getValue(), "zzzz");
            assert.equal(Reflect.get(original, "filteredItems").length, 0);
          }
          assert.equal(disposed, 0);
          registry.clearSurfaces();
          assert.equal(disposed, 1);
          if (kind === "SettingsList") assert.equal(cancelled, 0);
        });
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});

test("canonical Box child ranges follow Pi padding rows without changing original caches", async () => {
  const api = await loadTuiApi();
  const Box = Reflect.get(api, "Box");
  const Text = Reflect.get(api, "Text");
  for (const paddingY of [-1, 0, 0.5, 1, NaN]) {
    const original = new Box(1, paddingY);
    original.addChild(new Text("Original child", 0, 0));
    original.render(40);
    const cache = original.cache;
    const layout = original.mouseLayout;
    const frame = componentRenderBaselineFrame(
      original,
      Box.prototype,
      40,
      "Box",
    );
    assert.deepEqual(frame.children, [
      {
        child: 0,
        start: frame.lines.findIndex((line) => line.includes("Original child")),
        length: 1,
      },
    ]);
    assert.equal(original.cache, cache);
    assert.equal(original.mouseLayout, layout);
  }
});

test("canonical container frames isolate temporary mouse layout accessors", async () => {
  const api = await loadTuiApi();
  for (const kind of ["Container", "Box"]) {
    const Base = Reflect.get(api, kind);
    const original = kind === "Box" ? new Base(1, 1) : new Base();
    const first = new api.Input({ prompt: "First field" });
    const second = new api.Input({ prompt: "Second field" });
    original.addChild(first);
    original.addChild(second);
    original.render(40);
    const layout = { width: 40, children: [{ component: first, height: 99 }] };
    let writes = 0;
    const descriptor = {
      configurable: true,
      get: () => layout,
      set: () => writes++,
    };
    Object.defineProperty(original, "mouseLayout", descriptor);
    const frame = componentRenderBaselineFrame(
      original,
      Base.prototype,
      40,
      kind,
    );
    assert.equal(frame.children?.length, 2);
    assert.deepEqual(
      frame.children?.map((range) => range.length),
      [1, 1],
    );
    assert.equal(writes, 0);
    assert.equal(original.mouseLayout, layout);
    assert.equal(
      Object.getOwnPropertyDescriptor(original, "mouseLayout")?.get,
      descriptor.get,
    );
  }
});

test("vertical container custom frames retain, reorder and omit original native children", async (t) => {
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
    for (const kind of ["Container", "Box", "VStack"])
      await t.test(kind, async () => {
        const Base = Reflect.get(api, kind);
        let mode = "normal",
          submitted = "",
          disposed = 0;
        class Reframed extends Base {
          constructor(...args: unknown[]) {
            super(...args);
          }
          render(width: number): string[] {
            const body: string[] = super.render(width);
            const offset = kind === "Box" ? 1 : 0;
            const content = body.slice(offset, offset + 5);
            if (mode === "insert")
              return [
                ...body.slice(0, offset + 3),
                "Inserted middle",
                ...body.slice(offset + 3),
              ];
            if (mode === "omit")
              return body.filter((_line, row) => row !== offset + 4);
            if (mode === "partial")
              return body.filter((_line, row) => row !== offset + 1);
            if (mode === "reorder")
              return [content[4], "Moved divider", content[3]];
            if (mode === "replace")
              return [
                "\x1b[38;2;11;122;99mReplacement",
                "",
                "Continued\x1b[0m",
                "",
              ];
            return body;
          }
        }
        const original = kind === "Box" ? new Reframed(1, 1) : new Reframed();
        const label = new (Reflect.get(api, "Text"))(
          "Original first\nOriginal removed\nOriginal last",
          0,
          0,
        );
        const retained = new api.Input({ prompt: "Retained field" });
        const omitted = new api.Input({ prompt: "Omitted field" });
        retained.setValue("Original value");
        omitted.setValue("Other value");
        retained.onSubmit = (text: string) => {
          submitted = text;
        };
        for (const child of [label, retained, omitted])
          original.addChild(child);
        for (const child of [original, label, retained, omitted])
          child.dispose = () => {
            disposed++;
          };
        try {
          await registry.mount(() => original, "dialog", "container-frame");
          const view = () => registry.surfaces[0].view;
          const inputs = () =>
            presentedNodes(view()).filter((node) => node.kind === "input");
          const action = inputs().find(
            (node) => node.kind === "input" && node.label === "Retained field",
          )!;
          assert.ok(action.kind === "input");
          const identity = action.component;
          for (const next of [
            "insert",
            "omit",
            "partial",
            "reorder",
            "replace",
            "normal",
          ]) {
            mode = next;
            await registry.input("container-frame", "");
            const current = view();
            if (next === "replace") {
              assert.equal(inputs().length, 0);
              assert.deepEqual(
                current.rendered?.replacement?.map((line) => line.text),
                ["Replacement", "", "Continued", ""],
              );
              assert.equal(
                current.rendered?.replacement?.[2].runs?.[0].style?.color,
                "rgb(11, 122, 99)",
              );
              retained.setValue("SDK hidden value");
            } else {
              const field = inputs().find(
                (node) =>
                  node.kind === "input" && node.label === "Retained field",
              );
              assert.ok(field?.kind === "input");
              assert.deepEqual(field.component, identity);
              assert.equal(inputs().length, next === "omit" ? 1 : 2);
              const parts = current.rendered?.composition;
              if (next === "normal") assert.equal(parts, undefined);
              else if (next === "reorder")
                assert.deepEqual(
                  parts
                    ?.filter((part) => "child" in part)
                    .map((part) => ("child" in part ? part.child : -1)),
                  [2, 1],
                );
              else if (next === "insert")
                assert.deepEqual(
                  parts?.map((part) =>
                    "child" in part
                      ? part.child
                      : part.lines.map((line) => line.text).join("\n"),
                  ),
                  [0, "Inserted middle", 1, 2],
                );
              else if (next === "partial") {
                assert.equal(
                  presentedNodes(current).some(
                    (node) =>
                      node.kind === "text" &&
                      node.text.includes("Original removed"),
                  ),
                  false,
                );
                assert.ok(
                  parts?.some(
                    (part) =>
                      "lines" in part &&
                      part.lines.some(
                        (line) => line.text.trim() === "Original last",
                      ),
                  ),
                );
              }
            }
            assert.ok(!nodes(current).some((node) => node.kind === "terminal"));
            assert.equal(disposed, 0);
          }
          assert.equal(retained.getValue(), "SDK hidden value");
          await registry.action("container-frame", {
            action: `${action.action}:submit`,
          });
          assert.equal(submitted, "SDK hidden value");
        } finally {
          registry.clearSurfaces();
        }
        assert.equal(disposed, 4);
      });
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});
test("parent frame transformations retain nested original editing and submission", async (t) => {
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
    for (const containerKind of ["Container", "Box", "VStack"])
      for (const innerKinds of nestedContainerPaths)
        for (const inputKind of ["Input", "Editor", "CustomEditor"])
          await t.test(
            `${containerKind}/${innerKinds.join("/")}/${inputKind}`,
            async () => {
              const Base = Reflect.get(api, containerKind);
              const InputBase =
                Reflect.get(api, inputKind) ??
                Reflect.get(host.sdk.sdk, inputKind);
              let mode = "mask",
                submitted = "",
                disposed = 0;
              class Parent extends Base {
                constructor(...args: unknown[]) {
                  super(...args);
                }
                render(width: number): string[] {
                  const body: string[] = super.render(width);
                  if (mode === "normal") return body;
                  const masked = body.map((line) =>
                    line.replace(/secret/g, "hidden"),
                  );
                  if (mode === "cut")
                    return masked.filter(
                      (line) =>
                        !api
                          .stripTerminalSequences(line)
                          .includes("tail suffix"),
                    );
                  if (mode === "insert" && inputKind !== "Input") {
                    const row = masked.findIndex((line) =>
                      line.includes("hidden"),
                    );
                    masked.splice(row + 1, 0, "Inserted child line");
                  }
                  return masked;
                }
              }
              let original!: PiComponent & {
                setValue?(text: string): void;
                setText?(text: string): void;
                getValue?(): string;
                getText?(): string;
                onSubmit?: (text: string) => void;
                dispose?(): void;
              };
              let parent!: PiComponent;
              await registry.mount(
                (tui: DesktopTui, _theme: unknown, keys: unknown) => {
                  parent = (
                    containerKind === "Box" ? new Parent(1, 1) : new Parent()
                  ) as PiComponent;
                  original = (
                    inputKind === "Input"
                      ? new InputBase({ prompt: "Nested field" })
                      : new InputBase(
                          tui,
                          {
                            borderColor: (text: string) => text,
                            selectList: host.sdk.sdk.getSelectListTheme(),
                          },
                          ...(inputKind === "CustomEditor" ? [keys] : []),
                        )
                  ) as typeof original;
                  const sibling = new api.Input({ prompt: "Other field" });
                  sibling.setValue("Sibling value");
                  const addChild = Reflect.get(parent, "addChild");
                  addChild.call(
                    parent,
                    nestComponent(api, original, innerKinds, () => disposed++),
                  );
                  addChild.call(parent, sibling);
                  (original.setText ?? original.setValue)!.call(
                    original,
                    inputKind === "Input"
                      ? "original-secret"
                      : "original-secret\ntail suffix",
                  );
                  original.onSubmit = (value: string) => {
                    submitted = value;
                  };
                  for (const child of [parent, original, sibling])
                    Reflect.set(child, "dispose", () => disposed++);
                  tui.setFocus(original);
                  return parent;
                },
                "dialog",
                "nested-frame",
              );
              const view = () => registry.surfaces[0].view;
              const field = nodes(view()).find(
                (node) =>
                  (node.kind === "input" || node.kind === "textarea") &&
                  node.label !== "Other field",
              )!;
              assert.ok(field.kind === "input" || field.kind === "textarea");
              const identity = field.action;
              const custom = () =>
                presentedNodes(view()).find(
                  (node) => node.rendered?.control?.action === identity,
                );
              const input = (data: string) =>
                registry.input("nested-frame", data, undefined, undefined, {
                  controlAction: identity,
                  raw: true,
                });
              for (const next of ["mask", "cut", "insert"]) {
                mode = next;
                await registry.input("nested-frame", "");
                assert.ok(
                  custom(),
                  "transformed child must retain its own input",
                );
                assert.ok(
                  !presentedNodes(view()).some(
                    (node) =>
                      (node.kind === "input" || node.kind === "textarea") &&
                      node.action === identity,
                  ),
                );
                assert.ok(
                  custom()?.rendered?.replacement?.some((line) =>
                    line.text.includes("hidden"),
                  ),
                );
                assert.ok(
                  !custom()?.rendered?.replacement?.some((line) =>
                    line.text.includes("secret"),
                  ),
                );
                if (next === "cut" && inputKind !== "Input")
                  assert.ok(
                    !custom()?.rendered?.replacement?.some((line) =>
                      line.text.includes("tail suffix"),
                    ),
                  );
                assert.ok(
                  presentedNodes(view()).some(
                    (node) =>
                      node.kind === "input" && node.label === "Other field",
                  ),
                );
                assert.equal(
                  presentedNodes(view()).filter(
                    (node) =>
                      node.kind === "input" &&
                      node.label.startsWith("Nested ") &&
                      node.label.endsWith(" sibling") &&
                      node.value === "Nested sibling value",
                  ).length,
                  innerKinds.length,
                );
                assertNestedDecorations(view(), innerKinds);
                await input("\x01");
                await input("!");
                assert.ok(
                  (original.getText ?? original.getValue)!
                    .call(original)
                    .includes("!"),
                );
                await input("\x7f");
                assert.equal(disposed, 0);
              }
              await input("\r");
              assert.equal(
                submitted,
                inputKind === "Input"
                  ? "original-secret"
                  : "original-secret\ntail suffix",
              );
              (original.setText ?? original.setValue)!.call(
                original,
                "SDK update",
              );
              mode = "normal";
              await registry.input("nested-frame", "");
              assert.equal(custom(), undefined);
              const restored = presentedNodes(view()).find(
                (node) =>
                  (node.kind === "input" || node.kind === "textarea") &&
                  node.action === identity,
              );
              assert.ok(restored && "value" in restored);
              assert.equal(restored.value, "SDK update");
              registry.clearSurfaces();
              assert.equal(disposed, 3 + innerKinds.length * 2);
            },
          );
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});

test("parent frame transformations retain nested list selection and search ownership", async (t) => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
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
    await host.initialize(setup.cwd);
    for (const containerKind of ["Container", "Box", "VStack"])
      for (const innerKinds of nestedContainerPaths)
        for (const listKind of ["SelectList", "SettingsList"])
          await t.test(
            `${containerKind}/${innerKinds.join("/")}/${listKind}`,
            async () => {
              const Base = Reflect.get(api, containerKind);
              let normal = false,
                selected = "",
                disposed = 0;
              const changes: string[] = [];
              class Parent extends Base {
                constructor(...args: unknown[]) {
                  super(...args);
                }
                render(width: number): string[] {
                  const body: string[] = super.render(width);
                  return normal
                    ? body
                    : body.map((line) => line.replace(/secret/g, "hidden"));
                }
              }
              const List = Reflect.get(api, listKind);
              const original = new List(
                listKind === "SelectList"
                  ? [
                      { value: "alpha", label: "Alpha secret" },
                      { value: "beta", label: "Beta other" },
                    ]
                  : [
                      {
                        id: "alpha",
                        label: "Alpha secret",
                        currentValue: "off",
                        values: ["off", "on"],
                      },
                      {
                        id: "beta",
                        label: "Beta other",
                        currentValue: "off",
                        values: ["off", "on"],
                      },
                    ],
                5,
                theme,
                ...(listKind === "SettingsList"
                  ? [
                      (id: string, value: string) =>
                        changes.push(`${id}:${value}`),
                      () => {},
                      { enableSearch: true },
                    ]
                  : []),
              );
              if (listKind === "SelectList")
                original.onSelect = (item: { value: string }) => {
                  selected = item.value;
                };
              const parent =
                containerKind === "Box" ? new Parent(1, 1) : new Parent();
              const sibling = new api.Input({ prompt: "Other field" });
              for (const child of [parent, original, sibling])
                child.dispose = () => disposed++;
              parent.addChild(
                nestComponent(api, original, innerKinds, () => disposed++),
              );
              parent.addChild(sibling);
              await registry.mount(
                (tui: DesktopTui) => {
                  tui.setFocus(original);
                  return parent;
                },
                "dialog",
                "nested-list-frame",
              );
              const view = () => registry.surfaces[0].view;
              const custom = presentedNodes(view()).find(
                (node) => node.rendered?.control,
              );
              assert.ok(custom?.rendered?.control);
              assert.equal(
                presentedNodes(view()).filter(
                  (node) =>
                    node.kind === "input" &&
                    node.label.startsWith("Nested ") &&
                    node.label.endsWith(" sibling") &&
                    node.value === "Nested sibling value",
                ).length,
                innerKinds.length,
              );
              const action = custom.rendered.control.action;
              assertNestedDecorations(view(), innerKinds);
              assert.ok(
                custom.rendered.replacement?.some((line) =>
                  line.text.includes("hidden"),
                ),
              );
              const input = (data: string) =>
                registry.input(
                  "nested-list-frame",
                  data,
                  undefined,
                  undefined,
                  {
                    controlAction: action,
                    raw: true,
                  },
                );
              await input("\x1b[B");
              await input("\r");
              if (listKind === "SelectList") assert.equal(selected, "beta");
              else {
                assert.deepEqual(changes, ["beta:on"]);
                await input("alpha");
                assert.equal(original.searchInput.getValue(), "alpha");
                assert.ok(
                  presentedNodes(view()).some(
                    (node) => node.rendered?.control?.action === action,
                  ),
                );
              }
              normal = true;
              await registry.input("nested-list-frame", "");
              assert.ok(
                !presentedNodes(view()).some((node) => node.rendered?.control),
              );
              if (listKind === "SettingsList") {
                const search = presentedNodes(view()).find(
                  (node) => node.kind === "input" && node.label === "搜索",
                );
                assert.ok(search && "value" in search);
                assert.equal(search.value, "alpha");
              } else {
                const select = presentedNodes(view()).find(
                  (node) => node.kind === "select",
                );
                assert.ok(select?.kind === "select");
                assert.equal(select.value, "beta");
              }
              assert.equal(disposed, 0);
              registry.clearSurfaces();
              assert.equal(disposed, 3 + innerKinds.length * 2);
            },
          );
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});

async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Rendered additions did not update");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("inherited editor renders retain prototype and instance border helper overrides", async (t) => {
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
    for (const kind of ["Editor", "CustomEditor"])
      for (const own of [false, true])
        await t.test(`${kind}, instance helper ${own}`, async () => {
          const Base: new (...args: unknown[]) => PiComponent & {
            setText(text: string): void;
            getText(): string;
            handleInput(data: string): void;
            onSubmit?: (text: string) => void;
            renderTopBorder(): string;
            renderBottomBorder(): string;
          } = Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
          class HelperEditor extends Base {
            renderTopBorder() {
              return "\x1b[38;2;11;122;99mInherited top label\x1b[0m";
            }
            renderBottomBorder() {
              return "Inherited bottom label";
            }
          }
          let original!: HelperEditor;
          let submitted = "";
          try {
            await registry.mount(
              (tui: DesktopTui) => {
                original = new (own ? Base : HelperEditor)(
                  tui,
                  {
                    borderColor: (text: string) => text,
                    selectList: host.sdk.sdk.getSelectListTheme(),
                  },
                  ...(kind === "CustomEditor"
                    ? [runtime.keys.KeybindingsManager.create(setup.agentDir)]
                    : []),
                );
                if (own) {
                  original.renderTopBorder =
                    HelperEditor.prototype.renderTopBorder;
                  original.renderBottomBorder =
                    HelperEditor.prototype.renderBottomBorder;
                }
                original.setText("native editor");
                original.handleInput("\x1b[F");
                original.onSubmit = (text: string) => {
                  submitted = text;
                };
                tui.setFocus(original);
                return original;
              },
              "dialog",
              "helper-render",
            );
            const view = () => registry.surfaces[0].view;
            assert.equal(original.render, Base.prototype.render);
            const labels = () => additions(view());
            assert.deepEqual(
              labels().map((line) => line.text),
              ["Inherited top label", "Inherited bottom label"],
            );
            assert.equal(
              labels()[0].runs?.[0].style?.color,
              "rgb(11, 122, 99)",
            );
            const field = nodes(view()).find(
              (node) => node.kind === "textarea",
            );
            assert.ok(field?.kind === "textarea");
            await registry.input("helper-render", "!", undefined, undefined, {
              controlAction: field.action,
              controlVersion: field.controlVersion,
              controlText: field.value,
              selection: field.selection,
            });
            assert.equal(original.getText(), "native editor!");
            assert.deepEqual(
              labels().map((line) => line.text),
              ["Inherited top label", "Inherited bottom label"],
            );
            await registry.action("helper-render", {
              action: `${field.action}:submit`,
            });
            assert.equal(submitted, "native editor!");
            assert.ok(!nodes(view()).some((node) => node.kind === "terminal"));
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

test("Markdown and Box baselines retain in-place subclass cache additions without invalidating original children", async (t) => {
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
    for (const kind of ["Markdown", "Box"])
      await t.test(kind, async () => {
        const Base: new (...args: unknown[]) => PiComponent & {
          cache?: unknown;
          cachedLines?: string[];
          mouseLayout?: unknown;
          addChild(child: PiComponent): void;
        } = Reflect.get(api, kind);
        class CachedComponent extends Base {
          render(width: number): string[] {
            const lines = super.render(width);
            if (!lines.includes("Original cache annotation"))
              lines.push("Original cache annotation");
            return lines;
          }
        }
        let childInvalidations = 0;
        const child = new (Reflect.get(api, "Text"))("Original child", 0, 0);
        const invalidate = child.invalidate;
        child.invalidate = () => {
          childInvalidations++;
          invalidate.call(child);
        };
        const original =
          kind === "Box"
            ? new CachedComponent(0, 0)
            : new CachedComponent(
                "**Original markdown**",
                0,
                0,
                host.sdk.sdk.getMarkdownTheme(),
              );
        if (kind === "Box") original.addChild(child);
        try {
          await registry.mount(() => original, "dialog", "cache-render");
          const view = () => registry.surfaces[0].view;
          for (let index = 0; index < 3; index++) {
            assert.deepEqual(
              additions(view()).map((line) => line.text),
              ["Original cache annotation"],
            );
            const cache =
              kind === "Box" ? original.cache : original.cachedLines;
            const layout = original.mouseLayout;
            const childCount = childInvalidations;
            const baseline = componentRenderBaseline(
              original,
              Base.prototype,
              80,
            );
            assert.ok(!baseline.includes("Original cache annotation"));
            assert.equal(
              kind === "Box" ? original.cache : original.cachedLines,
              cache,
            );
            assert.equal(original.mouseLayout, layout);
            assert.equal(childInvalidations, childCount);
          }
          assert.equal(original.render, CachedComponent.prototype.render);
          assert.ok(!nodes(view()).some((node) => node.kind === "terminal"));
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

test("passive standard subclasses preserve replacement, removal, styled lines and original caches", async (t) => {
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
    for (const kind of ["Text", "TruncatedText", "Spacer", "DynamicBorder"]) {
      await t.test(kind, async () => {
        const Base = Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
        let disposed = 0;
        class UserComponent extends Base {
          mode = "replace";
          constructor(...args: unknown[]) {
            super(...args);
          }
          render(width: number): string[] {
            const body: string[] = super.render(width);
            if (this.mode === "restore") return body;
            if (this.mode === "remove") return [];
            const replacement = [
              `\x1b[38;2;11;122;99mReplaced ${kind}`,
              "",
              "Retained style\x1b[0m",
              "",
            ];
            if (kind === "Text") {
              body.splice(0, body.length, ...replacement);
              return body;
            }
            return replacement;
          }
          dispose() {
            disposed++;
          }
        }
        const args =
          kind === "DynamicBorder"
            ? [(text: string) => text]
            : kind === "Spacer"
              ? [2]
              : ["Original text", 0, 0];
        const original = new UserComponent(...args);
        const render = original.render;
        try {
          await registry.mount(() => original, "dialog", "replacement");
          const view = () => registry.surfaces[0].view;
          const replacement = () => view().rendered?.replacement;
          const identity = view().component;
          assert.deepEqual(
            replacement()?.map((line) => line.text),
            [`Replaced ${kind}`, "", "Retained style", ""],
          );
          assert.equal(
            replacement()?.[2].runs?.[0].style?.color,
            "rgb(11, 122, 99)",
          );
          const cache = Reflect.get(original, "cachedLines");
          assert.deepEqual(
            replacement()?.map((line) => line.text),
            [`Replaced ${kind}`, "", "Retained style", ""],
          );
          assert.equal(Reflect.get(original, "cachedLines"), cache);
          assert.equal(original.render, render);
          assert.ok(!nodes(view()).some((node) => node.kind === "terminal"));
          original.mode = "remove";
          assert.deepEqual(replacement(), []);
          assert.deepEqual(view().component, identity);
          original.mode = "restore";
          original.invalidate();
          assert.equal(replacement(), undefined);
          assert.equal(original.render, render);
          assert.deepEqual(view().component, identity);
          assert.equal(disposed, 0);
        } finally {
          registry.clearSurfaces();
        }
        assert.equal(disposed, 1);
      });
    }
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});

test("all standard component subclasses preserve added rendering, empty frames and their native component lifetime", async (t) => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  const api = await loadTuiApi();
  const runtime = await loadComponentRuntime();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const identity = (text: string) => text;
  try {
    await host.initialize(setup.cwd);
    for (const kind of mappedComponentTypes) {
      await t.test(kind, async () => {
        const Base =
          Reflect.get(api, kind) ??
          Reflect.get(host.sdk.sdk, kind) ??
          Reflect.get(runtime.preview, kind);
        let disposed = 0;
        class UserComponent extends Base {
          details = true;
          hidden = false;
          constructor(...args: unknown[]) {
            super(...args);
          }
          render(width: number): string[] {
            if (this.hidden) return [];
            const body = super.render(width);
            return this.details
              ? [
                  `\x1b[38;2;11;122;99m${kind} heading\x1b[0m`,
                  ...body,
                  `${kind} footer`,
                ]
              : body;
          }
          dispose() {
            disposed++;
            const cleanup = Reflect.get(Base.prototype, "dispose");
            if (typeof cleanup === "function") cleanup.call(this);
            else this.stop?.();
          }
        }
        let original!: UserComponent;
        const child = () =>
          new (Reflect.get(api, "Text"))("Original child", 0, 0);
        const args = (tui: DesktopTui): unknown[] => {
          switch (kind) {
            case "Input":
              return [{ prompt: "Original input" }];
            case "Editor":
            case "CustomEditor":
              return [
                tui,
                {
                  borderColor: identity,
                  selectList: host.sdk.sdk.getSelectListTheme(),
                },
                ...(kind === "CustomEditor"
                  ? [runtime.keys.KeybindingsManager.create(setup.agentDir)]
                  : []),
              ];
            case "SelectList":
              return [
                [{ value: "original", label: "Original option" }],
                3,
                host.sdk.sdk.getSelectListTheme(),
              ];
            case "SettingsList":
              return [
                [
                  {
                    id: "original",
                    label: "Original setting",
                    currentValue: "yes",
                    values: ["yes", "no"],
                  },
                ],
                3,
                host.sdk.sdk.getSettingsListTheme(),
                () => {},
                () => {},
              ];
            case "Text":
            case "TruncatedText":
              return ["Original text", 0, 0];
            case "Markdown":
              return [
                "**Original markdown**",
                0,
                0,
                host.sdk.sdk.getMarkdownTheme(),
              ];
            case "Spacer":
              return [1];
            case "Box":
              return [1, 0];
            case "HStack":
            case "VStack":
              return [[child()], { gap: 0 }];
            case "ScrollView":
              return [child()];
            case "MouseRegion":
              return [child(), () => undefined];
            case "DynamicBorder":
              return [identity];
            case "Loader":
            case "CancellableLoader":
              return [
                tui,
                identity,
                identity,
                "Original loading",
                { frames: ["*"] },
              ];
            case "BorderedLoader":
              return [
                tui,
                host.session.extensionRunner.getUIContext().theme,
                "Original loading",
              ];
            case "Image":
              return [
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
                "image/png",
                { fallbackColor: identity },
              ];
            case "VisualLinePreview":
              return [
                {
                  text: "Original preview",
                  maxVisualLines: 2,
                  keep: "start",
                  formatHint: () => "Hidden lines",
                },
              ];
            case "FooterComponent":
              return [
                host.session,
                registry.terminalRuntime.capture().application!.footerData,
              ];
            default:
              return [];
          }
        };
        try {
          await registry.mount(
            (tui: DesktopTui) => {
              original = new UserComponent(...args(tui));
              if (kind === "Container" || kind === "Box")
                original.addChild(child());
              return original;
            },
            "dialog",
            "standard-render",
          );
          const view = () => registry.surfaces[0].view;
          const rendered = () =>
            kind === "VisualLinePreview" || kind === "FooterComponent"
              ? nodes(view()).filter((node) => node.kind === "text")
              : additions(view());
          assert.equal(
            rendered().filter(
              (line) => "text" in line && line.text.includes(`${kind} heading`),
            ).length,
            1,
          );
          assert.equal(
            rendered().filter(
              (line) => "text" in line && line.text.includes(`${kind} footer`),
            ).length,
            1,
          );
          assert.ok(!nodes(view()).some((node) => node.kind === "terminal"));
          assert.equal(original.render, UserComponent.prototype.render);
          const identity = view().component;
          original.hidden = true;
          if (kind === "VisualLinePreview" || kind === "FooterComponent") {
            const hiddenView = view();
            assert.ok(hiddenView.kind === "text");
            assert.equal(hiddenView.text, "");
          } else assert.deepEqual(view().rendered?.replacement, []);
          assert.deepEqual(view().component, identity);
          assert.equal(original.render, UserComponent.prototype.render);
          assert.equal(disposed, 0);
          original.hidden = false;
          assert.equal(
            rendered().filter(
              (line) => "text" in line && line.text.includes(`${kind} heading`),
            ).length,
            1,
          );
          original.details = false;
          assert.equal(
            rendered().filter(
              (line) => "text" in line && line.text.includes(`${kind} heading`),
            ).length,
            0,
          );
          original.details = true;
          assert.equal(
            rendered().filter(
              (line) => "text" in line && line.text.includes(`${kind} heading`),
            ).length,
            1,
          );
          assert.equal(disposed, 0);
        } finally {
          registry.clearSurfaces();
        }
        assert.equal(disposed, 1);
      });
    }
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});

test("empty Input and Container frames retain original SDK editing, focus, submission and disposal", async () => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  const api = await loadTuiApi();
  let submitted = 0;
  const disposed = { root: 0, input: 0 };
  const BaseContainer: new () => PiComponent & {
    addChild(child: PiComponent): void;
  } = Reflect.get(api, "Container");
  class UserContainer extends BaseContainer {
    hidden = false;
    render(width: number) {
      return this.hidden ? [] : super.render(width);
    }
    dispose() {
      disposed.root++;
    }
  }
  class UserInput extends api.Input {
    hidden = false;
    render(width: number) {
      return this.hidden ? [] : super.render(width);
    }
    dispose() {
      disposed.input++;
    }
  }
  const root = new UserContainer();
  const original = new UserInput({ prompt: "Original SDK input" });
  root.addChild(original);
  original.setValue("Original value");
  original.handleInput("\x1b[F");
  try {
    await host.initialize(setup.cwd);
    const pending = host.session.extensionRunner
      .getUIContext()
      .custom((tui, _theme, _keys, done) => {
        original.onSubmit = (value) => {
          submitted++;
          done(value);
        };
        tui.setFocus(original);
        return root;
      });
    const surface = () =>
      host.desktopUI.surfaces.find((item) => item.slot === "dialog")!;
    await until(() => !!surface());
    const control = nodes(surface().view).find((node) => node.kind === "input");
    assert.ok(control?.kind === "input");
    const key = (key: string) =>
      host.action({
        action: "desktop.input",
        args: { surfaceId: surface().id, event: { key } },
      });
    original.hidden = true;
    assert.deepEqual(
      nodes(surface().view).find(
        (node) => node.component?.action === control.action,
      )?.rendered?.replacement,
      [],
    );
    await key("x");
    assert.equal(original.getValue(), "Original valuex");
    original.handleInput("\x1b[D");
    await key("y");
    assert.equal(original.getValue(), "Original valueyx");
    assert.ok(control.selectionAction);
    await host.action({
      action: "desktop.action",
      args: {
        id: surface().id,
        instanceId: surface().instanceId,
        action: control.selectionAction,
        value: { start: 1, end: 4 },
      },
    });
    root.hidden = true;
    assert.deepEqual(surface().view.rendered?.replacement, []);
    original.setValue("SDK hidden value");
    original.handleInput("\x1b[F");
    assert.equal(Reflect.get(original, "cursor"), "SDK hidden value".length);
    await key("!");
    assert.equal(original.getValue(), "SDK hidden value!");
    assert.deepEqual(disposed, { root: 0, input: 0 });
    original.hidden = false;
    root.hidden = false;
    const restored = nodes(surface().view).find(
      (node) => node.kind === "input",
    );
    assert.ok(restored?.kind === "input");
    assert.equal(restored.value, "SDK hidden value!");
    assert.equal(original.render, UserInput.prototype.render);
    assert.equal(root.render, UserContainer.prototype.render);
    root.hidden = true;
    await key("Enter");
    assert.equal(await pending, "SDK hidden value!");
    assert.equal(submitted, 1);
    assert.deepEqual(disposed, { root: 1, input: 1 });
  } finally {
    await host.dispose();
    await setup.close();
  }
});

test("hidden Editor and CustomEditor SDK mutations supersede earlier desktop ranges", async (t) => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  const api = await loadTuiApi();
  const runtime = await loadComponentRuntime();
  try {
    await host.initialize(setup.cwd);
    for (const kind of ["Editor", "CustomEditor"]) {
      await t.test(kind, async () => {
        const Base: new (...args: unknown[]) => PiComponent & {
          getText(): string;
          setText(text: string): void;
          handleInput(data: string): void;
          onSubmit?: (value: string) => void;
        } = Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
        let disposed = 0,
          submitted = 0;
        class UserEditor extends Base {
          hidden = false;
          render(width: number) {
            return this.hidden ? [] : super.render(width);
          }
          dispose() {
            disposed++;
          }
        }
        let original!: UserEditor;
        const pending = host.session.extensionRunner
          .getUIContext()
          .custom((tui, _theme, _keys, done) => {
            original = new UserEditor(
              tui,
              {
                borderColor: (text: string) => text,
                selectList: host.sdk.sdk.getSelectListTheme(),
              },
              ...(kind === "CustomEditor"
                ? [runtime.keys.KeybindingsManager.create(setup.agentDir)]
                : []),
            );
            original.setText("Original");
            original.handleInput("\x1b[F");
            original.onSubmit = (value) => {
              submitted++;
              done(value);
            };
            tui.setFocus(original);
            return original;
          });
        const surface = () =>
          host.desktopUI.surfaces.find((item) => item.slot === "dialog")!;
        await until(() => !!surface());
        const control = nodes(surface().view).find(
          (node) => node.kind === "textarea",
        );
        assert.ok(control?.kind === "textarea");
        const key = (key: string) =>
          host.action({
            action: "desktop.input",
            args: { surfaceId: surface().id, event: { key } },
          });
        original.hidden = true;
        assert.deepEqual(surface().view.rendered?.replacement, []);
        await key("x");
        original.handleInput("\x1b[D");
        await key("y");
        assert.equal(original.getText(), "Originalyx");
        assert.ok(control.selectionAction);
        await host.action({
          action: "desktop.action",
          args: {
            id: surface().id,
            instanceId: surface().instanceId,
            action: control.selectionAction,
            value: { start: 1, end: 4 },
          },
        });
        original.setText("SDK hidden value");
        original.handleInput("\x1b[F");
        await key("!");
        assert.equal(original.getText(), "SDK hidden value!");
        original.hidden = false;
        const restored = nodes(surface().view).find(
          (node) => node.kind === "textarea",
        );
        assert.ok(restored?.kind === "textarea");
        assert.equal(restored.value, "SDK hidden value!");
        assert.equal(original.render, UserEditor.prototype.render);
        assert.equal(disposed, 0);
        original.hidden = true;
        await key("Enter");
        assert.equal(await pending, "SDK hidden value!");
        assert.equal(submitted, 1);
        assert.equal(disposed, 1);
      });
    }
  } finally {
    await host.dispose();
    await setup.close();
  }
});

test("ordinary renamed Input subclasses retain rendered labels, style, original submission and disposal", async () => {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  const api = await loadTuiApi();
  let disposed = 0,
    submitted = 0;
  class RenamedInput extends api.Input {
    render(width: number) {
      return [
        "\x1b[38;2;11;122;99mBefore native input\x1b[0m",
        ...super.render(width),
        `After native input: ${this.getValue()}`,
      ];
    }
    dispose() {
      disposed++;
    }
  }
  const original = new RenamedInput({ prompt: "Rendered input" });
  const render = original.render;
  try {
    await host.initialize(setup.cwd);
    const pending = host.session.extensionRunner
      .getUIContext()
      .custom((_tui, _theme, _keys, done) => {
        original.onSubmit = (value) => {
          submitted++;
          done(value);
        };
        return original;
      });
    const surface = () =>
      host.desktopUI.surfaces.find((item) => item.slot === "dialog")!;
    await until(() => !!surface());
    const control = nodes(surface().view).find((node) => node.kind === "input");
    assert.ok(control?.kind === "input");
    assert.equal(additions(surface().view)[0].text, "Before native input");
    assert.equal(
      additions(surface().view)[0].runs?.[0].style?.color,
      "rgb(11, 122, 99)",
    );
    await host.action({
      action: "desktop.action",
      args: {
        id: surface().id,
        instanceId: surface().instanceId,
        action: control.action,
        value: "Kept result",
      },
    });
    assert.equal(
      additions(surface().view).at(-1)?.text,
      "After native input: Kept result",
    );
    assert.equal(original.render, render);
    assert.equal(original.getValue(), "Kept result");
    await host.action({
      action: "desktop.action",
      args: {
        id: surface().id,
        instanceId: surface().instanceId,
        action: `${control.action}:submit`,
      },
    });
    assert.equal(await pending, "Kept result");
    assert.equal(submitted, 1);
    assert.equal(disposed, 1);
  } finally {
    await host.dispose();
    await setup.close();
  }
});

test("unchanged official modal editor renders native mode labels without a legacy adapter", async () => {
  const setup = await createFixture({ officialEditor: true });
  const host = new DesktopHost(setup.agentDir);
  try {
    await host.initialize(setup.cwd);
    const surface = () =>
      host.desktopUI.surfaces.find((item) => item.slot === "editor")!;
    await until(
      () =>
        !!surface() &&
        additions(surface().view).some((line) => line.text === "INSERT"),
    );
    const control = nodes(surface().view).find(
      (node) => node.kind === "textarea",
    );
    assert.ok(control?.kind === "textarea");
    host.session.extensionRunner.getUIContext().setEditorText("abcdef");
    const input = (key: string) =>
      host.action({
        action: "desktop.input",
        args: { surfaceId: "editor", event: { key } },
      });
    await input("Escape");
    assert.equal(additions(surface().view).at(-1)?.text, "NORMAL");
    await input("h");
    await input("x");
    assert.equal(
      host.session.extensionRunner.getUIContext().getEditorText(),
      "abcde",
    );
    await input("i");
    assert.equal(additions(surface().view).at(-1)?.text, "INSERT");
    const current = nodes(surface().view).find(
      (node) => node.kind === "textarea",
    );
    assert.ok(current?.kind === "textarea");
    assert.equal(current.action, control.action);
    assert.ok(!nodes(surface().view).some((node) => node.kind === "terminal"));
  } finally {
    await host.dispose();
    await setup.close();
  }
});

test("unchanged official border-status editor preserves its rendered model and context", async () => {
  const setup = await createFixture();
  await cp(
    join(getPackageDir(), "examples", "extensions", "border-status-editor.ts"),
    join(setup.agentDir, "extensions", "renamed-border-extension.ts"),
  );
  const host = new DesktopHost(setup.agentDir);
  try {
    await host.initialize(setup.cwd);
    const surface = () =>
      host.desktopUI.surfaces.find((item) => item.slot === "editor")!;
    await until(
      () =>
        !!surface() &&
        additions(surface().view).some((line) =>
          line.text.includes("desktop-test/desktop-test"),
        ),
    );
    assert.ok(
      additions(surface().view).some((line) => line.text.includes("workspace")),
    );
    assert.ok(nodes(surface().view).some((node) => node.kind === "textarea"));
    assert.ok(!nodes(surface().view).some((node) => node.kind === "terminal"));
  } finally {
    await host.dispose();
    await setup.close();
  }
});
