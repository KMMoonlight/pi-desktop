import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";

for (const width of [1440, 390])
  test(`Pi notifications retain styled text and semantic links at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "prompt", { message: "/notice-probe" });
    const notice = page
      .locator(".notice")
      .filter({ hasText: "Notice probe" })
      .last();
    await expect(notice).toHaveText("Notice probe: Open reference");
    await expect(
      notice.getByRole("link", { name: "Open reference" }),
    ).toHaveAttribute("href", "https://example.invalid/notice");
    expect(
      await notice
        .getByText("Notice probe", { exact: true })
        .evaluate((element) => getComputedStyle(element).color),
    ).not.toBe(
      await notice.evaluate((element) => getComputedStyle(element).color),
    );
    await page.screenshot({ path: `.local/screenshots/notices-${width}.png` });
  });
