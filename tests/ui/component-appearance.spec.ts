import { test } from "@playwright/test";
import { verifyComponentAppearance } from "../component-appearance-workflows.ts";

for (const width of [1440, 390]) {
  test(`original component appearance APIs reach desktop controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyComponentAppearance(
      page,
      `.local/screenshots/component-appearance-${width}.png`,
    );
  });
}
