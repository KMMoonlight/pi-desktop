import { test } from "@playwright/test";
import {
  overlayLifecycleModes,
  verifyOverlayLifecycle,
} from "../overlay-lifecycle-workflows.ts";

for (const width of [1440, 390])
  for (const mode of overlayLifecycleModes)
    test(`overlay ${mode} preserves original lifetime at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyOverlayLifecycle(
        page,
        mode,
        `.local/screenshots/overlay-lifecycle-${mode}-${width}.png`,
      );
    });
