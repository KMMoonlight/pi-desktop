import { test } from "@playwright/test";
import { verifyComponentDelegation } from "../component-delegation-workflows.ts";

for (const width of [1440, 390]) {
  test(`transparent Pi composition uses desktop controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyComponentDelegation(
      page,
      `Original callback ${width}`,
      `.local/screenshots/component-delegation-${width}.png`,
    );
  });
}
