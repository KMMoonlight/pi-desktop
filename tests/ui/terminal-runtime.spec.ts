import { test } from "@playwright/test";
import {
  sharedTuiModes,
  verifySharedTui,
} from "../terminal-runtime-workflows.ts";
for (const width of [1440, 390])
  for (const mode of sharedTuiModes) {
    test(`shared TUI runtime ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifySharedTui(
        page,
        mode,
        `.local/screenshots/shared-tui-${mode}-${width}.png`,
      );
    });
  }
