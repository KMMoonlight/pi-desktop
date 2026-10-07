import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("metadata is disclosed at its controls and original task input remains usable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建会话", exact: true }),
  ).toBeEnabled();
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toHaveAttribute("placeholder", "描述你的任务…");
  await expect(
    page.locator(".composer label > span.visually-hidden"),
  ).toHaveCount(1);
  await expect(
    page.locator(".sidebar-runtime,.prompt-shortcut,.resource-path"),
  ).toHaveCount(0);
  await expect(page.locator(".conversation-empty p")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "选择工作区", exact: true })).toHaveAttribute("title", snapshot.cwd);
  await page.mouse.move(700, 150);
  await page
    .getByRole("button", { name: "查看上下文与用量", exact: true })
    .click();
  await page.getByRole("button", { name: "打开完整检查器", exact: true }).click();
  await expect(page.getByText("会话检查器", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
  await page.getByRole("button", { name: "资源", exact: true }).click();
  const resource = page.locator(".resource-row").first();
  await resource.locator("strong").hover();
  await expect(page.getByRole("tooltip")).toContainText(snapshot.agentDir);
  await page.mouse.move(700, 90);
  await page.screenshot({ path: ".local/modern-evidence/resources-final.png" });
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page.getByRole("button", { name: "分析项目", exact: true }).click();
  await expect(composer).toHaveValue("分析这个项目的目录结构和主要模块。");
  await page.screenshot({ path: ".local/modern-evidence/composer-final.png" });
  await composer.fill("/desktop-nat");
  await expect(
    page.getByRole("listbox", { name: "选择", exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: /desktop-native-form/ }).click();
  await expect(composer).toHaveValue("/desktop-native-form ");
  await expect(composer).toBeFocused();
});

test("code and file review retain exact copy data with readable narrow diff sections", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建会话", exact: true }),
  ).toBeEnabled();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "presentation-code-probe" });
  const code = page.locator(".message-assistant .code-block").first();
  await expect(code).toBeVisible();
  const text = 'const message = "你好，Pi";\nconsole.log(message);';
  await code.getByRole("button", { name: /复制.*代码/ }).click();
  await expect
    // Windows clipboard uses CRLF; compare every content character with LF.
    .poll(async () =>
      (await page.evaluate(() => navigator.clipboard.readText())).replace(
        /\r\n/g,
        "\n",
      ),
    )
    .toBe(text);
  await page.screenshot({
    path: ".local/modern-evidence/transcript-final.png",
  });

  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const git = promisify(execFile);
  await git("git", ["init", "--quiet"], { cwd: snapshot.cwd });
  await git("git", ["add", "test-note.txt"], { cwd: snapshot.cwd });
  await git(
    "git",
    [
      "-c",
      "user.name=UI Fixture",
      "-c",
      "user.email=ui@example.test",
      "commit",
      "--quiet",
      "-m",
      "File review fixture",
    ],
    { cwd: snapshot.cwd },
  );
  const originalContent = await readFile(join(snapshot.cwd, "test-note.txt"));
  try {
    await writeFile(
      join(snapshot.cwd, "test-note.txt"),
      "Updated file content.\nA second line.\n",
    );
    await page.getByRole("button", { name: "文件与更改", exact: true }).click();
    await page.getByRole("button", { name: "更改", exact: true }).click();
    await expect(page.locator(".diff-file > summary").first()).toContainText(
      "test-note.txt",
    );
    await expect(page.locator(".diff-code")).toContainText(
      "Updated file content.",
    );
    await expect(page.locator(".diff-code")).toContainText(
      "Real file attachment content.",
    );
    await expect(
      page.locator(".diff-line-number").filter({ hasText: /^1$/ }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "复制文件 diff", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("diff --git");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 940 });
      const backdrop = page.getByRole("button", {
        name: "关闭侧边栏遮罩",
        exact: true,
      });
      if (await backdrop.isVisible()) await backdrop.click();
      await page.mouse.move(10, 930);
      await expect(page.locator(".diff-file > summary").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.local/modern-evidence/diff-${width}-final.png`,
      });
    }
  } finally {
    await writeFile(join(snapshot.cwd, "test-note.txt"), originalContent);
  }
});
