import { expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sdkAction } from "./editor-workflows.ts";
import { selectField } from "./select-field.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyNativeDesktopWorkspace(page: Page, desktopProcessId: number) {
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "run-tool" });
  await expect(page.locator(".composer-usage .generation-status")).toContainText("tok/s");
  const beforePicker = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await page.getByRole("button", { name: "添加工作区", exact: true }).click();
  const cancellation = await promisify(execFile)("powershell.exe", [
    "-NoProfile", "-File", "tests/cancel-native-directory.ps1",
    "-DesktopProcessId", String(desktopProcessId),
    "-PickerTitle", "选择文件夹并新建会话",
  ], { windowsHide: true, timeout: 15000 });
  expect(cancellation.stdout).toContain("CancelledTestDirectoryPicker");
  await expect(page.getByRole("button", { name: "添加工作区", exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "添加工作区", exact: true })).toHaveCount(0);
  const afterPicker = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(afterPicker.sessionId).toBe(beforePicker.sessionId);
  expect(afterPicker.recentWorkspaces).toEqual(beforePicker.recentWorkspaces);
  const row = page.locator('.tool-execution[data-tool-call-id="call-read"]');
  await row
    .getByRole("button", { name: "展开 read 输出", exact: true })
    .click();
  await expect(row).toContainText("Real file attachment content.");
  await row
    .getByRole("button", { name: "收起 read 输出", exact: true })
    .click();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(snapshot.cwd, "桌面 file #1%.txt");
  await writeFile(
    path,
    Array.from({ length: 45 }, (_, i) => `Native line ${i + 1}`).join("\n"),
  );
  await sdkAction(page, "message.custom", {
    customType: "workspace-preview",
    content: `[Workspace source](${pathToFileURL(path).href}#L32)`,
  });
  await editor.fill("Windows 原生草稿");
  await page
    .getByRole("link", { name: "Workspace source", exact: true })
    .click();
  const line = page.locator('.file-preview [data-file-line="32"]');
  await expect(line).toContainText("Native line 32");
  await expect(line).toBeInViewport();
  await page.getByRole("button", { name: "关闭文件面板", exact: true }).click();
  await expect(editor).toHaveValue("Windows 原生草稿");
  await page.getByRole("button", { name: "终端", exact: true }).click();
  const terminal = await page.locator(".terminal-panel.is-open").boundingBox();
  const composer = await page.locator(".composer").boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(terminal!.y + 1);
  await page.getByRole("separator", { name: "调整终端高度" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(
      async () =>
        (await page.locator(".terminal-panel.is-open").boundingBox())!.height,
    )
    .toBeGreaterThan(terminal!.height);
  await page.getByRole("button", { name: "关闭终端", exact: true }).click();
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "添加上下文", exact: true });
  await menu.getByRole("button", { name: "项目文件", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "test-note.txt", exact: true })
    .click();
  await page.getByRole("button", { name: "添加到消息", exact: true }).click();
  await expect(page.locator(".attachment-list")).toContainText("test-note.txt");
  await expect(page.getByRole("button", { name: "对话", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await menu
    .getByRole("textbox", { name: "搜索技能与命令" })
    .fill("desktop-dialog");
  await menu
    .getByRole("button", { name: "desktop-dialog 命令", exact: true })
    .click();
  await expect(editor).toHaveValue("/desktop-dialog ");
  await expect(editor).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "思考等级", exact: true }),
  ).toContainText("关闭思考");
  await page
    .locator(".session-project .session-row")
    .filter({ hasText: "run-tool" })
    .getByRole("button", { name: "固定会话", exact: true })
    .click();
  await expect(
    page.locator(".session-row.is-pinned"),
  ).toContainText("run-tool");
  await expect(page.locator(".composer").getByRole("button", { name: "查看上下文与用量" })).toBeVisible();
  await expect(page.getByRole("button", { name: "文件与更改", exact: true })).toHaveCount(1);
  await expect(page.getByLabel("就绪", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新历史会话" })).toHaveCount(0);
  await expect(page.locator(".sidebar").getByRole("button", { name: "会话树", exact: true })).toHaveCount(0);
  await page.screenshot({
    path: ".local/workspace-evidence/native-workspace.png",
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型与账号", exact: true }).click();
  await expect(page.locator(".provider-list")).not.toContainText("未配置");
  await page.getByRole("button", { name: "添加提供商", exact: true }).click();
  await expect(page.locator(".provider-list")).toContainText("未配置");
  const categories = page.getByRole("navigation", { name: "设置分类" });
  await categories.getByRole("button", { name: "外观与显示", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "颜色模式", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "配置范围", exact: true })).toHaveCount(0);
  await categories.getByRole("button", { name: "MCP", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "添加服务器", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "取消添加", exact: true }).click();
  await categories.getByRole("button", { name: "常规", exact: true }).click();
  await selectField(page.getByRole("combobox", { name: "执行中消息", exact: true }), "all");
  await expect(page.getByText("有未保存的更改", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("设置已保存", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".local/structure-evidence/native-settings.png" });
  for (const label of ["模型与账号", "高级"]) {
    await categories.getByRole("button", { name: label, exact: true }).click();
    const content = page.locator(".settings-content");
    await expect.poll(() => content.evaluate(node => node.scrollTop)).toBe(0);
    const clipped = await content.evaluate(node => [...node.children]
      .filter(child => child.getBoundingClientRect().height > 0 && getComputedStyle(child).overflowY === "visible" && child.scrollHeight > child.clientHeight + 3)
      .map(child => child.className));
    expect(clipped).toEqual([]);
    await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(page.getByRole("button", { name: "保存设置", exact: true })).toBeInViewport();
  }
  await page.screenshot({ path: ".local/sidebar-settings/native-settings-scroll.png" });
  const beforeLanguage = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await categories.getByRole("button", { name: "外观与显示", exact: true }).click();
  await selectField(page.getByRole("combobox", { name: "界面语言", exact: true }), "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("combobox", { name: "Interface language", exact: true })).toHaveText("English");
  await page.screenshot({ path: ".local/i18n/native-english-settings.png" });
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  const beforeDraft = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(beforeDraft).toHaveValue(beforeLanguage.editor.text);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(beforeLanguage.editor.text);
  const afterLanguage = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect([afterLanguage.cwd, afterLanguage.sessionId, afterLanguage.messages, afterLanguage.globalSettings])
    .toEqual([beforeLanguage.cwd, beforeLanguage.sessionId, beforeLanguage.messages, beforeLanguage.globalSettings]);
  await page.screenshot({ path: ".local/i18n/native-english-chat.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings categories", exact: true }).getByRole("button", { name: "Appearance", exact: true }).click();
  await selectField(page.getByRole("combobox", { name: "Interface language", exact: true }), "zh-CN");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
}
