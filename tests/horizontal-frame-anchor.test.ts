import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
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

test("complete column agreement takes precedence over a matching heading column", async (t) => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  const registry = new DesktopUIRegistry(
    () => host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  try {
    await host.initialize(fixture.cwd);
    for (const width of [32, 80])
      for (const align of ["start", "center", "end"])
        await t.test(`${width}/${align}`, async () => {
          registry.setViewport(width, 40);
          const Stack = Reflect.get(api, "HStack");
          const Text = Reflect.get(api, "Text");
          const composite = Reflect.get(api, "compositeTuiLine");
          const left = new Text("first\nsecond\nthird", 0, 0);
          const middle = new Text("p\nq\nr", 0, 0);
          const right = new api.Input({ prompt: "Peer" });
          right.setValue("peer");
          let submitted = "",
            disposed = 0;
          right.onSubmit = (value) => {
            submitted = value;
          };
          class Framed extends Stack {
            constructor(...args: unknown[]) {
              super(...args);
            }
            render(columns: number): string[] {
              const body: string[] = super.render(columns);
              return [
                ...left.render(8),
                ...body.map((line, row) =>
                  composite(line, ["G", "H", "I"][row], 8, 4, columns),
                ),
                "Ending",
              ];
            }
          }
          const stack = new Framed([], { gap: 4, align });
          stack.addChild(left, { basis: 8 });
          stack.addChild(middle, { basis: 3 });
          stack.addChild(right, { basis: 8 });
          for (const component of [stack, left, middle, right])
            Reflect.set(component, "dispose", () => disposed++);
          try {
            await registry.mount(
              (tui: DesktopTui) => {
                tui.setFocus(right);
                return stack;
              },
              "dialog",
              "heading-anchor",
            );
            const tree = () => nodes(registry.surfaces[0].view);
            assert.deepEqual(
              tree()
                .flatMap((node) => node.rendered?.before ?? [])
                .map((line) => line.text.trim()),
              ["first", "second", "third"],
            );
            assert.deepEqual(
              tree()
                .flatMap((node) => node.rendered?.after ?? [])
                .map((line) => line.text.trim()),
              ["Ending"],
            );
            assert.ok(
              !tree().some(
                (node) => node.rendered?.control || node.kind === "terminal",
              ),
            );
            const peer = tree().find((node) => node.kind === "input");
            assert.ok(peer?.kind === "input");
            assert.equal(peer.value, "peer");
            const gaps = tree()
              .flatMap((node) => node.rendered?.composition ?? [])
              .filter((part) => "lines" in part);
            assert.deepEqual(
              gaps[0].lines.map((line) => line.text.trim()),
              ["G", "H", "I"],
            );
            right.setValue("SDK");
            await registry.input("heading-anchor", "\r");
            assert.equal(submitted, "SDK");
            assert.equal(
              tree().find((node) => node.kind === "input")?.component?.action,
              peer.component?.action,
            );
            assert.equal(disposed, 0);
          } finally {
            registry.clearSurfaces();
          }
          assert.equal(disposed, 4);
        });
  } finally {
    registry.clearSurfaces();
    await host.dispose();
    await fixture.close();
  }
});
