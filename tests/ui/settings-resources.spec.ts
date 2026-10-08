import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("loaded resources move into settings and retain reload, search and command use", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await expect(
    page
      .getByRole("navigation", { name: "会话视图" })
      .getByRole("button", { name: "资源", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings
    .getByRole("button", { name: "扩展与技能", exact: true })
    .click();
  const resources = settings.locator(".settings-resources");
  await expect(resources.locator(".resource-row")).toHaveCount(
    snapshot.resources.length,
  );
  await expect(
    settings.getByRole("button", { name: "保存设置", exact: true }),
  ).toHaveCount(0);
  const reloaded = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/action")) return false;
    return response.request().postDataJSON()?.action === "resources.reload";
  });
  await resources
    .getByRole("button", { name: "重新加载", exact: true })
    .click();
  expect((await reloaded).ok()).toBe(true);
  await expect(
    resources.getByRole("button", { name: "重新加载", exact: true }),
  ).toBeEnabled();
  const current = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const skill = current.resources.find(
    (resource) => resource.kind === "skill",
  )!;
  expect(skill).toBeTruthy();
  await resources
    .getByRole("group", { name: "资源分类" })
    .getByRole("button", { name: /Skills/ })
    .click();
  await resources
    .getByRole("textbox", { name: "搜索资源", exact: true })
    .fill(skill.name);
  const row = resources
    .locator(".resource-row")
    .filter({ hasText: skill.name })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "使用", exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(editor).toHaveValue(`/skill:${skill.name} `);
  await expect(editor).toBeFocused();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).editor.text,
    )
    .toBe(`/skill:${skill.name} `);
});
