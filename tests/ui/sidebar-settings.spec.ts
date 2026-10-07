import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test.beforeAll(() => mkdir(".local/sidebar-settings/tests", { recursive: true }));

test("workspace navigation separates global actions and identifies matching directory names", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "sidebar-structure-original" });
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
  const original = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await editor.fill("原工作区草稿");
  const second = join(original.cwd, "second-parent", "workspace");
  await mkdir(second, { recursive: true });
  await sdkAction(page, "initialize", { cwd: second });
  const sidebar = page.locator(".sidebar");
  const header = sidebar.locator(".workspace-section-header");
  await expect(header.getByRole("heading", { name: "工作区", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "搜索会话", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "添加工作区", exact: true })).toBeVisible();
  await expect(sidebar.locator(".sidebar-actions").getByRole("button", { name: "新建会话", exact: true })).toBeVisible();
  await expect(sidebar.locator(".workspace-parent")).toHaveCount(2);
  const group = sidebar.locator(".session-project").filter({ hasText: "second-parent" });
  await group.locator("summary").click();
  await expect(group).not.toHaveAttribute("open", "");
  const previousId = (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId;
  await group.getByRole("button", { name: "在 workspace 中新建会话", exact: true }).click();
  await expect(group).toHaveAttribute("open", "");
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).not.toBe(previousId);
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).cwd).toBe(second);
  await header.getByRole("button", { name: "搜索会话", exact: true }).click();
  await header.getByRole("textbox", { name: "搜索会话", exact: true }).fill("missing-session-query");
  await expect(sidebar.getByText("没有匹配的会话", { exact: true })).toBeVisible();
  await header.getByRole("button", { name: "清除会话搜索", exact: true }).click();
  await expect(header.getByRole("textbox", { name: "搜索会话", exact: true })).toBeFocused();
  await page.screenshot({ path: ".local/sidebar-settings/tests/sidebar.png" });
  await sdkAction(page, "initialize", { cwd: original.cwd });
  await sdkAction(page, "session.switch", { path: original.sessionFile });
  await expect(editor).toHaveValue("原工作区草稿");
});

test("settings use one content scroller without compressing dense lists or overlapping toolbars", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await editor.fill("设置布局草稿");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "设置", exact: true });
  const nav = modal.getByRole("navigation", { name: "设置分类" });
  const content = modal.locator(".settings-content");
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: width > 1024 ? 940 : width > 700 ? 600 : 740 });
    for (const [key, label] of [["general", "常规"], ["appearance", "外观与显示"], ["models", "模型与账号"], ["project", "项目"], ["mcp", "MCP"], ["packages", "扩展包"], ["advanced", "高级"]]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await expect.poll(() => content.evaluate(node => node.scrollTop)).toBe(0);
      if (key === "models") await modal.getByRole("button", { name: "添加提供商", exact: true }).click();
      const extraRules = await content.evaluate(node => [...node.querySelectorAll(
        '.settings-group, .settings-grid > .field, .settings-group > .field, .setting-row',
      )].filter(element => parseFloat(getComputedStyle(element).borderBottomWidth) > 0)
        .map(element => element.className));
      expect(extraRules, `${label} has redundant setting/section dividers at ${width}px`).toEqual([]);
      const toolbarRules = await content.locator(".settings-toolbar").evaluateAll(toolbars => toolbars.filter(toolbar =>
        [getComputedStyle(toolbar), getComputedStyle(toolbar, "::before"), getComputedStyle(toolbar, "::after")]
          .some(css => parseFloat(css.borderTopWidth) > 0 || parseFloat(css.borderBottomWidth) > 0)
      ).map(toolbar => toolbar.textContent));
      expect(toolbarRules, `${label} must not inherit a panel separator`).toEqual([]);
      const inconsistentActions = await modal.locator(".settings-content button, .settings-save button").evaluateAll(buttons => buttons
        .filter(button => button.getBoundingClientRect().height > 0 && button.textContent?.trim() && button.getAttribute("role") !== "combobox")
        .filter(button => {
          const css = getComputedStyle(button);
          return button.getBoundingClientRect().height !== 32 || css.fontSize !== "13px" || css.borderRadius !== "8px";
        }).map(button => button.textContent));
      expect(inconsistentActions, `${label} actions must share body-button geometry`).toEqual([]);
      const clipping = await content.evaluate(node => [...node.children]
        .filter(child => child.getBoundingClientRect().height > 0 && getComputedStyle(child).overflowY === "visible" && child.scrollHeight > child.clientHeight + 3)
        .map(child => child.className));
      expect(clipping, `${label} at ${width}px`).toEqual([]);
      await expect(modal).toBeInViewport();
      if (["general", "models", "advanced"].includes(key)) await expect(modal.getByRole("button", { name: "保存设置", exact: true })).toBeInViewport();
      if (key === "models") {
        const last = modal.locator(".provider-row").last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
        const footer = await modal.locator(".settings-save").boundingBox();
        await content.hover();
        await page.mouse.wheel(0, 800);
        await expect.poll(() => modal.locator(".settings-save").boundingBox()).toEqual(footer);
        await modal.getByRole("button", { name: "返回已连接账号", exact: true }).click();
        await modal.getByRole("combobox", { name: "默认模型", exact: true }).scrollIntoViewIfNeeded();
        await modal.getByRole("combobox", { name: "默认模型", exact: true }).click();
        await expect(page.getByRole("listbox", { name: "默认模型", exact: true })).toBeInViewport();
        await page.keyboard.press("Escape");
      }
      if (key === "advanced") {
        const gap = await content.evaluate(node => {
          const editor = node.querySelector(".settings-toolbar + .json-editor")!;
          return editor.getBoundingClientRect().top - editor.previousElementSibling!.getBoundingClientRect().bottom;
        });
        expect(gap, "editor border must not touch a toolbar separator").toBeGreaterThanOrEqual(12);
        await modal.getByRole("combobox", { name: "缓存预热", exact: true }).click();
        await expect(page.getByRole("listbox", { name: "缓存预热", exact: true })).toBeInViewport();
        await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
        await expect(page.getByRole("listbox", { name: "缓存预热", exact: true })).toHaveCount(0);
        await expect(modal.locator(".raw-settings")).toBeInViewport();
      }
      await page.screenshot({ path: `.local/sidebar-settings/tests/${key}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await nav.getByRole("button", { name: "项目", exact: true }).click();
  await expect(modal.locator(".settings-locations dd")).toHaveCount(2);
  await modal.getByRole("button", { name: "关闭设置", exact: true }).hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  expect(await tip.evaluate(node => getComputedStyle(node).fontFamily)).toContain("Segoe UI");
  await expect(tip).toBeInViewport();
  await nav.getByRole("button", { name: "高级", exact: true }).click();
  await modal.getByRole("textbox", { name: "配置 JSON", exact: true }).fill("{ invalid-json");
  await modal.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(modal.locator(".settings-feedback").getByRole("alert")).toBeVisible();
  await modal.locator(".settings-feedback").getByRole("button", { name: "关闭通知", exact: true }).click();
  await expect(modal.locator(".settings-feedback")).toHaveCount(0);
  await modal.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(editor).toHaveValue("设置布局草稿");
  expect(errors).toEqual([]);
});
