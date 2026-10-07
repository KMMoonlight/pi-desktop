import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import {
  loadComponentRuntime,
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

test("horizontal gaps and whole-frame additions preserve original drawing and transformed child ownership", async (t) => {
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
    for (const width of [32, 80])
      for (const align of ["start", "center", "end"])
        for (const nested of [false, true])
          for (const fill of [false, true])
            for (const framed of [false, true])
              for (const transform of ["none", "left", "both"])
                await t.test(
                  `${width}/${align}/nested:${nested}/fill:${fill}/framed:${framed}/transform:${transform}`,
                  async () => {
                    registry.setViewport(width, 40);
                    const Stack = Reflect.get(api, "HStack");
                    const Box = Reflect.get(api, "Box");
                    const Text = Reflect.get(api, "Text");
                    const composite = Reflect.get(api, "compositeTuiLine");
                    let mode = "text",
                      disposed = 0,
                      submitted = "";
                    class GapStack extends Stack {
                      constructor(...args: unknown[]) {
                        super(...args);
                      }
                      render(columns: number): string[] {
                        let lines: string[] = super.render(columns);
                        if (mode === "normal") return lines;
                        const widths = runtime.stack.allocateStackSizes(
                          this.entries,
                          this.entries.map(
                            (entry: { component: PiComponent }) =>
                              entry.component
                                .render(columns)
                                .reduce(
                                  (max, line) =>
                                    Math.max(max, api.visibleWidth(line)),
                                  0,
                                ),
                          ),
                          columns,
                          this.gap,
                        );
                        if (transform !== "none")
                          lines = lines.map((line, row) =>
                            composite(
                              line,
                              `Hidden ${row}`,
                              0,
                              widths[0],
                              columns,
                            ),
                          );
                        if (transform === "both")
                          lines = lines.map((line, row) =>
                            composite(
                              line,
                              `Masked ${row}`,
                              widths[0] + widths[1] + this.gap * 2,
                              widths[2],
                              columns,
                            ),
                          );
                        const regions: {
                          x: number;
                          columns: number;
                          label: string[];
                        }[] = [];
                        let x = 0;
                        for (let index = 0; index < widths.length; index++) {
                          x += widths[index];
                          if (index < widths.length - 1) {
                            regions.push({
                              x,
                              columns: this.gap,
                              label:
                                index === 0
                                  ? ["A\u754c", "B", "C"]
                                  : ["X", "Y", "Z"],
                            });
                            x += this.gap;
                          }
                        }
                        if (x < columns)
                          regions.push({
                            x,
                            columns: columns - x,
                            label: ["END", "END", "END"],
                          });
                        for (const [index, region] of regions.entries()) {
                          if (mode === "first" && index > 0) continue;
                          lines = lines.map((line, row) =>
                            composite(
                              line,
                              mode === "background"
                                ? `\x1b[48;2;201;225;239m${" ".repeat(region.columns)}\x1b[0m`
                                : `\x1b]8;;https://example.com/gap\x1b\\\x1b[38;2;11;122;99m${region.label[row] ?? ""}\x1b[0m\x1b]8;;\x1b\\`,
                              region.x,
                              region.columns,
                              columns,
                            ),
                          );
                        }
                        return framed
                          ? [
                              "\x1b[38;2;73;85;191mFrame title\x1b[0m",
                              "Top note",
                              ...lines,
                              "Frame ending",
                            ]
                          : lines;
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
                              .replace("A", "D")
                              .replace("Frame title", "Frame caption")
                              .replace("Frame ending", "Frame footer"),
                          );
                      }
                    }
                    const left = new api.Input({ prompt: "Left" });
                    left.setValue("one");
                    left.onSubmit = (value) => {
                      submitted = value;
                    };
                    const right = new api.Input({ prompt: "Right" });
                    right.setValue("two");
                    const middle = new Text("p\nq\nr", 0, 0);
                    const original = new GapStack([], { gap: 4, align });
                    original.addChild(
                      left,
                      fill ? { basis: 0, grow: 1 } : { basis: 8 },
                    );
                    original.addChild(middle, { basis: 3 });
                    original.addChild(
                      right,
                      fill ? { basis: 0, grow: 1 } : { basis: 8 },
                    );
                    const outer = nested ? new Outer(1, 1) : undefined;
                    outer?.addChild(original);
                    for (const component of [
                      left,
                      middle,
                      right,
                      original,
                      ...(outer ? [outer] : []),
                    ])
                      Reflect.set(component, "dispose", () => {
                        disposed++;
                      });
                    const render = original.render;
                    try {
                      await registry.mount(
                        (tui: DesktopTui) => {
                          tui.setFocus(left);
                          return outer ?? original;
                        },
                        "dialog",
                        "horizontal-gap",
                      );
                      const view = () => registry.surfaces[0].view;
                      const gaps = () =>
                        nodes(view()).flatMap(
                          (node) =>
                            node.rendered?.composition?.filter(
                              (part) => "lines" in part,
                            ) ?? [],
                        );
                      const controls = () =>
                        nodes(view()).filter(
                          (
                            node,
                          ): node is Extract<
                            DesktopNode,
                            { kind: "input" | "textarea" }
                          > => node.kind === "input",
                        );
                      const decoration = (position: "before" | "after") =>
                        nodes(view()).flatMap(
                          (node) => node.rendered?.[position] ?? [],
                        );
                      const frame = () => {
                        assert.deepEqual(
                          decoration("before").map((line) => line.text.trim()),
                          framed
                            ? [
                                nested ? "Frame caption" : "Frame title",
                                "Top note",
                              ]
                            : [],
                        );
                        assert.deepEqual(
                          decoration("after").map((line) => line.text.trim()),
                          framed
                            ? [nested ? "Frame footer" : "Frame ending"]
                            : [],
                        );
                        if (framed)
                          assert.equal(
                            decoration("before")[0].runs?.[0].style?.color,
                            "rgb(73, 85, 191)",
                          );
                      };
                      const identities = controls().map((node) => node.action);
                      const expectedCount = fill ? 2 : 3;
                      assert.equal(
                        gaps().length,
                        expectedCount,
                        "drawing outside child rectangles must remain visible",
                      );
                      const first = gaps()[0];
                      assert.ok("lines" in first);
                      assert.deepEqual(
                        first.lines.map((line) => line.text.trim()),
                        [nested ? "D\u754c" : "A\u754c", "B", "C"],
                      );
                      assert.equal(
                        first.lines[0].runs?.[0].style?.color,
                        "rgb(11, 122, 99)",
                      );
                      assert.equal(
                        first.lines[0].runs?.[0].href,
                        "https://example.com/gap",
                      );
                      assert.deepEqual(
                        controls().map((node) => node.value),
                        ["one", "two"],
                      );
                      assert.ok(
                        !nodes(view()).some((node) => node.kind === "terminal"),
                      );
                      const transformed = () =>
                        nodes(view()).filter((node) => node.rendered?.control);
                      assert.equal(
                        transformed().length,
                        transform === "none" ? 0 : transform === "left" ? 1 : 2,
                      );
                      for (const node of transformed()) {
                        assert.equal(
                          node.rendered?.control?.action,
                          controls().find(
                            (field) =>
                              field.label === node.rendered?.control?.label,
                          )?.action,
                        );
                        const text = node.rendered?.replacement
                          ?.map((line) => line.text)
                          .join("\n");
                        assert.ok(
                          text?.includes(
                            node.rendered?.control?.label === "Left"
                              ? "Hidden"
                              : "Masked",
                          ),
                        );
                        assert.ok(!text?.includes("Frame"));
                      }
                      frame();
                      mode = "first";
                      await registry.input("horizontal-gap", "");
                      assert.equal(gaps().length, expectedCount);
                      for (const gap of gaps().slice(1)) {
                        assert.ok("lines" in gap);
                        assert.ok(
                          gap.lines.every(
                            (line) => !line.text.trim() && !line.runs,
                          ),
                        );
                      }
                      assert.deepEqual(
                        controls().map((node) => node.action),
                        identities,
                      );
                      frame();
                      mode = "background";
                      await registry.input("horizontal-gap", "");
                      assert.equal(gaps().length, expectedCount);
                      for (const gap of gaps()) {
                        assert.ok("lines" in gap);
                        assert.ok(gap.lines.every((line) => !line.text.trim()));
                        assert.equal(
                          gap.lines[0].runs?.[0].style?.backgroundColor,
                          "rgb(201, 225, 239)",
                        );
                      }
                      assert.deepEqual(
                        controls().map((node) => node.action),
                        identities,
                      );
                      frame();
                      if (transform !== "none") {
                        await registry.input(
                          "horizontal-gap",
                          "x",
                          undefined,
                          undefined,
                          {
                            controlAction: identities[0],
                            raw: true,
                          },
                        );
                        assert.equal(left.getValue(), "xone");
                        assert.equal(right.getValue(), "two");
                        if (transform === "both") {
                          await registry.input(
                            "horizontal-gap",
                            "y",
                            undefined,
                            undefined,
                            {
                              controlAction: identities[1],
                              raw: true,
                            },
                          );
                          assert.equal(right.getValue(), "ytwo");
                          assert.equal(left.getValue(), "xone");
                          right.setValue("two");
                        }
                      }
                      left.setValue("SDK");
                      await registry.input(
                        "horizontal-gap",
                        "\r",
                        undefined,
                        undefined,
                        {
                          controlAction: identities[0],
                          raw: true,
                        },
                      );
                      assert.equal(submitted, "SDK");
                      assert.equal(right.getValue(), "two");
                      mode = "normal";
                      await registry.input("horizontal-gap", "");
                      assert.equal(gaps().length, 0);
                      assert.equal(decoration("before").length, 0);
                      assert.equal(decoration("after").length, 0);
                      assert.equal(transformed().length, 0);
                      assert.deepEqual(
                        controls().map((node) => node.action),
                        identities,
                      );
                      assert.deepEqual(
                        controls().map((node) => node.value),
                        ["SDK", "two"],
                      );
                      mode = "text";
                      await registry.input("horizontal-gap", "");
                      assert.equal(gaps().length, expectedCount);
                      frame();
                      assert.equal(original.render, render);
                      assert.equal(disposed, 0);
                    } finally {
                      registry.clearSurfaces();
                    }
                    assert.equal(disposed, nested ? 5 : 4);
                  },
                );
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await setup.close();
  }
});
