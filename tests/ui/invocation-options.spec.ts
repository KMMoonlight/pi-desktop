import { test } from "@playwright/test";
import {
  invocationModes,
  verifyInvocationOptions,
} from "../invocation-options-workflows.ts";
for (const width of [1440, 390])
  for (const mode of invocationModes)
    test(`Pi invocation options ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyInvocationOptions(
        page,
        mode,
        `.local/screenshots/invocation-${mode}-${width}.png`,
      );
    });
