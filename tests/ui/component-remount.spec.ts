import { test } from "@playwright/test";
import {
  remountModes,
  verifyComponentRemount,
} from "../component-remount-workflows.ts";

for (const width of [1440, 390])
  for (const mode of remountModes)
    test(`${mode} component remount retains original input and cleanup at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyComponentRemount(
        page,
        mode,
        `.local/screenshots/component-remount-${mode}-${width}.png`,
      );
    });
