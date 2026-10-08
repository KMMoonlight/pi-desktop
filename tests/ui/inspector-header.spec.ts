import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";

test("inspector uses one panel toggle and its header aligns with the conversation title bar", async ({ page }) => {
  await mkdir(".local/inspector-header", { recursive: true });
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const open = page.getByRole("button", { name: "打开检查器", exact: true });
  const close = page.getByRole("button", { name: "关闭检查器", exact: true });
  const panelToggles = page.getByRole("button", { name: /^(打开|关闭|收起)检查器$/ });
  for (const viewport of [
    { width: 1440, height: 940 },
    { width: 1280, height: 560 },
    { width: 1024, height: 740 },
    { width: 800, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    const sidebarBackdrop = page.getByRole("button", { name: "关闭侧边栏遮罩", exact: true });
    if (await sidebarBackdrop.isVisible()) await sidebarBackdrop.click({ position: { x: viewport.width - 10, y: 200 } });
    for (const theme of ["light", "dark"]) {
      await sdkAction(page, "theme.set", { theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(panelToggles).toHaveCount(1);
      await open.click();
      await expect(close).toBeVisible();
      await expect(panelToggles).toHaveCount(1);
      await expect(open).toHaveCount(0);
      const mainHeader = (await page.locator(".workspace-header").boundingBox())!;
      const inspectorHeader = (await page.locator(".inspector > header").boundingBox())!;
      expect(mainHeader.height).toBe(44);
      expect(inspectorHeader.height).toBe(mainHeader.height);
      expect(inspectorHeader.y).toBe(mainHeader.y);
      const terminal = (await page.getByRole("button", { name: "终端", exact: true }).boundingBox())!;
      const closeBox = (await close.boundingBox())!;
      expect(Math.abs(closeBox.y - terminal.y)).toBeLessThan(0.1);
      await page.screenshot({ path: `.local/inspector-header/open-${viewport.width}-${theme}.png` });
      await close.click();
      await expect(page.locator(".inspector")).toHaveCount(0);
      await expect(open).toBeVisible();
      await expect(panelToggles).toHaveCount(1);
      expect((await page.locator(".workspace-header").boundingBox())!.height).toBe(mainHeader.height);
    }
  }
});
