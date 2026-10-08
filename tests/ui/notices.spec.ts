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
    const bounds = await notice.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(80);
    expect(bounds!.y).toBeLessThan(100);
    await expect.poll(async () => {
      const current = (await notice.boundingBox())!;
      return width - current.x - current.width;
    }).toBeGreaterThanOrEqual(16);
    expect(width - bounds!.x - bounds!.width).toBeLessThan(24);
    expect(bounds!.width).toBeLessThanOrEqual(400);
    expect(bounds!.x).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: `.local/screenshots/notices-${width}.png` });
    await notice.getByRole("button", { name: "关闭通知", exact: true }).click();
    await expect(notice).toHaveCount(0);
  });
