import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("a sent message is visible during model preflight, including after model switching and aborting", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "first model history" });
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
  await sdkAction(page, "model.set", { provider: "desktop-test", id: "desktop-switch-test" });
  const text = "slow-preflight-probe application-status-gate switched model";
  const sent = page.getByRole("article", { name: "用户消息", exact: true }).filter({ hasText: text });
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await editor.fill(text);
      await editor.press("Enter");
      await expect(sent).toHaveCount(attempt, { timeout: 1000 });
      await expect(sent.last().getByRole("status")).toHaveText("正在准备发送…", { timeout: 1000 });
      await expect(editor).toHaveValue("");
      await expect(sent.last().getByRole("status")).toHaveCount(0);
      await expect(sent).toHaveCount(attempt);
      await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "停止任务", exact: true }).click();
      await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
      await expect(sent).toHaveCount(attempt);
    }
  } finally { await sdkAction(page, "abort"); }
});

test("the first message is visible before the agent has a transcript", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  await sdkAction(page, "session.new");
  try {
    await editor.fill("slow-preflight-probe first message");
    await editor.press("Enter");
    await expect(page.getByRole("article", { name: "用户消息", exact: true })).toContainText("slow-preflight-probe first message", { timeout: 1000 });
    await expect(page.getByRole("status", { name: "" }).filter({ hasText: "正在准备发送…" })).toBeVisible({ timeout: 1000 });
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
    await expect(page.getByRole("article", { name: "用户消息", exact: true })).toHaveCount(1);
  } finally { await sdkAction(page, "abort"); }
});
