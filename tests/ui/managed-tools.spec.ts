import { test } from "@playwright/test";
import {
  managedToolModes,
  verifyManagedTools,
} from "../managed-tools-workflows.ts";
for (const width of [1440, 390])
  for (const mode of managedToolModes)
    test(`original managed tools ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyManagedTools(
        page,
        mode,
        `.local/screenshots/managed-tools-${mode}-${width}.png`,
      );
    });
