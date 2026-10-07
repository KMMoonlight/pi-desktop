import { test } from "@playwright/test";
import { verifySdkPackageEnvironment } from "../sdk-package-environment-workflows.ts";

for (const width of [1440, 760])
  test(`original SDK default npm/legacy global workflows at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifySdkPackageEnvironment(page);
  });
