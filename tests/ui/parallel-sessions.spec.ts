import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test("sessions run independently while switching, restoring drafts and stopping only the selected task", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "session.name", { name: "Parallel A" });
  const a = await sdkAction<DesktopSnapshot>(page, "snapshot");
  let b: DesktopSnapshot | undefined;
  const row = (id: string) => page.locator(`.session-row[data-session-id="${id}"]`);
  try {
    await editor.fill("application-status-gate A");
    await editor.press("Enter");
    await expect(row(a.sessionId).getByRole("status", { name: "执行中", exact: true })).toBeVisible();
    await editor.fill("draft for A");
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await expect(editor).toHaveValue("");
    await sdkAction(page, "session.name", { name: "Parallel B" });
    b = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(b.sessionId).not.toBe(a.sessionId);
    await editor.fill("application-status-gate B");
    await editor.press("Enter");
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionActivity?.filter(s => s.running).map(s => s.id).sort()).toEqual([a.sessionId, b.sessionId].sort());
    await editor.fill("draft for B");
    await row(a.sessionId).locator("button").first().click();
    await expect(editor).toHaveValue("draft for A");
    await expect(page.locator(".transcript")).toContainText("application-status-gate A");
    await expect(page.locator(".transcript")).not.toContainText("application-status-gate B");
    await row(b.sessionId).locator("button").first().click();
    await expect(editor).toHaveValue("draft for B");
    await editor.fill("");
    await page.getByRole("button", { name: "停止任务", exact: true }).click();
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionActivity?.filter(s => s.running).map(s => s.id)).toEqual([a.sessionId]);
    await expect(row(a.sessionId).getByRole("status", { name: "执行中", exact: true })).toBeVisible();
    await page.reload();
    await expect(editor).toBeVisible();
    expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(b.sessionId);
    await expect(row(a.sessionId).getByRole("status", { name: "执行中", exact: true })).toBeVisible();
    await row(a.sessionId).locator("button").first().click();
    await expect(editor).toHaveValue("draft for A");
    await editor.fill("");
    await page.getByRole("button", { name: "停止任务", exact: true }).click();
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionActivity?.some(s => s.running)).toBe(false);
  } finally {
    await sdkAction(page, "abort", { __sessionId: a.sessionId });
    if (b) await sdkAction(page, "abort", { __sessionId: b.sessionId });
  }
});

test("a background completion stays with its session and becomes unread", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
  await sdkAction(page, "session.new");
  const a = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const b = await sdkAction<DesktopSnapshot>(page, "session.new");
  await sdkAction(page, "session.switch", { path: a.sessionFile });
  await sdkAction(page, "prompt", { message: "slow-response background A" });
  await sdkAction(page, "session.switch", { path: b.sessionFile });
  const row = page.locator(`.session-row[data-session-id="${a.sessionId}"]`);
  await expect(row.getByRole("status", { name: "任务完成，未读", exact: true })).toBeVisible();
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(b.sessionId);
  await expect(page.locator(".chat-view")).not.toContainText("slow-response background A");
  await row.locator("button").first().click();
  await expect(page.locator(".transcript")).toContainText("slow-response background A");
  await page.bringToFront();
  await expect(row.getByRole("status")).toHaveCount(0);
  await sdkAction(page, "session.switch", { path: b.sessionFile });
  await page.reload();
  await expect(row).toBeVisible();
  await expect(row.getByRole("status")).toHaveCount(0);
});

test("a background question is shown only when its session is selected", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  const a = await sdkAction<DesktopSnapshot>(page, "session.new");
  const b = await sdkAction<DesktopSnapshot>(page, "session.new");
  // Start an extension that awaits user input in A while B stays visible.
  const pending = sdkAction(page, "prompt", { __sessionId: a.sessionId, message: "/desktop-dialog" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.locator(`.session-row[data-session-id="${a.sessionId}"]`);
  await expect(row.getByRole("status", { name: "需要处理", exact: true })).toBeVisible();
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(b.sessionId);
  await row.locator("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await pending;
  await expect(editor).toHaveValue("cancelled");
  await expect(row.getByRole("status", { name: "需要处理", exact: true })).toHaveCount(0);
});

test("a different workspace runs independently and remains listed when returning", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  const a = await sdkAction<DesktopSnapshot>(page, "session.new");
  const cwd = join(a.cwd, "parallel-project");
  await mkdir(cwd, { recursive: true });
  let b: DesktopSnapshot | undefined;
  try {
    await sdkAction(page, "prompt", { message: "application-status-gate project A" });
    b = await sdkAction<DesktopSnapshot>(page, "session.new", { cwd });
    await sdkAction(page, "prompt", { message: "application-status-gate project B" });
    expect(b.cwd).toBe(cwd);
    await sdkAction(page, "session.switch", { path: a.sessionFile });
    const current = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(current.sessionActivity?.filter(session => session.running).map(session => session.id).sort()).toEqual([a.sessionId, b.sessionId].sort());
    expect(current.recentWorkspaces).toContain(cwd);
    expect(current.cwd).toBe(a.cwd);
  } finally {
    await sdkAction(page, "abort", { __sessionId: a.sessionId });
    if (b) await sdkAction(page, "abort", { __sessionId: b.sessionId });
  }
});

test("a delayed send acknowledgement in A does not block sending in B", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  const a = await sdkAction<DesktopSnapshot>(page, "session.new");
  const b = await sdkAction<DesktopSnapshot>(page, "session.new");
  await sdkAction(page, "session.switch", { path: a.sessionFile });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.route("**/api/action", async route => {
    const body = route.request().postDataJSON();
    if (body.action === "prompt" && body.args.message === "application-status-gate delayed A") {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await editor.fill("application-status-gate delayed A");
    await editor.press("Enter");
    await expect.poll(() => held).toBe(true);
    await page.locator(`.session-row[data-session-id="${b.sessionId}"] button`).first().click();
    await expect(page.locator(`.session-row[data-session-id="${b.sessionId}"] button`).first()).toHaveAttribute("aria-current", "page");
    await expect(editor).toHaveValue("");
    await editor.fill("application-status-gate independent B");
    await editor.press("Enter");
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionActivity?.filter(s => s.running).length).toBe(2);
    await editor.fill("keep B draft");
    release();
    await expect(editor).toHaveValue("keep B draft");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await sdkAction(page, "abort", { __sessionId: a.sessionId });
    await sdkAction(page, "abort", { __sessionId: b.sessionId });
  }
});
