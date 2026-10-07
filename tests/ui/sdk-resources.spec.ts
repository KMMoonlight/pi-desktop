import { test } from "@playwright/test";
import { verifySdkResources } from "../sdk-resources-workflows.ts";

for (const width of [1440, 760])
  test(`original SDK package/resources workflows at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifySdkResources(page);
  });
