import { test } from "@playwright/test";
import { verifyTerminalDescendant } from "../terminal-descendant-workflows.ts";

for (const width of [1440, 390]) {
  for (const mode of ["multiple", "width", "locked", "closure"])
    for (const kind of [
      "Input",
      "Editor",
      "CustomEditor",
      "SelectList",
      "SettingsList",
    ])
      test(`opaque ${mode}/${kind} preserves original focus through xterm at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 940 });
        await page.goto("/");
        await verifyTerminalDescendant(
          page,
          kind,
          mode,
          `.local/screenshots/terminal-descendant-${mode}-${kind}-${width}.png`,
        );
      });
  for (const mode of ["owner", "regions"])
    test(`opaque ${mode} preserves original keyboard ownership at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyTerminalDescendant(
        page,
        "Input",
        mode,
        `.local/screenshots/terminal-descendant-${mode}-${width}.png`,
      );
    });
}
