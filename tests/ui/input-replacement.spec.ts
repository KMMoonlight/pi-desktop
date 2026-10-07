import { test } from "@playwright/test";
import { verifyMultilineReplacement } from "../input-replacement-workflows.ts";

for (const width of [1440, 390]) {
  test(`mapped editor multiline replacement preserves selection, lines and undo at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyMultilineReplacement(
      page,
      `.local/screenshots/input-replacement-${width}.png`,
    );
  });
}
