import { test } from "@playwright/test";
import {
  rendererModes,
  verifyRendererModes,
} from "../renderer-modes-workflows.ts";
for (const width of [1440, 390])
  for (const mode of rendererModes)
    test(`original renderer modes ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyRendererModes(
        page,
        mode,
        `.local/screenshots/renderer-modes-${mode}-${width}.png`,
      );
    });
