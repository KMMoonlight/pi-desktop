import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

const exec = promisify(execFile);

test("composer shows the current Git branch and follows repository and branch changes", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const repo = join(initial.agentDir, "composer-git-repo");
  const nested = join(repo, "nested");
  const plain = join(initial.agentDir, "composer-no-git");
  const worktree = join(initial.agentDir, "composer-worktree");
  await mkdir(nested, { recursive: true });
  await mkdir(plain, { recursive: true });
  const git = (...args: string[]) => exec("git", args, { cwd: repo, windowsHide: true });
  await git("init", "--quiet", "--initial-branch=main");
  await git("-c", "user.name=Pi Desktop Test", "-c", "user.email=test@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "Branch fixture");
  const branch = page.locator(".composer-usage .composer-git-branch");
  try {
    await sdkAction(page, "session.new", { cwd: plain });
    await expect(branch).toHaveCount(0);
    await sdkAction(page, "session.new", { cwd: nested });
    await expect(branch).toHaveText("main");
    expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).gitBranch).toBe("main");

    const longBranch = "feature/very-long-branch-name-for-checking-composer-layout-and-truncation";
    await git("checkout", "--quiet", "-b", longBranch);
    // No snapshot action here: the SDK watcher must push the branch update.
    await expect(branch).toHaveText(longBranch);
    await expect(branch).toHaveAttribute("title", longBranch);
    await mkdir(".local/composer-git-branch", { recursive: true });
    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 940 });
      const backdrop = page.getByRole("button", { name: "关闭侧边栏遮罩", exact: true });
      if (await backdrop.isVisible()) await backdrop.click({ position: { x: width - 5, y: 500 } });
      for (const theme of ["light", "dark"]) {
        await sdkAction(page, "theme.set", { theme });
        await expect(branch).toBeVisible();
        const box = (await branch.boundingBox())!;
        const metadata = (await page.locator(".composer-usage").boundingBox())!;
        const usage = (await page.locator(".composer-usage .session-token-usage").boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(usage.x + usage.width);
        expect(Math.abs(box.x + box.width - metadata.x - metadata.width + 4)).toBeLessThan(1);
        expect(await branch.locator("span").evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.locator(".composer-region").screenshot({ path: `.local/composer-git-branch/${width}-${theme}.png` });
      }
    }

    await git("checkout", "--quiet", "--detach", "HEAD");
    await expect(branch).toHaveText("分离 HEAD");
    expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).gitBranch).toBe("detached");
    await sdkAction(page, "session.new", { cwd: plain });
    await expect(branch).toHaveCount(0);
    await git("worktree", "add", "--quiet", "-b", "feature/worktree", worktree);
    await sdkAction(page, "session.new", { cwd: worktree });
    await expect(branch).toHaveText("feature/worktree");
    await sdkAction(page, "session.new", { cwd: nested });
    await expect(branch).toHaveText("分离 HEAD");
  } finally {
    try {
      await sdkAction(page, "theme.set", { theme: "light" });
      await sdkAction(page, "session.new", { cwd: initial.cwd });
    } finally {
      try {
        for (const cwd of [nested, plain, worktree])
          await sdkAction(page, "workspace.remove", { cwd });
      } finally {
        await Promise.all([repo, plain, worktree].map(path =>
          rm(path, { recursive: true, force: true })));
      }
    }
  }
  const restored = await sdkAction<DesktopSnapshot>(page, "snapshot");
  for (const path of [nested, plain, worktree])
    expect(restored.recentWorkspaces).not.toContain(path);
});
