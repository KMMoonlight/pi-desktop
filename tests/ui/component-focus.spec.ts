import { test } from "@playwright/test";
import { verifyComponentFocus } from "../component-focus-workflows.ts";

for (const width of [1440, 390]) {
  test(`original programmatic focus reaches desktop controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentFocus(page);
  });
}
