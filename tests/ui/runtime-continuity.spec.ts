import { test } from "@playwright/test";
import {
  continuityModes,
  continuityTransitions,
  verifyRuntimeContinuity,
} from "../runtime-continuity-workflows.ts";
for (const width of [1440, 390])
  for (const transition of continuityTransitions)
    for (const mode of continuityModes)
      test(`runtime continuity ${transition}/${mode} at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 940 });
        await page.goto("/");
        await verifyRuntimeContinuity(
          page,
          transition,
          mode,
          `.local/screenshots/runtime-continuity-${transition}-${mode}-${width}.png`,
        );
      });
