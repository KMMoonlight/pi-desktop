import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("workspace menu scrolls only when its options exceed the available height", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const trigger = page.getByRole("button", { name: "选择工作区", exact: true });
  const menu = page.getByRole("menu", { name: "选择工作区", exact: true });
  const options = menu.locator(".workspace-picker-options");
  await trigger.click();
  await expect(menu.getByRole("menuitemradio")).toHaveCount(1);
  expect(await options.evaluate(node => node.scrollHeight - node.clientHeight)).toBe(0);
  await expect(menu.getByRole("menuitem", { name: "添加工作区…", exact: true })).toBeInViewport();
  await page.screenshot({ path: ".local/window-fit/picker-short.png" });
  await menu.press("Escape");

  const { cwd } = await sdkAction<DesktopSnapshot>(page, "snapshot");
  for (let i = 0; i < 12; i++) {
    const path = join(cwd, `workspace-${i}`);
    await mkdir(path, { recursive: true });
    await sdkAction(page, "workspace.add", { cwd: path });
  }
  for (const viewport of [{ width: 1440, height: 940 }, { width: 760, height: 580 }]) {
    await page.setViewportSize(viewport);
    await trigger.click();
    await expect(menu.getByRole("menuitemradio")).toHaveCount(13);
    expect(await options.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(menu.getByRole("menuitem", { name: "添加工作区…", exact: true })).toBeInViewport({ ratio: 1 });
    await options.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => options.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await menu.press("Escape");
  }
});
