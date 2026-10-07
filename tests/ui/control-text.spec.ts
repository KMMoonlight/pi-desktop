import { test } from "@playwright/test";
import { verifyControlText } from "../control-text-workflows.ts";

for (const width of [1440, 390]) {
  test(`generic controls preserve themed labels, source values, placeholders and descriptions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyControlText(
      page,
      `.local/screenshots/control-text-${width}.png`,
    );
  });
}
