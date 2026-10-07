import { test } from "@playwright/test";
import {
  verifySdkThemes,
  verifySystemThemes,
  verifyThemeInvalidation,
} from "../theme-workflows.ts";

for (const width of [1440, 390]) {
  test(`SDK theme changes invalidate original component caches at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyThemeInvalidation(page);
  });
  test(`SDK automatic themes and live files update desktop controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await verifySystemThemes(
      page,
      `.local/screenshots/sdk-system-themes-${width}.png`,
    );
  });
  test(`SDK themes retain native helpers, persistence and desktop colors at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifySdkThemes(page, `.local/screenshots/sdk-themes-${width}.png`);
  });
}
