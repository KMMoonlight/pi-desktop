import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot, SessionItem } from "../../shared/types.ts";

test("sidebar delete sits beside pin, supports cancellation, and clears pinned sessions and the last session", async ({
  page,
}) => {
  await mkdir(".local/session-delete", { recursive: true });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await expect
    .poll(
      async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).changing,
    )
    .toBe(false);
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const cwd = join(initial.agentDir, "session-delete-ui-workspace");
  await mkdir(cwd, { recursive: true });
  await sdkAction(page, "session.new", { cwd });
  await sdkAction(page, "session.name", { name: "保留的会话" });
  const first = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await sdkAction(page, "session.new");
  await sdkAction(page, "session.name", {
    name: "准备删除的会话标题很长时也不会盖住操作按钮",
  });
  const second = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const row = (id: string) =>
    page.locator(`.session-row[data-session-id="${id}"]`);
  const project = page
    .locator(".session-project")
    .filter({
      has: page.locator(
        'summary[aria-label="session-delete-ui-workspace workspace"]',
      ),
    });
  const target = row(second.sessionId);
  await expect(target).toBeVisible();
  await editor.fill("删除时一起清理的草稿");
  await target.hover();
  const pin = target.getByRole("button", { name: "固定会话", exact: true });
  const deletion = target.getByRole("button", {
    name: "删除会话",
    exact: true,
  });
  const pinBox = (await pin.boundingBox())!;
  const deleteBox = (await deletion.boundingBox())!;
  expect(pinBox.x + pinBox.width).toBeLessThanOrEqual(deleteBox.x);
  expect(Math.abs(pinBox.y - deleteBox.y)).toBeLessThan(1);
  const rowBox = (await target.boundingBox())!;
  for (const box of [pinBox, deleteBox]) {
    expect(box.height).toBe(32);
    expect(box.width).toBe(32);
    expect(
      Math.abs(box.y + box.height / 2 - rowBox.y - rowBox.height / 2),
    ).toBeLessThan(1);
  }
  const titleBox = (await target.locator("strong").boundingBox())!;
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(pinBox.x);
  await page.screenshot({ path: ".local/session-delete/hover.png" });
  await page.setViewportSize({ width: 760, height: 580 });
  await sdkAction(page, "theme.set", { theme: "dark" });
  await target.hover();
  await expect(deletion).toBeInViewport({ ratio: 1 });
  const narrowPin = (await pin.boundingBox())!;
  const narrowDelete = (await deletion.boundingBox())!;
  expect(narrowPin.x + narrowPin.width).toBeLessThanOrEqual(narrowDelete.x);
  await page.screenshot({ path: ".local/session-delete/hover-dark-small.png" });
  await page.setViewportSize({ width: 1440, height: 940 });
  await sdkAction(page, "theme.set", { theme: "light" });
  await pin.click();
  await expect(target).toHaveClass(/is-pinned/);
  await deletion.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("会话及其消息将被永久删除");
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: ".local/session-delete/confirmation.png" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(target).toBeVisible();
  await expect(editor).toHaveValue("删除时一起清理的草稿");
  // Deleting an inactive conversation must not change the selected session.
  await row(first.sessionId).getByRole("button").first().click();
  await expect(row(first.sessionId)).toHaveClass(/active/);
  await deletion.click();
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(target).toHaveCount(0);
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(
    first.sessionId,
  );
  expect(
    await page.evaluate(
      (id) => JSON.parse(localStorage.getItem("pi.pins") || "[]").includes(id),
      second.sessionId,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`pi.draft.${id}`),
      second.sessionId,
    ),
  ).toBeNull();
  await page.reload();
  await editor.waitFor();
  await expect(target).toHaveCount(0);
  await expect(row(first.sessionId)).toBeVisible();
  // Delete the active conversation and verify the unsaved empty state remains stable.
  await editor.fill("删除当前会话的草稿");
  await row(first.sessionId)
    .getByRole("button", { name: "删除会话", exact: true })
    .click();
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(first.sessionId)).toHaveCount(0);
  await expect(project.locator(".session-row")).toHaveCount(0);
  await expect(editor).toHaveValue("");
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`pi.draft.${id}`),
      first.sessionId,
    ),
  ).toBeNull();
  expect(
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionFile,
  ).toBeUndefined();
  expect(
    (
      await sdkAction<SessionItem[]>(page, "sessions.list", { all: true })
    ).filter((item) => item.cwd === cwd),
  ).toEqual([]);
  await page.screenshot({ path: ".local/session-delete/empty.png" });
  await page.reload();
  await editor.waitFor();
  await expect(project.locator(".session-row")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await sdkAction(page, "initialize", { cwd: initial.cwd });
});
