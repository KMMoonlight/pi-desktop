import { test, expect } from "@playwright/test";
import { verifySdkAuth } from "../auth-workflows.ts";

for (const width of [1440, 390])
  test(`SDK login preserves choice IDs, device identity and cancellation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await verifySdkAuth(page, `.local/screenshots/sdk-auth-${width}.png`);
  });
