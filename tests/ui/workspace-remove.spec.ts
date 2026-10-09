import { test, expect } from "@playwright/test";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("workspace removal confirms, persists an empty selection and restores history when re-added", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const cwd = join(initial.agentDir, "workspace-remove-ui");
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, "keep.txt"), "Preserved file");
  try {
    await sdkAction(page, "session.new", { cwd });
    await sdkAction(page, "session.name", { name: "保留的历史会话" });
    const selected = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const remove = page.getByRole("button", {
      name: "移除工作区 workspace-remove-ui",
      exact: true,
    });
    const sessionRow = page.locator(`.session-row[data-session-id="${selected.sessionId}"]`);
    const sessionDelete = sessionRow.getByRole("button", { name: "删除会话", exact: true });
    await mkdir(".local/workspace-remove", { recursive: true });
    for (const theme of ["light", "dark"]) {
      await sdkAction(page, "theme.set", { theme });
      await page.mouse.move(600, 90);
      for (const button of [remove, sessionDelete]) {
        await expect(button).toHaveCSS("opacity", "0");
        await expect(button).toHaveCSS("pointer-events", "none");
        await expect(button).toHaveCSS("color", "rgb(198, 69, 69)");
        await expect(button.locator("svg")).toHaveCSS("color", "rgb(198, 69, 69)");
        await expect(button.locator("svg")).toHaveCSS("stroke", "rgb(198, 69, 69)");
      }
      await remove.locator("..").hover();
      await expect(remove).toHaveCSS("opacity", "1");
      await expect(sessionDelete).toHaveCSS("opacity", "0");
      await sessionRow.hover();
      await expect(sessionDelete).toHaveCSS("opacity", "1");
      await expect(remove).toHaveCSS("opacity", "0");
      await page.screenshot({ path: `.local/workspace-remove/session-delete-${theme}.png` });
      // A mouse click leaves focus on the row; that must not keep delete visible.
      await sessionRow.getByRole("button").first().click();
      await page.mouse.move(600, 90);
      await expect(sessionDelete).toHaveCSS("opacity", "0");
    }
    await sdkAction(page, "theme.set", { theme: "light" });
    for (const viewport of [
      { width: 1440, height: 940 },
      { width: 760, height: 580 },
    ]) {
      await page.setViewportSize(viewport);
      await remove.locator("..").hover();
      await expect(remove).toBeInViewport({ ratio: 1 });
      const removeBox = (await remove.boundingBox())!;
      const addBox = (await page
        .getByRole("button", {
          name: "在 workspace-remove-ui 中新建会话",
          exact: true,
        })
        .boundingBox())!;
      expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(addBox.x);
      expect(Math.abs(removeBox.y - addBox.y)).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: `.local/workspace-remove/sidebar-${viewport.width}.png`,
      });
    }
    await page.setViewportSize({ width: 1440, height: 940 });
    await remove.locator("..").hover();
    await remove.click();
    const dialog = page.getByRole("dialog", {
      name: "移除工作区",
      exact: true,
    });
    await expect(dialog).toContainText("本地文件和历史会话会保留");
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(remove).toBeVisible();
    // Leave only the selected workspace, then remove it through the UI.
    for (const other of selected.recentWorkspaces.filter(
      (path) => path !== cwd,
    ))
      await sdkAction(page, "workspace.remove", { cwd: other });
    await remove.locator("..").hover();
    await remove.click();
    await dialog
      .getByRole("button", { name: "移除工作区", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".session-project")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "打开工作区", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("pi.workspace.userSelection"),
      ),
    ).toBe("");
    await access(selected.sessionFile!);
    await access(join(cwd, "keep.txt"));
    await page.reload();
    await expect(
      page.getByRole("button", { name: "打开工作区", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".session-project")).toHaveCount(0);
    await sdkAction(page, "workspace.add", { cwd });
    await sdkAction(page, "initialize", { cwd });
    await expect(editor).toBeVisible();
    await expect(
      page.locator(`.session-row[data-session-id="${selected.sessionId}"]`),
    ).toContainText("保留的历史会话");
    expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(
      selected.sessionId,
    );
  } finally {
    await sdkAction(page, "initialize", { cwd: initial.cwd });
    await page.evaluate(
      (cwd) => localStorage.setItem("pi.workspace.userSelection", cwd),
      initial.cwd,
    );
  }
});
