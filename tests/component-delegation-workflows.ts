import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyComponentDelegation(
  page: Page,
  value: string,
  screenshot: string,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "prompt", { message: "/delegated-component-probe" });
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Delegated Pi Input", { exact: true }),
  ).toBeVisible();
  const input = dialog.getByRole("textbox");
  await input.fill(value);
  await expect(input).toHaveValue(value);
  await page.screenshot({ path: screenshot });
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "delegated-component"
        ],
    )
    .toBe(value);
  await expect(
    page.getByText(`delegated-component=${value}`, { exact: false }),
  ).toBeVisible();
}
