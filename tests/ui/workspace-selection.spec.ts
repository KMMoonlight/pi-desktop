import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("a fresh frontend attaches to the selected workspace without replacing its session", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  const before = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const selected = join(before.cwd, "实际项目 中文");
  await mkdir(selected, { recursive: true });
  const context = await browser.newContext({ baseURL });
  try {
    await sdkAction(page, "session.new", { cwd: selected });
    await editor.fill("保留已选择工作区的草稿");
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).editor.text)
      .toBe("保留已选择工作区的草稿");
    const active = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const attached = await context.newPage();
    await attached.goto("/");
    await expect(attached.getByRole("textbox", { name: "消息", exact: true })).toHaveValue(active.editor.text);
    await expect(attached.getByRole("button", { name: "选择工作区", exact: true })).toContainText("实际项目 中文");
    await attached.reload();
    await expect(attached.getByRole("textbox", { name: "消息", exact: true })).toHaveValue(active.editor.text);
    const after = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(after.cwd).toBe(selected);
    expect(after.sessionId).toBe(active.sessionId);
  } finally {
    await context.close();
    await sdkAction(page, "initialize", { cwd: before.cwd });
    if (before.messages.length) await sdkAction(page, "session.switch", { path: before.sessionFile });
  }
});

test("workspace interaction inventory exposes selection and folder browsing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  await expect
    .soft(page.getByRole("button", { name: "选择工作区", exact: true }))
    .toBeVisible({ timeout: 1000 });
  await page.getByRole("button", { name: "添加工作区", exact: true }).click();
  await expect
    .soft(page.getByRole("list", { name: "文件夹", exact: true }))
    .toBeVisible({ timeout: 1000 });
});

test("directory browser navigates, creates, reveals dot folders and cancels without changing the session", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const before = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(before.cwd, "folder-picker-fixture");
  await mkdir(join(directory, "child"), { recursive: true });
  await mkdir(join(directory, ".hidden"), { recursive: true });
  await page.getByRole("button", { name: "添加工作区", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加工作区", exact: true });
  const path = dialog.getByRole("textbox", { name: "文件夹路径", exact: true });
  await path.fill(directory);
  await path.press("Enter");
  const files = dialog.getByRole("list", { name: "文件夹", exact: true });
  await files.getByRole("button", { name: "child", exact: true }).click();
  await expect(path).toHaveValue(join(directory, "child"));
  await expect(
    dialog
      .getByRole("list", { name: "同级文件夹" })
      .getByRole("button", { name: "child" }),
  ).toHaveAttribute("aria-current", "true");
  await dialog.getByRole("button", { name: "上一级文件夹" }).click();
  await expect(
    files.getByRole("button", { name: ".hidden", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "显示点目录" }).check();
  await expect(
    files.getByRole("button", { name: ".hidden", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "新建文件夹", exact: true }).click();
  const name = dialog.getByRole("textbox", { name: "新文件夹名称" });
  await name.fill("child");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await name.fill("中文 项目");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(path).toHaveValue(join(directory, "中文 项目"));
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await path.fill(join(directory, "missing"));
  await path.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("missing");
  await expect(
    dialog.getByRole("button", { name: "打开", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const after = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(after.sessionId).toBe(before.sessionId);
  expect(after.recentWorkspaces).toEqual(before.recentWorkspaces);
});

test("empty composer chooses a registered workspace and restores drafts; sidebar search expands and closes", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "工作区选择草稿来源" });
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  await sdkAction(page, "session.name", { name: "工作区选择原会话" });
  const before = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await editor.fill("原项目草稿");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).editor.text,
    )
    .toBe("原项目草稿");
  await sdkAction(page, "session.new");
  const second = join(before.cwd, "选中的项目");
  await mkdir(second, { recursive: true });
  await sdkAction(page, "workspace.add", { cwd: second });
  const trigger = page.getByRole("button", { name: "选择工作区", exact: true });
  await trigger.click();
  const picker = page.getByRole("menu", { name: "选择工作区" });
  await expect(
    picker.getByRole("menuitemradio", { checked: true }),
  ).toContainText(before.cwd);
  await picker.getByRole("menuitemradio").filter({ hasText: second }).click();
  await expect(trigger).toContainText("选中的项目");
  const project = page.locator('.session-project').filter({ has: page.locator('summary[title]').filter({ hasText: '选中的项目' }) });
  await expect(project.locator('.workspace-group-name')).toHaveText("选中的项目");
  await expect(project.locator('summary')).toHaveAttribute('title', second);
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).cwd).toBe(second);
  await trigger.click();
  await picker
    .getByRole("menuitemradio")
    .filter({ has: page.getByText(before.cwd, { exact: true }) })
    .click();
  await expect(trigger).not.toContainText("选中的项目");
  await sdkAction(page, "session.switch", { path: before.sessionFile });
  await expect(editor).toHaveValue("原项目草稿");
  const sidebar = page.locator(".sidebar");
  await sidebar.getByRole("button", { name: "搜索会话", exact: true }).click();
  const search = sidebar.getByRole("textbox", {
    name: "搜索会话",
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.fill("not-a-real-session");
  await expect(
    sidebar.getByText("没有匹配的会话", { exact: true }),
  ).toBeVisible();
  await search.press("Escape");
  await expect(search).toBeHidden();
  await page.keyboard.press("Control+k");
  await expect(search).toBeFocused();
});
