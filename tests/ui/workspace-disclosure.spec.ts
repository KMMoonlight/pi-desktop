import { test, expect } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("workspace expansion survives navigation, snapshots, search and reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "disclosure-origin" });
  await sdkAction(page, "session.name", { name: "Disclosure original" });
  const original = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const group = (path: string) => page.locator(".session-project")
    .filter({ has: page.getByTitle(path, { exact: true }) });
  const first = group(original.cwd);
  await expect(first).toHaveAttribute("open", "");
  const secondPath = join(original.agentDir, "disclosure-workspace");
  await mkdir(secondPath, { recursive: true });
  try {
    await sdkAction(page, "workspace.add", { cwd: secondPath });
    const second = group(secondPath);
    await expect(second).not.toHaveAttribute("open");
    await sdkAction(page, "session.new", { cwd: secondPath });
    await expect(second).toHaveAttribute("open", "");
    // Leaving a workspace must not close the group that was already open.
    await expect(first).toHaveAttribute("open", "");
    await sdkAction(page, "prompt", { message: "disclosure-second" });
    await sdkAction(page, "session.name", { name: "Disclosure search target" });
    const other = await sdkAction<DesktopSnapshot>(page, "snapshot");

    // Explicit choices must survive both snapshot refreshes and navigation.
    await first.locator("summary").press("Enter");
    await expect(first).not.toHaveAttribute("open");
    await second.locator("summary").click();
    await expect(second).not.toHaveAttribute("open");
    await sdkAction(page, "session.name", { name: "Disclosure search target updated" });
    await expect(second).not.toHaveAttribute("open");
    await sdkAction(page, "session.switch", { path: original.sessionFile });
    await expect(first).not.toHaveAttribute("open");
    await first.locator("summary").press("Space");
    await expect(first).toHaveAttribute("open", "");
    await sdkAction(page, "session.switch", { path: other.sessionFile });
    await expect(first).toHaveAttribute("open", "");
    await expect(second).not.toHaveAttribute("open");

    // Search opens matching groups temporarily without changing the saved choice.
    await page.getByRole("button", { name: "搜索会话", exact: true }).click();
    const search = page.getByRole("textbox", { name: "搜索会话", exact: true });
    await search.fill("Disclosure search target");
    await expect(second).toHaveAttribute("open", "");
    await search.press("Escape");
    await expect(second).not.toHaveAttribute("open");
    await expect(first).toHaveAttribute("open", "");
    await page.reload();
    await expect(first).toHaveAttribute("open", "");
    await expect(second).not.toHaveAttribute("open");

    await second.getByRole("button", { name: "在 disclosure-workspace 中新建会话", exact: true }).click();
    await expect(second).toHaveAttribute("open", "");
    await expect(first).toHaveAttribute("open", "");
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).not.toBe(other.sessionId);
    await page.reload();
    await expect(first).toHaveAttribute("open", "");
    await expect(second).toHaveAttribute("open", "");
  } finally {
    try {
      await sdkAction(page, "session.new", { cwd: original.cwd });
    } finally {
      try {
        await sdkAction(page, "workspace.remove", { cwd: secondPath });
      } finally {
        await rm(secondPath, { recursive: true, force: true });
      }
    }
  }
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).recentWorkspaces)
    .not.toContain(secondPath);
});
