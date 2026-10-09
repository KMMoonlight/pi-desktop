import { test, expect, type Page } from "@playwright/test";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { sdkAction } from "../editor-workflows";
import { selectField } from "../select-field";
import type { DesktopSnapshot } from "../../shared/types";

const phase = process.env.DESIGN_CAPTURE_PHASE ?? "after";
const directory = `${process.env.DESIGN_CAPTURE_ROOT ?? ".local/desktop-ui-review"}/${phase}`;
async function capture(page: Page, name: string) {
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: `${directory}/${name}.png`,
    animations: "disabled",
  });
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await expect
    .poll(
      async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).changing,
    )
    .toBe(false);
  await sdkAction(page, "session.new");
});

test("desktop file and integration feedback explains empty, preview and failure states", async ({
  page,
}) => {
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await writeFile(
    join(snapshot.cwd, "review-image.png"),
    await readFile("src-tauri/icons/icon.png"),
  );
  await writeFile(
    join(snapshot.cwd, "review-binary.bin"),
    Buffer.from([0, 1, 2, 3]),
  );
  await page.getByRole("button", { name: "文件与更改", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "review-image.png", exact: true })
    .click();
  await expect(page.locator(".file-preview img")).toBeVisible();
  await capture(page, "files-image-preview");
  await page
    .getByRole("treeitem", { name: "review-binary.bin", exact: true })
    .click();
  await expect(page.locator(".file-preview")).toContainText(
    "该文件是二进制文件",
  );
  await expect(
    page.getByRole("button", { name: "重试读取", exact: true }),
  ).toBeVisible();
  await capture(page, "files-binary-feedback");
  let fail = true;
  await page.route("**/api/action", async (route) => {
    if (route.request().postDataJSON()?.action === "git.changes" && fail) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Git review fixture: temporarily unavailable",
        }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "更改", exact: true }).click();
  const gitError = page.locator(".diff-view").getByRole("alert");
  await expect(gitError).toContainText("更改读取失败");
  await page.getByText("错误详情", { exact: true }).click();
  await expect(gitError).toContainText(
    "temporarily unavailable",
  );
  await capture(page, "files-git-failure");
  fail = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "当前工作区未启用 Git", exact: true }),
  ).toBeVisible();
  await capture(page, "files-no-git");
  await page.getByRole("button", { name: "关闭文件面板", exact: true }).click();
  const original = await sdkAction<string>(page, "config.read", {
    name: "mcp.json",
    local: false,
  });
  try {
    await sdkAction(page, "config.save", {
      name: "mcp.json",
      local: false,
      content: JSON.stringify({
        mcpServers: {
          "desktop-review": { command: "node", args: [], enabled: false },
        },
      }),
    });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByRole("button", { name: "MCP", exact: true }).click();
    await expect(settings.locator(".server-address")).toHaveText("node");
    await capture(page, "mcp-configured-disabled");
  } finally {
    await sdkAction(page, "config.save", {
      name: "mcp.json",
      local: false,
      content: original || "{}",
    });
  }
});

