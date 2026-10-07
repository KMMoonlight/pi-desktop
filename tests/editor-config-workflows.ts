import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types";

export async function verifyEditorConfig(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/editor-config-probe" });
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "编辑内容", exact: true });
  const submit = dialog
    .getByRole("button", { name: "确认", exact: true })
    .first();
  const choose = async (value: string) => {
    await dialog
      .getByRole("combobox", { name: "选择", exact: true })
      .selectOption(value);
    await dialog
      .getByRole("button", { name: "确认", exact: true })
      .last()
      .click();
  };
  const padding = () =>
    editor.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingLeft),
    );
  await expect(submit).toBeDisabled();
  const initialPadding = await padding();
  expect(initialPadding).toBeGreaterThan(0);
  await editor.press("Enter");
  await expect(editor).toHaveValue("Retained editor draft");
  await choose("padding4");
  await expect.poll(padding).toBeCloseTo(initialPadding * 2, 1);
  await expect(editor).toHaveValue("Retained editor draft");
  await choose("padding0");
  await expect.poll(padding).toBe(0);
  await choose("enable");
  await expect(submit).toBeEnabled();
  await editor.fill("Original configuration callback");
  await submit.click();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "editor-config-submit"
        ],
    )
    .toBe("Original configuration callback");
  await choose("disable");
  await expect(submit).toBeDisabled();
  await choose("padding4");
  await expect.poll(padding).toBeCloseTo(initialPadding * 2, 1);
  await editor.fill("Draft with configured padding");
  await expect(editor).toHaveValue("Draft with configured padding");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await choose("close");
  await expect(dialog).toBeHidden();
}
