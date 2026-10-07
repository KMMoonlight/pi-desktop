import { test } from "@playwright/test";
import { verifyThinkingLabel } from "../message-presentation-workflows.ts";

for (const width of [1440, 390]) {
  test(`hidden thinking label preserves styling, empty labels and reset at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyThinkingLabel(page);
  });
}
