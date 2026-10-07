import { test } from "@playwright/test";
import { verifyDesktopLinks } from "../link-workflows.ts";

for (const width of [1440, 390]) {
  test(`Pi text and Markdown email/phone/custom links use the desktop opener at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyDesktopLinks(page, `.local/screenshots/links-${width}.png`);
  });
}
