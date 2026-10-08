import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("generated titles update the header and sidebar, survive reopening and remain editable", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await expect(page.locator(".header-title h1")).toHaveText("新会话");
  await editor.fill("请帮我优化登录页面的表单间距和按钮布局");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".header-title h1")).toHaveText(
    "Desktop verification",
  );
  await expect(page.locator(".session-row.active strong")).toHaveText(
    "Desktop verification",
  );
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(snapshot.messages).toHaveLength(2);
  await sdkAction(page, "session.new");
  await sdkAction(page, "session.switch", { path: snapshot.sessionFile });
  await expect(page.locator(".header-title h1")).toHaveText(
    "Desktop verification",
  );
  await page.locator(".header-title h1").hover();
  await page.getByRole("button", { name: "重命名会话", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("登录页布局优化");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(page.locator(".header-title h1")).toHaveText("登录页布局优化");
  await expect(page.locator(".session-row.active strong")).toHaveText(
    "登录页布局优化",
  );
  await editor.fill("继续完善错误提示");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  await expect(page.locator(".header-title h1")).toHaveText("登录页布局优化");
});
