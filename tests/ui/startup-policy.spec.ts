import { test } from "@playwright/test";
import {
  startupPolicyModes,
  verifyStartupPolicy,
} from "../startup-policy-workflows.ts";
for (const width of [1440, 390])
  for (const mode of startupPolicyModes)
    test(`original background policy ${mode} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyStartupPolicy(
        page,
        mode,
        `.local/screenshots/startup-policy-${mode}-${width}.png`,
      );
    });
