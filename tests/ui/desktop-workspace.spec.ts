import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test.beforeAll(async () => {
  await mkdir(".local/workspace-evidence", { recursive: true });
});

test("chat, evidence and docked terminal preserve drafts across desktop and narrow layouts", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "presentation-code-probe" });
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.fill("保留这段草稿");
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 940 });
    const sidebar = page.getByRole("button", {
      name: "收起侧边栏",
      exact: true,
    });
    if (width < 800 && (await sidebar.isVisible())) await sidebar.click();
    await page
      .getByRole("button", { name: "文件与更改", exact: true })
      .click();
    await page
      .getByRole("treeitem", { name: "test-note.txt", exact: true })
      .click();
    await expect(page.locator(".file-preview")).toContainText(
      "Real file attachment content.",
    );
    await expect(
      page.getByRole("heading", { name: "Review result", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `.local/workspace-evidence/files-${width}.png`,
    });
    await page
      .getByRole("button", { name: "关闭文件面板", exact: true })
      .click();
    await expect(editor).toHaveValue("保留这段草稿");
    await page.getByRole("button", { name: "终端", exact: true }).click();
    const terminal = await page
      .locator(".terminal-panel.is-open")
      .boundingBox();
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
    await page.screenshot({
      path: `.local/workspace-evidence/terminal-${width}.png`,
    });
    await page.getByRole("button", { name: "关闭终端", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  const context = page.getByRole("dialog", { name: "添加上下文", exact: true });
  await expect(
    context.getByRole("button", { name: "添加图片", exact: true }),
  ).toBeVisible();
  await context.getByRole("button", { name: "项目文件", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "test-note.txt", exact: true })
    .click();
  await page.getByRole("button", { name: "添加到消息", exact: true }).click();
  await expect(page.locator(".attachment-list")).toContainText("test-note.txt");
  await page.getByRole("button", { name: "关闭文件面板", exact: true }).click();
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await context
    .getByRole("textbox", { name: "搜索技能与命令" })
    .fill("desktop-dialog");
  await context
    .getByRole("button", { name: "desktop-dialog 命令", exact: true })
    .click();
  await expect(editor).toHaveValue("/desktop-dialog ");
  await expect(editor).toBeFocused();
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(context).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "添加上下文", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "思考等级", exact: true }),
  ).toHaveAttribute("data-value", "off");
  await expect(
    page.getByRole("combobox", { name: "思考等级", exact: true }),
  ).toContainText("关闭思考");
  await sdkAction(page, "theme.set", { theme: "dark" });
  await page.getByRole("button", { name: "文件与更改", exact: true }).click();
  await page.screenshot({ path: ".local/workspace-evidence/dark-files.png" });
  await sdkAction(page, "theme.set", { theme: "light" });
  expect(errors).toEqual([]);
});

test("encoded file references locate lines and tool controls expand only their own result", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const filename = "中文 file #1%.txt";
  const path = join(snapshot.cwd, filename);
  await writeFile(
    path,
    Array.from({ length: 60 }, (_, i) => `reference line ${i + 1}`).join("\n"),
  );
  await sdkAction(page, "message.custom", {
    customType: "desktop-reference",
    content: `[Relative file](${encodeURIComponent(filename)}#L42) · [File URL](${pathToFileURL(path).href}#L42)`,
  });
  for (const name of ["Relative file", "File URL"]) {
    await page.getByRole("link", { name, exact: true }).click();
    const line = page.locator('.file-preview [data-file-line="42"]');
    await expect(line).toHaveClass("selected-file-line");
    await expect(line).toContainText("reference line 42");
    await expect(line).toBeInViewport();
    await page
      .getByRole("button", { name: "关闭文件面板", exact: true })
      .click();
  }
  await sdkAction(page, "sdk.run", {
    path: join(snapshot.agentDir, "desktop", "tool-display-control.mjs"),
    args: { mode: "seed", expanded: false },
  });
  const row = (id: string) =>
    page.locator(`.tool-execution[data-tool-call-id="${id}"]`);
  await row("display-fallback")
    .getByRole("button", { name: "展开 display_fallback 输出", exact: true })
    .click();
  await expect(row("display-fallback")).toHaveAttribute(
    "data-tool-expanded",
    "true",
  );
  await expect(row("display-fallback")).toContainText("line 14");
  await expect(row("display-custom")).toHaveAttribute(
    "data-tool-expanded",
    "false",
  );
  await expect(
    row("display-self").locator(".tool-desktop-controls"),
  ).toHaveCount(0);
  await row("display-fallback")
    .getByRole("button", { name: "收起 display_fallback 输出", exact: true })
    .click();
  await expect(row("display-fallback")).toHaveAttribute(
    "data-tool-expanded",
    "false",
  );
  await page.screenshot({ path: ".local/workspace-evidence/tools.png" });
});

test("project groups, pinned sessions and connected account disclosure remain actionable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const original = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await sdkAction(page, "session.name", { name: "Workspace audit session" });
  await sdkAction(page, "prompt", { message: "workspace-rail-proof" });
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
  const project = join(original.cwd, "second-project");
  await mkdir(project, { recursive: true });
  try {
    await sdkAction(page, "initialize", { cwd: project });
    await sdkAction(page, "session.name", { name: "Second project session" });
    await sdkAction(page, "prompt", { message: "second-project-proof" });
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
    await expect(page.locator(".session-project")).toHaveCount(2);
    const current = page
      .locator(".session-project")
      .filter({ hasText: "Second project session" });
    await current
      .getByRole("button", { name: "固定会话", exact: true })
      .click();
    const pinned = page.locator(".session-row.is-pinned");
    await expect(pinned).toContainText("Second project session");
    await page.getByRole("button", { name: "搜索会话", exact: true }).click();
    await page
      .getByRole("textbox", { name: "搜索会话" })
      .fill("Workspace audit");
    await page.getByRole("button", { name: /Workspace audit session/ }).click();
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId,
      )
      .toBe(original.sessionId);
    await page.getByRole("textbox", { name: "搜索会话" }).fill("");
    await page.screenshot({ path: ".local/workspace-evidence/projects.png" });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "模型与账号", exact: true }).click();
    await expect(page.locator(".provider-list")).not.toContainText("未配置");
    await page.getByRole("button", { name: "添加提供商", exact: true }).click();
    await expect(page.locator(".provider-list")).toContainText("未配置");
    const provider = original.providers.find(p => !p.configured && p.methods.includes("apiKey"))!;
    await page.locator(".provider-row").filter({ has: page.getByText(provider.name, { exact: true }) })
      .getByRole("button", { name: "连接", exact: true }).click();
    await expect(
      page
        .locator(".provider-list")
        .getByRole("button", { name: "API Key", exact: true })
        .first(),
    ).toBeVisible();
    await page.screenshot({
      path: ".local/workspace-evidence/accounts-add.png",
    });
    await page
      .getByRole("button", { name: "返回已连接账号", exact: true })
      .click();
    await expect(page.locator(".provider-list")).not.toContainText("未配置");
  } finally {
    await sdkAction(page, "initialize", { cwd: original.cwd });
  }
});
