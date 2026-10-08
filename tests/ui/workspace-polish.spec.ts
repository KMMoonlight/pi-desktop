import { test, expect } from "@playwright/test";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import { selectField } from "../select-field.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test.beforeAll(() =>
  mkdir(".local/workspace-polish-evidence", { recursive: true }),
);
test("workspace disclosure, cancel, invalid path, registration and project new-session are distinct", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "workspace-origin" });
  await sdkAction(page, "session.name", { name: "Workspace origin" });
  await editor.fill("保留原项目草稿");
  const before = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const group = page
    .locator(".session-project")
    .filter({ has: page.getByText("Workspace origin", { exact: true }) });
  await group.locator("summary").click();
  await group.locator("summary").click();
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(
    before.sessionId,
  );
  await page
    .getByRole("button", { name: "添加工作区", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "添加工作区",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "打开", exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByRole("list", { name: "文件夹", exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveCount(1);
  await expect(dialog.locator(".recent-workspace, .dialog-help")).toHaveCount(0);
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: width > 700 ? 940 : 740 });
    await expect(dialog).toBeInViewport();
    await expect(dialog.getByRole("textbox", { name: "文件夹路径", exact: true })).toBeFocused();
    await expect(dialog.getByRole("button", { name: "打开", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/workspace-polish-evidence/add-workspace-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 940 });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toHaveValue("保留原项目草稿");
  await page
    .getByRole("button", { name: "添加工作区", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "文件夹路径", exact: true })
    .fill(join(before.cwd, "missing-folder"));
  await dialog.getByRole("button", { name: "转到文件夹", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("missing-folder");
  const failed = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(failed.sessionId).toBe(before.sessionId);
  expect(failed.recentWorkspaces).toEqual(before.recentWorkspaces);
  await dialog.getByRole("textbox", { name: "文件夹路径", exact: true }).fill("修正路径");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const secondPath = join(dirname(before.cwd), "桌面项目 pi-agent");
  await mkdir(secondPath, { recursive: true });
  const second = await realpath(secondPath);
  const add = async (path = second) => {
    await page
      .getByRole("button", { name: "添加工作区", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "文件夹路径", exact: true })
      .fill(path);
    await dialog.getByRole("button", { name: "转到文件夹", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "打开", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "打开", exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  await add();
  let current = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(current.cwd).toBe(second);
  expect(current.sessionId).not.toBe(before.sessionId);
  await expect(page.locator(".workspace-group-name").filter({ hasText: /^桌面项目 pi-agent$/ })).toBeVisible();
  const firstNew = current.sessionId;
  await page
    .getByRole("button", {
      name: "在 桌面项目 pi-agent 中新建会话",
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId,
    )
    .not.toBe(firstNew);
  await add(`${second}\\`);
  current = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(
    current.recentWorkspaces.filter((path) => path === second),
  ).toHaveLength(1);
  if (!(await group.evaluate((node) => (node as HTMLDetailsElement).open)))
    await group.locator("summary").click();
  await group.getByRole("button", { name: /Workspace origin/ }).click();
  await expect(editor).toHaveValue("保留原项目草稿");
  await page.screenshot({
    path: ".local/workspace-polish-evidence/sidebar-projects.png",
  });
});

test("dropdowns, output metrics and content-sized bubbles work across the agreed widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "短消息" });
  await expect(page.getByText("SDK desktop verified.", { exact: true })).toBeVisible();
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const assistant = snapshot.messages
    .filter((message) => message.role === "assistant")
    .pop()!;
  expect(assistant.outputTokens).toBe(12);
  expect(assistant.generation?.tokensPerSecond).toBeGreaterThan(0);
  await expect(page.locator(".composer-usage .generation-status")).toHaveCount(0);
  await expect(page.locator(".message-assistant .generation-status").last()).toContainText("用时");
  await expect(page.locator(".transcript")).not.toContainText("tok/s");
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 940 });
    const close = page.getByRole("button", { name: "收起侧边栏", exact: true });
    if (width < 800 && (await close.isVisible())) await close.click();
    const row = page.locator(".transcript .message-user").first();
    const bubble = await row.locator(".message-body").boundingBox();
    expect(bubble!.width).toBeLessThan((await row.boundingBox())!.width * 0.8);
    const model = page.getByRole("combobox", { name: "模型", exact: true });
    await model.click();
    const menu = page.getByRole("listbox", { name: "模型", exact: true });
    await expect(menu).toBeInViewport();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(940);
    await page.screenshot({
      path: `.local/workspace-polish-evidence/dropdown-${width}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(model).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const thinking = page.getByRole("combobox", {
    name: "思考等级",
    exact: true,
  });
  await thinking.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(thinking).toHaveAttribute(
    "data-value",
    snapshot.thinkingLevels.at(-1)!,
  );
  await selectField(thinking, "off");
  await sdkAction(page, "prompt", {
    message: `多行消息\n${"长消息内容 ".repeat(80)}\n\n\`\`\`js\n${"const long = 'abcdef'; ".repeat(20)}\n\`\`\``,
  });
  await expect(page.locator(".transcript .message-user").last()).toContainText(
    "const long",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/workspace-polish-evidence/bubble-long-375.png",
  });
  await page.setViewportSize({ width: 1440, height: 940 });
  const open = page.getByRole("button", { name: "打开侧边栏", exact: true });
  if (await open.isVisible()) await open.click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "外观与显示", exact: true }).click();
  await selectField(
    page.getByRole("combobox", { name: "颜色模式", exact: true }),
    "dark",
  );
  await page.getByRole("button", { name: "高级", exact: true }).click();
  const cache = page.getByRole("combobox", { name: "缓存预热", exact: true });
  const value = await cache.getAttribute("data-value");
  await cache.click();
  await page.keyboard.press("End");
  await page.screenshot({
    path: ".local/workspace-polish-evidence/settings-dropdown-dark.png",
  });
  await page.keyboard.press("Escape");
  await expect(cache).toHaveAttribute("data-value", value!);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await sdkAction(page, "theme.set", { theme: "light" });
  await page.getByRole("button", { name: "会话操作", exact: true }).click();
  await page
    .getByRole("button", { name: "运行 Shell 命令…", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "运行 Shell 命令", exact: true }),
  ).toContainText("供后续模型读取");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(errors).toEqual([]);
});
