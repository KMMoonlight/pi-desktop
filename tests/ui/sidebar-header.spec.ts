import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";

test("sidebar logo header matches the title bar and its toggle stays level when collapsed", async ({ page }) => {
  await mkdir(".local/sidebar-header", { recursive: true });
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const collapse = page.getByRole("button", { name: "收起侧边栏", exact: true });
  const expand = page.getByRole("button", { name: "打开侧边栏", exact: true });
  const center = (box: { y: number; height: number }) => box.y + box.height / 2;
  for (const width of [1440, 1024, 800]) {
    await page.setViewportSize({ width, height: 940 });
    for (const theme of ["light", "dark"]) {
      await sdkAction(page, "theme.set", { theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (await expand.isVisible()) await expand.click();
      await expect(collapse).toBeVisible();
      const brand = (await page.locator(".brand").boundingBox())!;
      const header = (await page.locator(".workspace-header").boundingBox())!;
      const before = (await collapse.boundingBox())!;
      const logo = (await page.locator(".brand .pi-logo").boundingBox())!;
      expect(brand.height).toBe(44);
      expect(brand.y).toBe(header.y);
      expect(brand.height).toBe(header.height);
      expect(Math.abs(center(logo) - center(before))).toBeLessThan(0.1);
      expect(logo.y).toBeGreaterThanOrEqual(brand.y);
      expect(logo.y + logo.height).toBeLessThanOrEqual(brand.y + brand.height);
      await page.screenshot({ path: `.local/sidebar-header/expanded-${width}-${theme}.png` });
      await collapse.click();
      await expect(expand).toBeVisible();
      const after = (await expand.boundingBox())!;
      expect(Math.abs(after.y - before.y)).toBeLessThan(0.1);
      expect(after.height).toBe(before.height);
      expect(after.width).toBe(before.width);
      expect((await page.locator(".workspace-header").boundingBox())!.height).toBe(header.height);
      await page.screenshot({ path: `.local/sidebar-header/collapsed-${width}-${theme}.png` });
      await expand.click();
      expect(Math.abs((await collapse.boundingBox())!.y - before.y)).toBeLessThan(0.1);
    }
  }
});
