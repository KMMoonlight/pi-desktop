import { test } from "@playwright/test";
import { verifyComponentImage } from "../component-image-workflows.ts";

for (const width of [1440, 390]) {
  test(`Pi Image sizes, fallback themes and source recovery at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyComponentImage(
      page,
      `.local/screenshots/component-image-${width}.png`,
    );
  });
}
