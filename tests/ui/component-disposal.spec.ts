import { test } from "@playwright/test";
import {
  disposalModes,
  verifyComponentDisposal,
} from "../component-disposal-workflows.ts";

for (const width of [1440, 390])
  for (const mode of disposalModes)
    test(`${mode} disposal preserves original desktop/xterm input and cleanup at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyComponentDisposal(
        page,
        mode,
        `.local/screenshots/component-disposal-${mode}-${width}.png`,
      );
    });
