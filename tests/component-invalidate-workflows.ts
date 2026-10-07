import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";

export async function verifyComponentInvalidation(page: Page) {
  await sdkAction(page, "prompt", { message: "/component-invalidate-probe" });
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Initial cache", { exact: true }),
  ).toBeVisible();
  for (const text of ["Updated original cache", "Updated again"]) {
    await dialog.getByRole("textbox").fill(text);
    await dialog.getByRole("textbox").press("Enter");
    await expect(dialog.getByText(text, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveValue("");
  }
  await dialog.getByRole("textbox").fill("close");
  await dialog.getByRole("textbox").press("Enter");
  await expect(dialog).toHaveCount(0);
}
