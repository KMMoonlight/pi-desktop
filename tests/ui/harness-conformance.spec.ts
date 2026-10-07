import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import { selectField } from "../select-field.ts";

test.beforeAll(() => mkdir(".local/harness-audit/after", { recursive: true }));

test("growing editor, aligned conversation and dismissible usage and menus", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "共享布局验收" });
  await expect(page.locator(".transcript .message-assistant")).toBeVisible();
  await editor.fill("一行草稿");
  const compact = (await editor.boundingBox())!.height;
  // Large pastes are intentionally collapsed by Pi; typed line breaks remain visible.
  await editor.fill("多行中文内容\n".repeat(4));
  await expect.poll(async () => (await editor.boundingBox())!.height).toBeGreaterThan(compact);
  for (let index = 0; index < 16; index++) await editor.press("Shift+Enter");
  expect((await editor.boundingBox())!.height).toBeLessThanOrEqual(360);
  await editor.fill("一行草稿");
  expect((await editor.boundingBox())!.height).toBe(compact);
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 940 });
    const close = page.getByRole("button", { name: "收起侧边栏", exact: true });
    if (width < 1024 && await close.isVisible()) await close.click();
    const usage = page.getByRole("button", { name: "查看上下文与用量", exact: true });
    await usage.click();
    const popup = page.getByRole("dialog", { name: "上下文与用量", exact: true });
    await expect(popup).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(usage).toBeFocused();
    const user = page.locator(".transcript .message-user").first();
    expect(await user.locator(".message-body .message-meta").count()).toBe(0);
    await expect(user.locator(".message-meta")).toHaveCount(1);
    await page.screenshot({ path: `.local/harness-audit/after/conversation-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const tabs = page.getByRole("navigation", { name: "会话视图" });
    await expect(tabs.getByRole("button", { name: "对话", exact: true })).toBeInViewport();
  }
  const menu = page.getByRole("button", { name: "会话操作", exact: true });
  await menu.click();
  await expect(page.getByRole("button", { name: "运行 Shell 命令…", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".menu-list")).toBeHidden();
  await expect(menu).toBeFocused();
  await expect(editor).toHaveValue("一行草稿");
});

test("terminal theme updates preserve the existing screen and PTY session", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await page.getByRole("button", { name: "终端", exact: true }).click();
  const screen = page.locator(".terminal-panel .xterm-screen");
  await expect(screen).toBeVisible();
  const existing = await screen.elementHandle();
  const before = await sdkAction<{ terminalId: string; chunks: { data: string }[] }>(page, "terminal.snapshot");
  await sdkAction(page, "theme.set", { theme: "dark" });
  await expect.poll(() => page.locator(".terminal-panel").evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(21, 21, 23)");
  expect(await screen.evaluate((node, original) => node === original, existing)).toBe(true);
  const after = await sdkAction<{ terminalId: string; chunks: { data: string }[] }>(page, "terminal.snapshot");
  expect(after.terminalId).toBe(before.terminalId);
  expect(after.chunks.map(chunk => chunk.data).join("")).toContain(before.chunks.map(chunk => chunk.data).join(""));
  await page.screenshot({ path: ".local/harness-audit/after/terminal-dark.png" });
  await page.getByRole("button", { name: "关闭终端", exact: true }).click();
  await sdkAction(page, "theme.set", { theme: "light" });
});

test("settings modal retains unsaved scope and drafts, categories and responsive controls", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await editor.fill("设置前草稿");
  await page.keyboard.press("Control+Comma");
  const modal = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(modal).toBeVisible();
  const categories = modal.getByRole("navigation", { name: "设置分类" });
  const steering = modal.getByRole("combobox", { name: "执行中消息", exact: true });
  await selectField(steering, "all");
  await expect(modal.getByText("有未保存的更改", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await page.keyboard.press("Control+Comma");
  await expect(steering).toHaveAttribute("data-value", "all");
  for (const [key, label] of [["general", "常规"], ["appearance", "外观与显示"], ["models", "模型与账号"], ["project", "项目"], ["mcp", "MCP"], ["packages", "扩展包"], ["advanced", "高级"]]) {
    await categories.getByRole("button", { name: label, exact: true }).click();
    await page.screenshot({ path: `.local/harness-audit/after/settings-${key}.png` });
  }
  await categories.getByRole("button", { name: "外观与显示", exact: true }).click();
  await selectField(modal.getByRole("combobox", { name: "颜色模式", exact: true }), "dark");
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 940 });
    await categories.getByRole("button", { name: "高级", exact: true }).click();
    await expect(modal).toBeInViewport();
    await expect(modal.getByRole("button", { name: "保存设置", exact: true })).toBeInViewport();
    const dropdown = modal.getByRole("combobox", { name: "缓存预热", exact: true });
    await dropdown.click();
    await expect(page.getByRole("listbox", { name: "缓存预热", exact: true })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(modal).toBeVisible();
    await page.screenshot({ path: `.local/harness-audit/after/settings-dark-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await modal.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(editor).toHaveValue("设置前草稿");
  await sdkAction(page, "theme.set", { theme: "light" });
});
