import { test } from "@playwright/test";
import { verifyDialogPaste } from "../dialog-paste-workflow.ts";

for (const width of [1440, 390]) {
  test(`standard dialogs preserve Pi paste semantics at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyDialogPaste(page);
  });
}
