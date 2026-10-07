import { test } from "@playwright/test";
import { verifyStackSizes } from "../stack-size-workflows.ts";
for (const width of [1440, 390]) {
  test(`Pi zero-size stack entries hide controls and retain original instances at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyStackSizes(page, `.local/screenshots/stack-sizes-${width}.png`);
  });
}