test("desktop settings retain category navigation and usable content at native window sizes", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  for (const category of [
    "常规",
    "外观与显示",
    "模型与账号",
    "项目",
    "MCP",
    "扩展与技能",
    "扩展包",
    "高级",
  ]) {
    await settings.getByRole("button", { name: category, exact: true }).click();
    await expect(
      settings.getByRole("heading", { name: category, exact: true }),
    ).toBeVisible();
    await capture(page, `settings-${category}`);
  }
  const config = settings.getByRole("textbox", {
    name: "配置 JSON",
    exact: true,
  });
  await config.fill('{"providers":');
  await settings.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(settings.getByRole("alert")).toBeInViewport();
  await capture(page, "settings-invalid-config");
  await config.fill("{}");
  await settings.getByText("完整设置", { exact: true }).click();
  await settings
    .getByRole("textbox", { name: "完整设置 JSON", exact: true })
    .fill('{"retry":');
  await settings
    .getByRole("button", { name: "保存完整设置", exact: true })
    .click();
  await expect(settings.getByRole("alert")).toContainText(
    "设置必须是有效的 JSON 对象",
  );
  if (phase === "after")
    await expect(settings.getByRole("alert")).toBeInViewport();
  await capture(page, "settings-invalid-json");
  for (const size of [
    { width: 1100, height: 760 },
    { width: 760, height: 580 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    // The native desktop minimum still has room for category navigation.
    if (phase === "after")
      await expect(
        settings.getByRole("navigation", { name: "设置分类" }),
      ).toBeVisible();
    await capture(page, `settings-native-${size.width}`);
    await expect(
      settings.getByRole("button", { name: "关闭设置", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("desktop integration forms and resource descriptions are reviewable", async ({
  page,
}) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings
    .getByRole("button", { name: "模型与账号", exact: true })
    .click();
  await settings
    .getByRole("button", { name: "添加提供商", exact: true })
    .click();
  await capture(page, "providers-add");
  await settings
    .getByRole("button", { name: "返回已连接账号", exact: true })
    .click();
  await settings.getByRole("button", { name: "管理", exact: true }).click();
  await capture(page, "provider-methods");
  await settings
    .getByRole("button", { name: "添加自定义端点", exact: true })
    .click();
  await capture(page, "provider-endpoint-form");
  await settings.getByRole("button", { name: "保存端点", exact: true }).click();
  await expect(settings.getByRole("alert")).toBeVisible();
  await capture(page, "provider-endpoint-invalid");
  await settings.getByRole("button", { name: "取消编辑", exact: true }).click();
  await settings.getByRole("button", { name: "MCP", exact: true }).click();
  await settings
    .getByRole("button", { name: "添加服务器", exact: true })
    .click();
  await capture(page, "mcp-stdio-form");
  await selectField(
    settings.getByRole("combobox", { name: "传输方式", exact: true }),
    "http",
  );
  await capture(page, "mcp-http-form");
  await settings.getByRole("button", { name: "取消添加", exact: true }).click();
  await settings.getByRole("button", { name: "扩展包", exact: true }).click();
  await settings
    .getByRole("button", { name: "添加扩展包", exact: true })
    .click();
  await capture(page, "packages-add-form");
  await settings
    .getByRole("button", { name: "扩展与技能", exact: true })
    .click();
  await settings.getByRole("button", { name: /Skills/ }).click();
  await capture(page, "resources-skills");
  if (phase === "after") {
    await settings
      .getByRole("button", { name: /展开说明/ })
      .first()
      .click();
    await capture(page, "resources-description-expanded");
  }
  await settings
    .getByRole("textbox", { name: "搜索资源", exact: true })
    .fill("not-a-resource");
  await expect(
    settings.getByText("没有匹配的资源", { exact: true }),
  ).toBeVisible();
  await capture(page, "resources-empty-search");
  await settings
    .getByRole("textbox", { name: "搜索资源", exact: true })
    .fill("");
  await settings.locator(".command-list").scrollIntoViewIfNeeded();
  await capture(page, "resources-commands");
});

test("desktop task controls, local dialogs and notifications remain accessible", async ({
  page,
}) => {
  await capture(page, "workspace-empty");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await page.getByRole("combobox", { name: "模型", exact: true }).click();
  await capture(page, "composer-model-selector");
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "思考等级", exact: true }).click();
  await capture(page, "composer-thinking-selector");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await capture(page, "composer-context-menu");
  await page.keyboard.press("Escape");
  await composer.fill("/desktop-nat");
  await expect(
    page.getByRole("listbox", { name: "选择", exact: true }),
  ).toBeVisible();
  await capture(page, "composer-completion");
  await composer.fill("");
  await page.locator(".header-title h1").hover();
  await page.getByRole("button", { name: "重命名会话", exact: true }).click();
  await capture(page, "dialog-rename");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  for (const name of [
    "导入会话",
    "导出会话",
    "压缩上下文",
    "运行 Shell 命令…",
  ]) {
    await page.getByRole("button", { name: "会话操作", exact: true }).click();
    await capture(page, "session-actions");
    await page.getByRole("button", { name, exact: true }).click();
    await capture(page, `dialog-${name.replace("…", "")}`);
    await page.getByRole("button", { name: "取消", exact: true }).click();
  }
  await sdkAction(page, "prompt", { message: "/notice-probe" });
  await expect(page.locator(".notice")).toBeVisible();
  await capture(page, "notifications");
  // A persistent notice must not intercept the primary desktop header controls.
  if (phase === "after") {
    await page.getByRole("button", { name: "终端", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Pi 终端", exact: true }),
    ).toBeVisible();
  }
});

test("desktop conversation, files, Git and terminal show actual content", async ({
  page,
}) => {
  test.setTimeout(90000);
  await sdkAction(page, "prompt", { message: "presentation-code-probe" });
  await expect(
    page.getByRole("heading", { name: "Review result", exact: true }),
  ).toBeVisible();
  await capture(page, "chat-markdown-code-table");
  await sdkAction(page, "prompt", { message: "run-tool" });
  await expect(
    page.getByText("SDK desktop tool verified.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "展开 read 输出", exact: true })
    .click();
  await capture(page, "chat-tool-expanded");
  await page
    .getByRole("button", { name: "查看上下文与用量", exact: true })
    .click();
  await capture(page, "context-usage-popover");
  await page
    .getByRole("button", { name: "打开完整检查器", exact: true })
    .click();
  await capture(page, "inspector");
  await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const original = await readFile(join(snapshot.cwd, "test-note.txt"));
  const hadGit = await access(join(snapshot.cwd, ".git")).then(
    () => true,
    () => false,
  );
  await mkdir(join(snapshot.cwd, "review-folder"), { recursive: true });
  await writeFile(
    join(snapshot.cwd, "review-folder", "long-file-name-for-desktop-review.ts"),
    "export const desktop = true;\n",
  );
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: snapshot.cwd });
  git(["init", "--quiet"]);
  git(["add", "test-note.txt"]);
  git([
    "-c",
    "user.name=UI Review",
    "-c",
    "user.email=review@example.test",
    "commit",
    "--quiet",
    "-m",
    "Review fixture",
  ]);
  await writeFile(
    join(snapshot.cwd, "test-note.txt"),
    "Updated file content.\nSecond line.\n",
  );
  await page.getByRole("button", { name: "文件与更改", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "test-note.txt", exact: true })
    .click();
  await expect(page.locator(".source-code")).toContainText(
    "Updated file content.",
  );
  await capture(page, "files-text-preview");
  if (phase === "after") {
    const tree = await page.locator(".file-list").boundingBox();
    const preview = await page.locator(".file-preview").boundingBox();
    expect(preview!.x).toBeGreaterThan(tree!.x + tree!.width - 1);
  }
  await page.getByRole("button", { name: "更改", exact: true }).click();
  await expect(page.locator(".diff-code")).toContainText(
    "Updated file content.",
  );
  await capture(page, "files-git-diff");
  await writeFile(join(snapshot.cwd, "test-note.txt"), original);
  if (!hadGit) await rm(join(snapshot.cwd, ".git"), { recursive: true });
  await page.getByRole("button", { name: "关闭文件面板", exact: true }).click();
  await page.getByRole("button", { name: "终端", exact: true }).click();
  const shell = page.locator('[data-terminal-source="shell"]');
  await shell
    .locator(".xterm-helper-textarea")
    .pressSequentially("echo DESKTOP_UI_REVIEW");
  await shell.locator(".xterm-helper-textarea").press("Enter");
  await expect(shell.locator(".xterm-rows")).toContainText("DESKTOP_UI_REVIEW");
  await capture(page, "terminal-shell");
  await page.getByRole("button", { name: "Pi 扩展", exact: true }).click();
  await capture(page, "terminal-extension");
  await page.getByRole("button", { name: "关闭终端", exact: true }).click();
  await sdkAction(page, "theme.set", { theme: "dark" });
  await capture(page, "chat-dark");
  await sdkAction(page, "theme.set", { theme: "light" });
});

test("desktop session history, branches and folder picker retain clear navigation", async ({
  page,
}) => {
  const prompt = async (message: string) => {
    await sdkAction(page, "prompt", { message });
    await expect
      .poll(
        async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
      )
      .toBe(false);
    return sdkAction<DesktopSnapshot>(page, "snapshot");
  };
  const root = await prompt("Desktop review root");
  await prompt("First branch");
  await sdkAction(page, "session.navigate", {
    id: root.leafId,
    summarize: false,
  });
  await prompt("Second branch");
  await page.getByRole("button", { name: "会话树", exact: true }).click();
  await expect(page.getByRole("tree", { name: "会话分支" })).toBeVisible();
  await capture(page, "session-tree-branches");
  await page
    .getByRole("button", { name: "编辑节点标签", exact: true })
    .last()
    .click();
  await capture(page, "dialog-node-label");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索会话树", exact: true })
    .fill("Second branch");
  await capture(page, "session-tree-search");
  await page.getByRole("button", { name: "搜索会话", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索会话", exact: true })
    .fill("missing-session");
  await capture(page, "session-history-empty-search");
  await page.getByRole("button", { name: "添加工作区", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, "workspace-folder-picker");
  await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
  await capture(page, "workspace-new-folder-form");
});

test("desktop streaming, queues, attachments and SDK dialog carriers expose their states", async ({
  page,
}) => {
  test.setTimeout(90000);
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await composer.fill("application-status-gate");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止任务", exact: true }),
  ).toBeVisible();
  await capture(page, "chat-streaming");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "常规", exact: true }).click();
  await selectField(settings.getByRole("combobox", { name: "运行中发送消息", exact: true }), "followUp");
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await composer.fill("Finish with a desktop review summary");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByText("待处理消息", { exact: true })).toBeVisible();
  await capture(page, "chat-followup-queue");
  await page.getByRole("button", { name: "取回编辑", exact: true }).click();
  // Taking a queued message back restores the draft, so the shared action is
  // Send until that draft is cleared, as it is for any other running input.
  await expect(composer).toHaveValue("Finish with a desktop review summary");
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible();
  await composer.fill("");
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止任务", exact: true }),
  ).toBeHidden();
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "thinking-label-probe" });
  await expect(page.locator("details.thinking-block")).toBeVisible();
  await capture(page, "chat-thinking");
  await page.getByRole("button", { name: "文件与更改", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "test-note.txt", exact: true })
    .click();
  await page.getByRole("button", { name: "添加到消息", exact: true }).click();
  await expect(page.getByRole("button", { name: "关闭文件面板", exact: true })).toHaveCount(0);
  await expect(page.locator(".attachment-list")).toContainText("test-note.txt");
  await capture(page, "composer-file-attachment");
  await sdkAction(page, "prompt", { message: "/desktop-dialog" });
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Extension confirmation" }),
  ).toBeVisible();
  await capture(page, "sdk-confirm-dialog");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "Extension input", exact: true }),
  ).toBeVisible();
  await capture(page, "sdk-input-dialog");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await capture(page, "sdk-widget-and-status");
  await sdkAction(page, "prompt", { message: "/desktop-native-form" });
  await expect(
    dialog.getByRole("heading", { name: "Extension task", exact: true }),
  ).toBeVisible();
  await capture(page, "sdk-native-form");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await sdkAction(page, "prompt", { message: "/desktop-native-overlay" });
  const overlay = page.locator(".desktop-overlay");
  await expect(overlay).toBeVisible();
  await capture(page, "sdk-overlay");
  await overlay.getByRole("button", { name: "关闭扩展", exact: true }).click();
});
