import { test } from "@playwright/test";
import { verifyComponentListeners } from "../component-listener-workflows.ts";

for (const width of [1440, 390]) {
  test(`standard Text component receives input listeners and debug callbacks at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentListeners(page);
  });
}
