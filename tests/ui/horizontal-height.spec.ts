import { test } from "@playwright/test";
import { verifyHorizontalTransforms } from "../horizontal-transform-workflows.ts";

for (const width of [1440, 390])
  for (const align of ["start", "center", "end"])
    for (const nested of [false, true])
      for (const fill of [false, true])
        for (const height of ["insert", "cut"] as const)
          test(`horizontal resized bodies at ${width}px/${align}/nested:${nested}/fill:${fill}/${height}`, async ({
            page,
          }) => {
            await page.setViewportSize({ width, height: 940 });
            await page.goto("/");
            await verifyHorizontalTransforms(
              page,
              align,
              nested,
              fill,
              "left",
              `.local/screenshots/horizontal-height-${width}-${align}-${nested}-${fill}-${height}.png`,
              height,
            );
          });
