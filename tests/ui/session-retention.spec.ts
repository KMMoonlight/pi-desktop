import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("an unsent new session stays in the sidebar and restores its draft after switching and reloading", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "An existing conversation" });
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  await sdkAction(page, "session.name", { name: "保留的旧会话" });
  await expect(page.locator(".session-row.active strong")).toHaveText(
    "保留的旧会话",
  );
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(page.locator(".header-title h1")).toHaveText("新会话");
  const fresh = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await editor.fill("新会话里尚未发送的草稿");
  await page
    .locator(".session-row")
    .getByRole("button", { name: /保留的旧会话/ })
    .click();
  await expect(page.locator(".header-title h1")).toHaveText("保留的旧会话");
  const newSession = page.locator(
    `.session-row[data-session-id="${fresh.sessionId}"]`,
  );
  await expect(newSession).toHaveCount(1);
  await newSession.getByRole("button").first().click();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId,
    )
    .toBe(fresh.sessionId);
  await expect(editor).toHaveValue("新会话里尚未发送的草稿");
  expect(
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).messages,
  ).toHaveLength(0);
  await page.reload();
  await editor.waitFor();
  const retained = page.locator(
    `.session-row[data-session-id="${fresh.sessionId}"]`,
  );
  await expect(retained).toHaveCount(1);
  await retained.getByRole("button").first().click();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId,
    )
    .toBe(fresh.sessionId);
  await expect(editor).toHaveValue("新会话里尚未发送的草稿");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  await expect(page.locator(".transcript")).toContainText(
    "新会话里尚未发送的草稿",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});
