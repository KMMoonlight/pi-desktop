import { test, expect } from "@playwright/test";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";
const exec = promisify(execFile);

test("file tree retains parents, reveals ignored directories and opens diff sources with wrapping", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const original = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const cwd = join(original.cwd, "evidence-navigation-fixture");
  await mkdir(join(cwd, "src", "nested"), { recursive: true });
  await mkdir(join(cwd, "node_modules"), { recursive: true });
  const file = join(cwd, "src", "nested", "中文文件.txt");
  await writeFile(file, "before\n");
  await writeFile(join(cwd, "deleted.txt"), "to remove\n");
  await exec("git", ["init"], { cwd, windowsHide: true });
  await exec("git", ["add", "src", "deleted.txt"], { cwd, windowsHide: true });
  await exec(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd, windowsHide: true },
  );
  const content = `after ${"长行文字 ".repeat(100)}\n`;
  await writeFile(file, content);
  await unlink(join(cwd, "deleted.txt"));
  await sdkAction(page, "initialize", { cwd });
  await page
    .getByRole("navigation", { name: "会话视图" })
    .getByRole("button", { name: "文件与更改", exact: true })
    .click();
  const tree = page.getByRole("tree", { name: "工作区文件" });
  const src = tree.getByRole("treeitem", { name: "src", exact: true });
  await src.click();
  const nested = tree.getByRole("treeitem", { name: "nested", exact: true });
  await nested.click();
  await tree
    .getByRole("treeitem", { name: "中文文件.txt", exact: true })
    .click();
  await expect(src).toBeVisible();
  await expect(nested).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".source-code")).toContainText("after");
  await src.click();
  await expect(
    tree.getByRole("treeitem", { name: "中文文件.txt", exact: true }),
  ).toHaveCount(0);
  await expect(
    tree.getByRole("treeitem", { name: "node_modules", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: "显示隐藏与依赖目录" }).check();
  await expect(
    tree.getByRole("treeitem", { name: "node_modules", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("treeitem", { name: ".git", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "更改", exact: true }).click();
  const diff = page.locator(".diff-file").filter({ hasText: "中文文件.txt" });
  await expect(diff).toBeVisible();
  await expect(
    page.getByRole("button", { name: "源文件已删除" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "自动换行", exact: true }).click();
  await expect(diff.locator(".diff-code")).toHaveClass(/wrap-code/);
  await diff.getByRole("button", { name: "打开源文件", exact: true }).click();
  await expect(
    tree.getByRole("treeitem", { name: "中文文件.txt", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".source-code")).toHaveClass(/wrap-code/);
  const sourceRow = page.locator(".source-code > div").first();
  const gutter = (await sourceRow.locator(".line-number").boundingBox())!;
  const textBox = (await sourceRow.locator("span").last().boundingBox())!;
  expect(gutter.x + gutter.width).toBeLessThanOrEqual(textBox.x);
  expect(await page.locator(".source-code").evaluate(node => node.scrollWidth <= node.clientWidth + 2)).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir(".local/ui-omissions/evidence", { recursive: true });
  await page.screenshot({ path: ".local/ui-omissions/evidence/files.png" });
  await sdkAction(page, "initialize", { cwd: original.cwd });
});

test("conversation tree collapses actual descendants and search reveals ancestor paths", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "tree-parent" });
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  await sdkAction(page, "prompt", { message: "tree-child-needle" });
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  const before = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await page
    .getByRole("navigation", { name: "会话视图" })
    .getByRole("button", { name: "会话树", exact: true })
    .click();
  const tree = page.getByRole("tree", { name: "会话分支" });
  const count = await tree.getByRole("treeitem").count();
  expect(count).toBe(before.tree.length);
  await tree
    .getByRole("button", { name: "折叠节点", exact: true })
    .first()
    .click();
  expect(await tree.getByRole("treeitem").count()).toBeLessThan(count);
  await page
    .getByRole("textbox", { name: "搜索会话树" })
    .fill("tree-child-needle");
  await expect(tree).toContainText("tree-child-needle");
  expect(await tree.getByRole("treeitem").count()).toBeGreaterThan(1);
  await page.getByRole("textbox", { name: "搜索会话树" }).fill("");
  await page.getByRole("button", { name: "展开全部", exact: true }).click();
  await expect(tree.getByRole("treeitem")).toHaveCount(count);
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).leafId).toBe(
    before.leafId,
  );
});
