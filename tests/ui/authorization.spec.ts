import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot, DesktopEvent } from "../../shared/types.ts";

test("a retired authorization cannot clear the newer desktop banner", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const emit = (event: DesktopEvent) =>
    sdkAction(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/authorization-events.mjs`,
      args: { event },
    });
  await emit({
    type: "auth_url",
    id: "old",
    url: "https://example.invalid/old",
    message: "Old authorization",
  });
  await emit({
    type: "auth_url",
    id: "new",
    url: "https://example.invalid/new",
    message: "New authorization",
  });
  await expect(
    page.getByText("New authorization", { exact: true }),
  ).toBeVisible();
  await emit({ type: "activity", name: "auth_complete", data: { id: "old" } });
  await expect(
    page.getByText("New authorization", { exact: true }),
  ).toBeVisible();
  await emit({ type: "activity", name: "auth_complete", data: { id: "new" } });
  await expect(
    page.getByRole("button", { name: "打开授权页面", exact: true }),
  ).toHaveCount(0);
  await emit({
    type: "auth_url",
    id: "cancel-target",
    url: "https://example.invalid/cancel",
  });
  const cancellation = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/action") &&
      request.postDataJSON()?.action === "auth.cancel",
  );
  await page.getByRole("button", { name: "取消登录", exact: true }).click();
  expect((await cancellation).postDataJSON().args).toEqual({
    id: "cancel-target",
  });
  await expect(
    page.getByRole("button", { name: "打开授权页面", exact: true }),
  ).toHaveCount(0);
});
