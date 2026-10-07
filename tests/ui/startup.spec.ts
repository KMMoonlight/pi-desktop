import { test } from "@playwright/test";
import { startupModes, verifyStartup } from "../startup-workflows.ts";
for (const width of [1440, 390])
  for (const mode of startupModes)
    test(`original startup ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyStartup(
        page,
        mode,
        `.local/screenshots/startup-${mode}-${width}.png`,
      );
    });
