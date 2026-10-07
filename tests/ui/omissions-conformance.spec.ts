import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("repaired workspace, evidence and provider surfaces fit the agreed widths and both themes", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir(".local/ui-omissions/rendered", { recursive: true });
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await mkdir(join(initial.cwd, "nested-preview"), { recursive: true });
  await writeFile(
    join(initial.cwd, "nested-preview", "长文件名示例.md"),
    "文档正文\n",
  );
  const overflow = async () =>
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  for (const theme of ["light", "dark"]) {
    await sdkAction(page, "theme.set", { theme });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      theme,
    );
    for (const width of [1440, 1024, 768, 390, 375]) {
      await page.setViewportSize({ width, height: width > 700 ? 940 : 740 });
      const collapse = page.getByRole("button", {
        name: "收起侧边栏",
        exact: true,
      });
      if (width < 800 && (await collapse.isVisible())) await collapse.click();
      const workspace = page.getByRole("button", {
        name: "选择工作区",
        exact: true,
      });
      await workspace.click();
      const picker = page.getByRole("menu", { name: "选择工作区" });
      await expect(picker).toBeInViewport();
      await picker
        .getByRole("menuitem", { name: "添加工作区…", exact: true })
        .click();
      const directory = page.getByRole("dialog", {
        name: "添加工作区",
        exact: true,
      });
      await expect(
        directory.getByRole("list", { name: "文件夹", exact: true }),
      ).toBeVisible();
      await expect(directory).toBeInViewport();
      await expect(
        directory.getByRole("button", { name: "打开", exact: true }),
      ).toBeInViewport();
      await overflow();
      await page.screenshot({
        path: `.local/ui-omissions/rendered/folder-${theme}-${width}.png`,
      });
      await directory
        .getByRole("button", { name: "取消", exact: true })
        .click();
      const settingsButton = page.getByRole("button", {
        name: "设置",
        exact: true,
      });
      if (!(await settingsButton.isVisible()))
        await page
          .getByRole("button", { name: "打开侧边栏", exact: true })
          .click();
      await settingsButton.click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings
        .getByRole("navigation", { name: "设置分类" })
        .getByRole("button", { name: "模型与账号", exact: true })
        .click();
      await settings
        .getByRole("button", { name: "添加自定义端点", exact: true })
        .click();
      const form = settings.locator(".custom-provider-form");
      await form
        .getByRole("textbox", { name: "提供商 ID", exact: true })
        .fill("visual-provider");
      await form
        .getByRole("button", { name: "保存端点", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        form.getByRole("button", { name: "保存端点", exact: true }),
      ).toBeInViewport();
      await overflow();
      await page.screenshot({
        path: `.local/ui-omissions/rendered/provider-${theme}-${width}.png`,
      });
      await form.getByRole("button", { name: "取消编辑", exact: true }).click();
      await settings
        .getByRole("button", { name: "关闭设置", exact: true })
        .click();
      const closeSidebar = page.getByRole("button", {
        name: "收起侧边栏",
        exact: true,
      });
      if (width < 800 && (await closeSidebar.isVisible()))
        await closeSidebar.click();
      await page
        .getByRole("button", { name: "文件与更改", exact: true })
        .click();
      await page
        .getByRole("treeitem", { name: "nested-preview", exact: true })
        .click();
      await page
        .getByRole("treeitem", { name: "长文件名示例.md", exact: true })
        .click();
      await expect(page.locator(".file-preview")).toContainText("文档正文");
      await overflow();
      await page.screenshot({
        path: `.local/ui-omissions/rendered/files-${theme}-${width}.png`,
      });
      await page
        .getByRole("button", { name: "关闭文件面板", exact: true })
        .click();
    }
  }
  expect(errors).toEqual([]);
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(
    initial.sessionId,
  );
});
