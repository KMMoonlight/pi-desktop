import { test } from "@playwright/test";
import { verifyScrollbars } from "../scrollbar-workflows.ts";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

for (const width of [1440, 390]) {
  test(`Pi scrollbars preserve visibility, activity, timers and themes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyScrollbars(page, `.local/screenshots/scrollbars-${width}.png`);
  });
}
