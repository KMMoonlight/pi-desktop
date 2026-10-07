import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import type { PiComponent } from "../backend/component-runtime.ts";
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

test("horizontal body height changes retain external frames and original interactive controls", async (t) => {
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
    for (const align of ["start", "center", "end"])
      for (const nested of [false, true])
        for (const height of ["insert", "cut"])
          for (const kind of [
            "Input",
            "Editor",
            "CustomEditor",
            "SelectList",
            "SettingsList",
          ])
            await t.test(
              `${align}/nested:${nested}/${height}/${kind}`,
              async () => {
                registry.setViewport(80, 40);
                const Stack = Reflect.get(api, "HStack");
                const Box = Reflect.get(api, "Box");
                const Text = Reflect.get(api, "Text");
                const Base =
                  Reflect.get(api, kind) ?? Reflect.get(host.sdk.sdk, kind);
                const composite = Reflect.get(api, "compositeTuiLine");
                let mode = height,
                  disposed = 0,
                  submitted = "";
                const changes: string[] = [];
                let field: PiComponent;
                class Resized extends Stack {
                  constructor(...args: unknown[]) {
                    super(...args);
                  }
                  render(columns: number): string[] {
                    let body: string[] = super.render(columns);
                    if (mode === "normal") return body;
                    body = body.map((line, row) =>
                      composite(line, `Hidden ${row}`, 0, 18, columns),
                    );
                    const middle = Math.floor(body.length / 2);
                    if (mode === "insert")
                      body.splice(middle, 0, " ".repeat(columns));
                    else body.splice(middle, 1);
                    body = body.map((line, row) =>
                      composite(
                        line,
                        `\x1b[38;2;11;122;99mG${row}\x1b[0m`,
                        18,
                        4,
                        columns,
                      ),
                    );
                    return ["Frame heading", ...body, "Frame footer"];
                  }
                }
                class Outer extends Box {
                  constructor(...args: unknown[]) {
                    super(...args);
                  }
                  render(columns: number): string[] {
                    return super
                      .render(columns)
                      .map((line: string) =>
                        line
                          .replace("Frame heading", "Enclosing heading")
                          .replace("Frame footer", "Enclosing footer")
                          .replace("G", "D"),
                      );
                  }
                }
                await registry.mount(
                  (tui: DesktopTui, _theme: unknown, keys: unknown) => {
                    if (kind === "SelectList") {
                      field = new Base(
                        [
                          { value: "alpha", label: "Alpha" },
                          { value: "beta", label: "Beta" },
                        ],
                        3,
                        theme,
                      );
                      Reflect.set(
                        field,
                        "onSelect",
                        (item: { value: string }) => {
                          submitted = item.value;
                        },
                      );
                    } else if (kind === "SettingsList") {
                      field = new Base(
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
                          changes.push(`${id}:${value}`),
                        () => {},
                        { enableSearch: true },
                      );
                    } else {
                      field =
                        kind === "Input"
                          ? new Base({ prompt: "Resized field" })
                          : new Base(
                              tui,
                              { borderColor: identity, selectList: theme },
                              ...(kind === "CustomEditor" ? [keys] : []),
                            );
                      (
                        Reflect.get(field, "setText") ??
                        Reflect.get(field, "setValue")
                      ).call(field, "original value");
                      Reflect.set(field, "onSubmit", (value: string) => {
                        submitted = value;
                      });
                    }
                    const anchor = new Text("p\nq\nr\ns\nt\nu\nv\nw", 0, 0);
                    const sibling = new api.Input({ prompt: "Other field" });
                    sibling.setValue("Sibling value");
                    const stack = new Resized([], { gap: 4, align });
                    stack.addChild(field, { basis: 18 });
                    stack.addChild(anchor, { basis: 3 });
                    stack.addChild(sibling, { basis: 16 });
                    const outer = nested ? new Outer(1, 1) : undefined;
                    outer?.addChild(stack);
                    for (const component of [
                      field,
                      anchor,
                      sibling,
                      stack,
                      ...(outer ? [outer] : []),
                    ])
                      Reflect.set(component, "dispose", () => disposed++);
                    tui.setFocus(field);
                    return outer ?? stack;
                  },
                  "dialog",
                  "horizontal-height",
                );
                try {
                  const tree = () => nodes(registry.surfaces[0].view);
                  const control = () =>
                    tree().find((node) => node.rendered?.control);
                  assert.ok(
                    control()?.rendered?.control,
                    "changed columns retain original input ownership",
                  );
                  const action = control()!.rendered!.control!.action;
                  const drawing = tree().flatMap(
                    (node) =>
                      node.rendered?.composition?.filter(
                        (part) => "lines" in part,
                      ) ?? [],
                  );
                  assert.equal(
                    drawing[0].lines.length,
                    height === "insert" ? 9 : 7,
                    "gap rows follow the actual body height",
                  );
                  assert.deepEqual(
                    drawing[0].lines.map((line) => line.text.trim()),
                    Array.from(
                      { length: height === "insert" ? 9 : 7 },
                      (_, row) => `${nested ? "D" : "G"}${row}`,
                    ),
                  );
                  assert.ok(
                    drawing[0].lines.every(
                      (line) =>
                        line.runs?.[0].style?.color === "rgb(11, 122, 99)",
                    ),
                  );
                  assert.deepEqual(
                    tree()
                      .flatMap((node) => node.rendered?.before ?? [])
                      .map((line) => line.text.trim()),
                    [nested ? "Enclosing heading" : "Frame heading"],
                  );
                  assert.deepEqual(
                    tree()
                      .flatMap((node) => node.rendered?.after ?? [])
                      .map((line) => line.text.trim()),
                    [nested ? "Enclosing footer" : "Frame footer"],
                  );
                  assert.equal(
                    control()?.rendered?.replacement?.length,
                    height === "insert" ? 9 : 7,
                  );
                  assert.ok(
                    !control()?.rendered?.replacement?.some((line) =>
                      /Frame|Enclosing/.test(line.text),
                    ),
                  );
                  assert.ok(
                    tree().some(
                      (node) =>
                        node.kind === "input" &&
                        node.label === "Other field" &&
                        node.value === "Sibling value",
                    ),
                  );
                  assert.ok(!tree().some((node) => node.kind === "terminal"));
                  const input = (data: string) =>
                    registry.input(
                      "horizontal-height",
                      data,
                      undefined,
                      undefined,
                      { controlAction: action, raw: true },
                    );
                  if (["Input", "Editor", "CustomEditor"].includes(kind)) {
                    await input("\x01");
                    await input("!");
                    await input("\r");
                    assert.ok(submitted.includes("original value"));
                    (
                      Reflect.get(field!, "setText") ??
                      Reflect.get(field!, "setValue")
                    ).call(field!, "SDK update");
                  } else {
                    await input("\x1b[B");
                    await input("\r");
                    if (kind === "SelectList") assert.equal(submitted, "beta");
                    else assert.deepEqual(changes, ["beta:on"]);
                  }
                  mode = "normal";
                  await registry.input("horizontal-height", "");
                  assert.equal(control(), undefined);
                  assert.equal(disposed, 0);
                  if (["Input", "Editor", "CustomEditor"].includes(kind))
                    assert.ok(
                      tree().some(
                        (node) =>
                          (node.kind === "input" || node.kind === "textarea") &&
                          node.value === "SDK update",
                      ),
                    );
                } finally {
                  registry.clearSurfaces();
                }
                assert.equal(disposed, nested ? 5 : 4);
              },
            );
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await fixture.close();
  }
});
