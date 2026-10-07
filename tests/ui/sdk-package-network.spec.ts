import { test } from "@playwright/test";
import { verifySdkPackageNetwork } from "../sdk-package-network-workflows.ts";

for (const width of [1440, 760])
  test(`original SDK npm/Git network workflows at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(300000);
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifySdkPackageNetwork(page);
  });
