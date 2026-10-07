import { test } from "@playwright/test";
import { verifyWorkingIndicator } from "../message-presentation-workflows.ts";

for (const width of [1440, 390]) {
  test(`working indicator frames and message retain Pi styles at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyWorkingIndicator(page);
  });
}
