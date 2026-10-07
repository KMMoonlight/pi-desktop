import { test } from "@playwright/test";
import { verifyHorizontalGaps } from "../horizontal-gap-workflows.ts";

for (const width of [1440, 390])
  for (const align of ["start", "center", "end"])
    for (const nested of [false, true])
      for (const fill of [false, true])
        test(`horizontal frame additions at ${width}px/${align}/nested:${nested}/fill:${fill}`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 940 });
          await page.goto("/");
          await verifyHorizontalGaps(
            page,
            align,
            nested,
            fill,
            `.local/screenshots/horizontal-frame-${width}-${align}-${nested}-${fill}.png`,
            true,
          );
        });
