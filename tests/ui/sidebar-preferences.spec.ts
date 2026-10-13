import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("inspector thinking switch persists through closing the panel and reloading the app", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  try {
    for (const visible of [false, true]) {
      await page
        .getByRole("button", { name: "打开检查器", exact: true })
        .click();
      const toggle = page.locator('input[name="expand-thinking"]');
      await toggle.setChecked(visible);
      await expect
        .poll(
          async () =>
            (await sdkAction<DesktopSnapshot>(page, "snapshot")).settings
              .hideThinkingBlock,
        )
        .toBe(!visible);
      await page
        .getByRole("button", { name: "关闭检查器", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("button", { name: "打开检查器", exact: true })
        .click();
      await expect(toggle).toBeChecked({ checked: visible });
      await page
        .getByRole("button", { name: "关闭检查器", exact: true })
        .click();
    }
  } finally {
    await sdkAction(page, "display.thinking", {
      visible: initial.settings.hideThinkingBlock !== true,
    });
  }
});

test("detailed and normal transcript views survive a page reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  try {
    for (const [label, expanded] of [
      ["详细", true],
      ["普通", false],
    ] as const) {
      await page.getByRole("button", { name: "会话操作", exact: true }).click();
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect
        .poll(async () => {
          const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
          return {
            expanded: snapshot.toolsExpanded,
            hidden: snapshot.settings.hideThinkingBlock,
          };
        })
        .toEqual({ expanded, hidden: !expanded });
      await page.reload();
      await page.getByRole("button", { name: "会话操作", exact: true }).click();
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", { name: "关闭会话菜单", exact: true })
        .click();
      await page
        .getByRole("button", { name: "打开检查器", exact: true })
        .click();
      await expect(page.locator('input[name="expand-tools"]')).toBeChecked({
        checked: expanded,
      });
      await page
        .getByRole("button", { name: "关闭检查器", exact: true })
        .click();
    }
  } finally {
    await sdkAction(page, "display.tools", {
      expanded: initial.toolsExpanded === true,
    });
    await sdkAction(page, "display.thinking", {
      visible: initial.settings.hideThinkingBlock !== true,
    });
  }
});
