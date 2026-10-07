import { test } from "@playwright/test";
import { verifyToolShell } from "../tool-shell-workflows.ts";

for (const width of [1440, 390])
  test(`original tool shell, fallback and receiver semantics at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyToolShell(page, `.local/screenshots/tool-shell-${width}.png`);
  });
