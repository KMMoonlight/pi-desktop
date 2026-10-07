import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("rendered content, evidence and feedback fit both themes and the agreed viewport matrix", async ({ page }) => {
  test.setTimeout(120000);
  const dir = ".local/full-ui-review/content";
  await mkdir(dir, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "run-tool：读取项目中的文件，保留工具输出供检查。" });
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
  await sdkAction(page, "prompt", { message: "presentation-code-probe：请展示代码和表格，并说明中文内容。" });
  await expect(page.getByRole("heading", { name: "Review result", exact: true })).toBeVisible();
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const capture = async (name: string) => {
    await page.mouse.move(0, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
    await expect(editor).toBeInViewport();
    await page.screenshot({ path: `${dir}/${name}.png`, animations: "disabled" });
  };
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
    await sdkAction(page, "theme.set", { theme });
    await page.reload();
    await editor.waitFor();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const tool = page.locator('.tool-execution[data-tool-call-id="call-read"]');
    const expand = tool.getByRole("button", { name: "展开 read 输出", exact: true });
    if (await expand.isVisible()) await expand.click();
    await expect(tool.locator(".tool-body")).toBeVisible();
    for (const width of [1440, 1024, 768, 390, 375]) {
      await page.setViewportSize({ width, height: width > 700 ? 940 : 740 });
      if (width < 1024 && await button("收起侧边栏").isVisible()) await button("收起侧边栏").click();
      await tool.scrollIntoViewIfNeeded();
      await capture(`${theme}-${width}-tools`);
      await page.getByRole("heading", { name: "Review result", exact: true }).scrollIntoViewIfNeeded();
      await capture(`${theme}-${width}-markdown`);
      const table = page.locator(".message-assistant table").last();
      await table.scrollIntoViewIfNeeded();
      await expect(table.getByText("Ready", { exact: true })).toBeInViewport();
      await capture(`${theme}-${width}-markdown-tail`);
      await button("文件与更改").click();
      await page.getByRole("treeitem", { name: "test-note.txt", exact: true }).click();
      await expect(page.locator(".file-preview")).toContainText("Real file attachment content.");
      await capture(`${theme}-${width}-preview`);
      await button("关闭文件面板").click();
    }
    await page.setViewportSize({ width: 1024, height: 600 });
    await capture(`${theme}-1024-short-chat`);
    if (await button("打开侧边栏").isVisible()) await button("打开侧边栏").click();
    await button("设置").click();
    await page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "MCP", exact: true }).click();
    await button("添加服务器").click();
    await expect(page.getByRole("textbox", { name: "名称", exact: true })).toBeFocused();
    await expect(page.getByRole("group", { name: "添加服务器", exact: true }).getByRole("heading")).toBeInViewport();
    await button("保存服务器").scrollIntoViewIfNeeded();
    await expect(button("保存服务器")).toBeInViewport();
    await page.screenshot({ path: `${dir}/${theme}-1024-short-form.png` });
    await button("取消添加").click();
    await button("关闭设置").click();
    if (await button("收起侧边栏").isVisible()) await button("收起侧边栏").click();
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width > 700 ? 940 : 740 });
      await button("会话操作").click();
      await page.getByRole("dialog", { name: "会话操作", exact: true }).getByRole("button", { name: "导入会话", exact: true }).click();
      const imported = page.getByRole("dialog", { name: "导入会话", exact: true });
      await imported.getByRole("textbox").fill("missing-session.jsonl");
      await imported.getByRole("button", { name: "确定", exact: true }).click();
      await expect(imported.getByRole("alert")).toContainText("missing-session");
      await expect(imported).toBeInViewport();
      await page.screenshot({ path: `${dir}/${theme}-${width}-error.png` });
      await imported.getByRole("button", { name: "取消", exact: true }).click();
      await sdkAction(page, "prompt", { message: "/desktop-dialog" });
      const extension = page.getByRole("dialog");
      await expect(extension.getByRole("heading", { name: "Extension confirmation", exact: true })).toBeVisible();
      await expect(extension).toBeInViewport();
      await page.screenshot({ path: `${dir}/${theme}-${width}-extension.png` });
      await extension.getByRole("button", { name: "取消", exact: true }).click();
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      await sdkAction(page, "sdk.run", { path: join(snapshot.agentDir, "desktop", "auth-provider.mjs"), args: { operation: "install" } });
      const pending = sdkAction(page, "auth.login", { provider: "desktop-auth-test" }).catch(() => undefined);
      try {
        const login = page.getByRole("dialog");
        await expect(login.getByRole("heading", { name: "Fixture account", exact: true })).toBeVisible();
        await expect(login).toBeInViewport();
        await page.screenshot({ path: `${dir}/${theme}-${width}-auth.png` });
        await login.getByRole("button", { name: "取消", exact: true }).click();
      } finally {
        await sdkAction(page, "abort");
        await pending;
      }
    }
  }
  await sdkAction(page, "theme.set", { theme: "light" });
  expect(errors).toEqual([]);
});
