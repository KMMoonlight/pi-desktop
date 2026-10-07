import { test } from "@playwright/test";
import { verifyDialogKeyboard } from "../dialog-keyboard-workflow.ts";

for (const width of [1440, 390]) {
  test(`standard dialogs submit and navigate with Pi keys at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyDialogKeyboard(page);
  });
}
