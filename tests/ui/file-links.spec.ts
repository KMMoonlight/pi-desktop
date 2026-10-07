import { test } from "@playwright/test";
import { verifyFileLinks } from "../file-link-workflows.ts";
for (const width of [1440, 390]) {
  test(`Pi file links preserve encoded paths and explain browser limitations at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyFileLinks(page, `.local/screenshots/file-links-${width}.png`);
  });
}
