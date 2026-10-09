import { test, expect } from "@playwright/test";

test("update settings remain honest in browser preview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.locator(".settings-modal");
  await settings.getByRole("button", { name: "应用更新", exact: true }).click();
  await expect(settings.getByText("请在桌面应用中检查更新。")).toBeVisible();
  await expect(settings.getByRole("button", { name: "检查更新", exact: true })).toHaveCount(0);
});

test("automatic download shows progress and installation requires confirmation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tests/update-preview.html");
  await expect(page.getByRole("progressbar", { name: "下载进度" })).toHaveAttribute("value", "50");
  await expect(page.getByRole("button", { name: "检查更新", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).updateTest.finish());
  await expect(page.getByText("版本 0.2.0 已准备就绪")).toBeVisible();
  await page.getByText("更新说明", { exact: true }).click();
  await expect(page.getByText("修复问题并改善性能。")).toBeVisible();
  await page.getByRole("button", { name: "安装并重启" }).click();
  expect(await page.evaluate(() => (window as any).updateTest.installs)).toBe(0);
  await page.screenshot({ path: ".local/update-ready.png" });
  await page.evaluate(() => { (window as any).updateTest.confirmed = true; });
  await page.getByRole("button", { name: "安装并重启" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).updateTest.installs)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).updateTest.restarts)).toBe(1);
  expect(errors).toEqual([]);
});

test("automatic download preference persists and manual download works", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pi.updates.autoDownload", "false"));
  await page.goto("/tests/update-preview.html");
  await expect(page.getByRole("switch", { name: "自动下载更新" })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "下载更新", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).updateTest.downloads)).toBe(0);
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await page.getByRole("switch", { name: "自动下载更新" }).check();
  expect(await page.evaluate(() => localStorage.getItem("pi.updates.autoDownload"))).toBe("true");
  expect(await page.evaluate(() => (window as any).updateTest.downloads)).toBe(1);
});
