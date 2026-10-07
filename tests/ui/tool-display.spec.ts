import { test } from "@playwright/test";
import { verifyToolDisplay } from "../tool-display-workflows.ts";
for (const width of [1440, 390])
  test(`tool composition and independent expansion at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyToolDisplay(
      page,
      `.local/screenshots/tool-display-${width}.png`,
    );
  });
