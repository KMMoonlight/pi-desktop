import { test } from "@playwright/test";
import { verifyDialogTimeout } from "../dialog-workflows.ts";

for (const width of [1440, 390]) {
  test(`dialog deadlines count down, expire and preserve non-positive timeouts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyDialogTimeout(page);
  });
}
