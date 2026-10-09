import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const theme of ["light", "dark"]) {
  test(`session activity shows running then unread until the reply is viewed (${theme})`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.bringToFront();
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.name", { name: "会话状态提示" });
    await sdkAction(page, "theme.set", { theme });
    const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const row = page.locator(
      `.session-row[data-session-id="${initial.sessionId}"]`,
    );
    await sdkAction(page, "prompt", {
      message: "slow-response session activity",
    });
    await expect(
      row.getByRole("status", { name: "执行中", exact: true }),
    ).toBeVisible();
    await expect(row.locator(".session-activity svg")).toHaveCSS(
      "display",
      "block",
    );
    await page.getByRole("button", { name: "文件与更改", exact: true }).click();
    await expect(
      row.getByRole("status", { name: "任务完成，未读", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("status", { name: "执行中", exact: true }),
    ).toHaveCount(0);
    await mkdir(".local/session-activity", { recursive: true });
    await row.screenshot({
      path: `.local/session-activity/unread-${theme}.png`,
    });
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.name", { name: "另一会话" });
    await page.reload();
    await page.bringToFront();
    await expect(
      row.getByRole("status", { name: "任务完成，未读", exact: true }),
    ).toBeVisible();
    await row.locator("button").first().click();
    await expect(row.getByRole("status")).toHaveCount(0);
    expect(
      await page.evaluate(
        (id) =>
          JSON.parse(
            localStorage.getItem("pi.unreadCompletedSessions") || "[]",
          ).includes(id),
        initial.sessionId,
      ),
    ).toBe(false);
    // If the reader is already watching the reply, completion is immediately read.
    await sdkAction(page, "prompt", {
      message: "slow-response already viewing",
    });
    await expect(
      row.getByRole("status", { name: "执行中", exact: true }),
    ).toBeVisible();
    await row.screenshot({
      path: `.local/session-activity/running-${theme}.png`,
    });
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).running,
      )
      .toBe(false);
    await expect(row.getByRole("status")).toHaveCount(0);
    await sdkAction(page, "theme.set", { theme: "light" });
  });
}

test("completion stays unread while the document reports background focus", async ({
  page,
}) => {
  await page.goto("/");
  await page.bringToFront();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "session.name", { name: "后台完成提示" });
  const session = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const row = page.locator(
    `.session-row[data-session-id="${session.sessionId}"]`,
  );
  await sdkAction(page, "prompt", {
    message: "slow-response background completion",
  });
  await expect(
    row.getByRole("status", { name: "执行中", exact: true }),
  ).toBeVisible();
  // Headless Chromium keeps every tab focused; emulate the native window's
  // document focus contract while running the real completion lifecycle.
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    });
    window.dispatchEvent(new Event("blur"));
  });
  await expect(
    row.getByRole("status", { name: "任务完成，未读", exact: true }),
  ).toHaveCount(1);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hasFocus");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(row.getByRole("status")).toHaveCount(0);
});
