import { test } from "@playwright/test";
import { verifyComponentLifecycle } from "../component-lifecycle-workflows.ts";

for (const width of [1440, 390]) {
  test(`mapped TUI pause retains its control and resumes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentLifecycle(page);
  });
}
