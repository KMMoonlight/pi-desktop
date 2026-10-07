import { test } from "@playwright/test";
import {
  applicationContentModes,
  verifyApplicationContent,
} from "../application-content-workflows.ts";
for (const width of [1440, 390])
  for (const mode of applicationContentModes)
    test(`original application content ${mode} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyApplicationContent(
        page,
        mode,
        `.local/screenshots/application-content-${mode}-${width}.png`,
      );
    });
