import { test } from "@playwright/test";
import {
  applicationModes,
  verifyApplicationComponents,
} from "../application-components-workflows.ts";

for (const width of [1440, 390])
  for (const mode of applicationModes)
    test(`original application ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyApplicationComponents(
        page,
        mode,
        `.local/screenshots/application-components-${mode}-${width}.png`,
      );
    });
