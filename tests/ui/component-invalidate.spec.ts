import { test } from "@playwright/test";
import { verifyComponentInvalidation } from "../component-invalidate-workflows.ts";

for (const width of [1440, 390]) {
  test(`TUI invalidation updates the original factory root at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentInvalidation(page);
  });
}
