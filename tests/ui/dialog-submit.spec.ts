import { test } from "@playwright/test";
import { verifyDialogSubmission } from "../dialog-submit-workflow.ts";

for (const width of [1440, 390]) {
  test(`standard editor submission retains Pi rules at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyDialogSubmission(page);
  });
}
