import { test } from "@playwright/test";
import { verifyEditorConfig } from "../editor-config-workflows.ts";

for (const width of [1440, 390]) {
  test(`Pi Editor live padding and submission settings at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyEditorConfig(
      page,
      `.local/screenshots/editor-config-${width}.png`,
    );
  });
}
