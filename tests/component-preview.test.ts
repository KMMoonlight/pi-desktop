import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { loadComponentRuntime } from "../backend/component-runtime.ts";
import { createFixture } from "./fixture.ts";

test("Pi visual previews retain start/end truncation, styles, resize and invalidation", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const { preview } = await loadComponentRuntime();
    for (const keep of ["start", "end"] as const) {
      const options = {
        text: "\x1b[31mfirst\nsecond\nthird\nfourth\x1b[0m",
        maxVisualLines: 2,
        keep,
        formatHint: (hidden: number) => `${hidden} hidden`,
      };
      const original = new preview.VisualLinePreview(options);
      host.desktopUI.setViewport(40, 30);
      await host.desktopUI.mount(original, "tool", "preview");
      const view = () => {
        const node = host.desktopUI.surfaces.find(
          (surface) => surface.id === "preview",
        )!.view;
        assert.ok(node.kind === "text");
        return node;
      };
      assert.deepEqual(
        view()
          .text.split("\n")
          .map((line) => line.trimEnd()),
        keep === "start"
          ? ["first", "second", "2 hidden"]
          : ["2 hidden", "third", "fourth"],
      );
      assert.ok(view().runs?.some((run) => run.style?.color));
      options.text = "abcdefghij".repeat(4);
      original.invalidate();
      host.desktopUI.setViewport(10, 30);
      assert.match(view().text, /2 hidden/);
      host.desktopUI.setViewport(40, 30);
      assert.equal(view().text.trimEnd(), options.text);
      options.text = "updated";
      original.invalidate();
      assert.equal(view().text.trimEnd(), "updated");
      host.desktopUI.close("preview");
    }
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
