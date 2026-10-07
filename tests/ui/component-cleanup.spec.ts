import { test } from "@playwright/test";
import { verifyComponentCleanup } from "../component-cleanup-workflows.ts";

for (const width of [1440, 390]) {
  test(`component cleanup errors preserve results and the next interaction at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentCleanup(page);
  });
}
