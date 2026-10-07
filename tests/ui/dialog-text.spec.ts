import { test } from "@playwright/test";
import { verifyDialogText } from "../dialog-workflows.ts";

for (const width of [1440, 390]) {
  test(`standard dialog text preserves styles and original option identity at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyDialogText(page);
  });
}
