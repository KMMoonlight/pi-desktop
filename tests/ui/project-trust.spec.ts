import { test } from "@playwright/test";
import {
  projectTrustModes,
  verifyProjectTrust,
} from "../project-trust-workflows.ts";

for (const width of [1440, 760])
  for (const mode of projectTrustModes)
    test(`project trust ${mode} at width ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyProjectTrust(
        page,
        mode,
        mode === "once"
          ? `.local/screenshots/project-trust-${width}.png`
          : undefined,
      );
    });
