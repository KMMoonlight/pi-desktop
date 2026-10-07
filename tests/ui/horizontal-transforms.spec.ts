import { test } from "@playwright/test";
import { verifyHorizontalTransforms } from "../horizontal-transform-workflows.ts";

for (const width of [1440, 390])
  for (const align of ["start", "center", "end"])
    for (const nested of [false, true])
      for (const fill of [false, true])
        for (const transform of ["left", "both"] as const)
          test(`horizontal transformed columns at ${width}px/${align}/nested:${nested}/fill:${fill}/${transform}`, async ({
            page,
          }) => {
            await page.setViewportSize({ width, height: 940 });
            await page.goto("/");
            await verifyHorizontalTransforms(
              page,
              align,
              nested,
              fill,
              transform,
              `.local/screenshots/horizontal-transform-${width}-${align}-${nested}-${fill}-${transform}.png`,
            );
          });
