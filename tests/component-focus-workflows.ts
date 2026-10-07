import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyComponentFocus(page: Page) {
  await sdkAction(page, "prompt", { message: "/component-focus-probe" });
  const dialog = page.getByRole("dialog");
  const first = dialog.getByRole("textbox", {
    name: "First field",
    exact: true,
  });
  const second = dialog.getByRole("textbox", {
    name: "Second field",
    exact: true,
  });
  await expect(second).toBeFocused();
  await second.fill("hide");
  await second.press("Enter");
  await expect(second).toHaveCount(0);
  await first.click();
  await first.fill("show");
  await first.press("Enter");
  await expect(second).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(first).toBeFocused();
  await first.click();
  await first.fill("stay");
  await first.press("Enter");
  await expect(first).toBeFocused();
  await first.fill("clear");
  await first.press("Enter");
  await expect(first).not.toBeFocused();
  await expect(second).not.toBeFocused();
  await first.click();
  await first.fill("move focus");
  await first.press("Enter");
  await expect(second).toBeFocused();
  await page.keyboard.type("Original focused input");
  await expect(second).toHaveValue("Original focused input");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "component-focus"
        ],
    )
    .toBe("Original focused input");
}
