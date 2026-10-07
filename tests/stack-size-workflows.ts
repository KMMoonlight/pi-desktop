import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types";

export async function verifyStackSizes(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/stack-size-probe" });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", {
    name: "Collapsible input",
    exact: true,
  });
  await expect(input).toHaveCount(0);
  await expect(
    dialog.getByRole("textbox", { name: "Maximum hidden input", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("textbox", { name: "Minimum input", exact: true }),
  ).toBeVisible();
  const choose = async (value: string) => {
    await dialog
      .getByRole("combobox", { name: "选择", exact: true })
      .selectOption(value);
    await dialog
      .getByRole("button", { name: "确认", exact: true })
      .last()
      .click();
  };
  await choose("show");
  await expect(input).toHaveValue("Retained draft");
  await input.fill("Original instance draft");
  await input.press("Enter");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "stack-submit"
        ],
    )
    .toBe("Original instance draft");
  await choose("hide");
  await expect(input).toHaveCount(0);
  await choose("show");
  await expect(input).toHaveValue("Original instance draft");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await choose("close");
  await expect(dialog).toBeHidden();
}
