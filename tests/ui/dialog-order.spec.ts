import { test } from "@playwright/test";
import { verifyDialogOrder } from "../dialog-order-workflow.ts";

for (const width of [1440, 390]) {
  test(`dialog confirmation follows pending text input at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyDialogOrder(page);
  });
}
