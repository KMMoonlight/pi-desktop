import { test } from "@playwright/test";
import { verifySelectionShortcuts } from "../selection-shortcut-workflows.ts";
for (const width of [1440, 390]) {
  test(`original extension selection shortcuts retain handler edits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifySelectionShortcuts(page);
  });
}
