import { test } from "@playwright/test";
import {
  customCloseModes,
  verifyCustomCloseOrder,
} from "../custom-close-order-workflows.ts";

for (const width of [1440, 390])
  for (const mode of customCloseModes)
    test(`custom ${mode} close retains Pi cleanup/result order at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyCustomCloseOrder(
        page,
        mode,
        `.local/screenshots/custom-close-order-${mode}-${width}.png`,
      );
    });
