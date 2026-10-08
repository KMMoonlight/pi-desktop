import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows";
import type { DesktopSnapshot } from "../../shared/types";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await expect
    .poll(
      async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).changing,
    )
    .toBe(false);
});

test("Tailwind dialogs trap focus, dismiss menus first and restore their trigger", async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: "设置", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  const first = dialog.getByRole("button", { name: "常规", exact: true });
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await dialog.getByRole("button", { name: "高级", exact: true }).click();
  const select = dialog.getByRole("combobox", {
    name: "缓存预热",
    exact: true,
  });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("listbox", { name: "缓存预热", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("listbox", { name: "缓存预热", exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(select).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("desktop navigation remains usable at every supported window size", async ({
  page,
}) => {
  for (const size of [
    { width: 760, height: 580 },
    { width: 1100, height: 760 },
    { width: 1440, height: 940 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator(".sidebar")).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "设置", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(size.width);
  }
});

test("Tailwind application colors follow appearance while SDK controls keep their behavior", async ({
  page,
}) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name: "外观与显示", exact: true }).click();
  const toggle = dialog.getByRole("switch").first();
  const previous = await toggle.isChecked();
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: !previous });
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: previous });
  await dialog.getByRole("button", { name: "关闭设置", exact: true }).click();
  await sdkAction(page, "theme.set", { theme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page
      .locator(".sidebar")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(31, 30, 27)");
  await sdkAction(page, "theme.set", { theme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page
      .locator(".sidebar")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(245, 240, 232)");
});

test("dark panels retain readable toolbar controls in either application theme", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await sdkAction(page, "prompt", { message: "presentation-code-probe" });
  await expect(page.locator(".code-block").first()).toBeVisible();
  await page.getByRole("button", { name: "终端", exact: true }).click();
  const panel = page.getByRole("region", { name: "Pi 终端", exact: true });
  const controls = page.locator(".terminal-actions > button, .code-toolbar button");
  await expect(controls).toHaveCount(4);
  for (const theme of ["light", "dark"]) {
    await sdkAction(page, "theme.set", { theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const control of await controls.all()) {
      for (const state of ["rest", "hover", "focus"]) {
        if (state === "hover") await control.hover();
        if (state === "focus") await control.focus();
        const contrast = await control.evaluate(node => {
          const surface = node.closest(".code-toolbar, header")!;
          const luminance = (color: string) => {
            const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
              const v = value / 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const fg = luminance(getComputedStyle(node).color);
          const bg = luminance(getComputedStyle(surface).backgroundColor);
          return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        });
        expect(contrast, `${theme} ${state} ${await control.getAttribute("aria-label")}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    await expect(panel.getByRole("button", { name: "关闭终端", exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await mkdir(".local/tailwind-migration/compact", { recursive: true });
    await page.screenshot({ path: `.local/tailwind-migration/compact/toolbars-${theme}.png`, animations: "disabled" });
  }
});

test("empty sessions keep the complete composer at the bottom with and without the terminal", async ({ page }) => {
  await sdkAction(page, "session.new");
  await expect(page.locator(".brand")).not.toContainText("Pi Desktop");
  await expect(page.getByRole("button", { name: "审查更改", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "分析项目", exact: true })).toHaveCount(0);
  expect(await page.locator(".header-title h1").evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeLessThanOrEqual(14);
  await mkdir(".local/bottom-composer", { recursive: true });
  for (const size of [{ width: 1440, height: 940 }, { width: 1440, height: 640 }, { width: 760, height: 580 }]) {
    await page.setViewportSize(size);
    for (const terminal of [false, true]) {
      await expect.poll(async () => page.locator(".composer-region").evaluate(node => {
        const box = node.getBoundingClientRect();
        const chat = node.closest(".chat-view")!.getBoundingClientRect();
        const following = Array.from(node.parentElement!.children).slice(Array.from(node.parentElement!.children).indexOf(node) + 1);
        const footerHeight = following.reduce((total, child) => total + child.getBoundingClientRect().height, 0);
        return { contained: box.top >= chat.top && box.bottom <= chat.bottom + 1, docked: Math.abs(chat.bottom - box.bottom - footerHeight) < 2 };
      })).toEqual({ contained: true, docked: true });
      await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeInViewport();
      await expect(page.locator(".desktop-extension-footer")).toBeInViewport();
      if (terminal) {
        const panel = page.getByRole("region", { name: "Pi 终端", exact: true });
        await expect(panel.getByRole("button", { name: "关闭终端", exact: true })).toBeInViewport();
        await expect(panel.locator('[data-terminal-source="shell"] .xterm-screen')).toBeVisible();
        expect((await panel.boundingBox())!.height).toBeGreaterThan((await panel.locator("header").boundingBox())!.height);
      }
      await page.screenshot({ path: `.local/bottom-composer/${size.width}-${size.height}${terminal ? "-terminal" : ""}.png`, animations: "disabled" });
      if (!terminal) await page.getByRole("button", { name: "终端", exact: true }).click();
      else await page.getByRole("button", { name: "关闭终端", exact: true }).click();
    }
  }
});

test("composer selects open above their controls and distinguish hover from selection", async ({ page }) => {
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const modelsPath = join(snapshot.agentDir, "models.json");
  const original = await readFile(modelsPath, "utf8");
  const models = JSON.parse(original);
  models.providers["desktop-test"].models[0].reasoning = true;
  await mkdir(".local/composer-style", { recursive: true });
  try {
    await writeFile(modelsPath, JSON.stringify(models));
    await sdkAction(page, "models.refresh");
    await sdkAction(page, "model.set", { provider: "desktop-test", id: "desktop-test" });
    await sdkAction(page, "session.new");
    const trigger = page.getByRole("combobox", { name: "思考等级", exact: true });
    for (const theme of ["light", "dark"]) {
      await sdkAction(page, "theme.set", { theme });
      for (const size of [{ width: 1440, height: 940 }, { width: 760, height: 580 }]) {
        await page.setViewportSize(size);
        await trigger.click();
        const menu = page.getByRole("listbox", { name: "思考等级", exact: true });
        await expect(menu).toBeInViewport({ ratio: 1 });
        expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThan((await trigger.boundingBox())!.y);
        expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(200);
        const selected = menu.locator('[aria-selected="true"]');
        const hovered = menu.getByRole("option").nth(1);
        await hovered.hover();
        await expect(selected.locator("svg")).toHaveCount(1);
        expect(await selected.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await hovered.evaluate(node => getComputedStyle(node).backgroundColor));
        await page.screenshot({ path: `.local/composer-style/thinking-${theme}-${size.width}.png`, animations: "disabled" });
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
    }
    await trigger.press("ArrowDown");
    await trigger.press("ArrowDown");
    await trigger.press("Enter");
    await expect(trigger).not.toHaveAttribute("data-value", "off");
    await sdkAction(page, "thinking.set", { level: "off" });
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.fill("中文任务 Pi Agent\n第二行任务");
    await expect(editor).toHaveValue("中文任务 Pi Agent\n第二行任务");
    await page.screenshot({ path: ".local/composer-style/input-text.png", animations: "disabled" });
    await editor.fill("");
    await editor.focus();
    await page.screenshot({ path: ".local/composer-style/input-placeholder.png", animations: "disabled" });
  } finally {
    await writeFile(modelsPath, original);
    await sdkAction(page, "models.refresh");
    await sdkAction(page, "model.set", { provider: "desktop-test", id: "desktop-test" });
    await sdkAction(page, "theme.set", { theme: "light" });
  }
});
