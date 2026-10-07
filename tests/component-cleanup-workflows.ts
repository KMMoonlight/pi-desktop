import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyComponentCleanup(page: Page) {
  await sdkAction(page, "prompt", { message: "/component-cleanup-probe" });
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Cleanup error probe", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("textbox").fill("original value");
  await dialog.getByRole("textbox").press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Original component cleanup failed", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "component-cleanup"
        ],
    )
    .toBe("original value:1");
  // A second factory must remain usable after the first one's cleanup failed.
  await sdkAction(page, "prompt", { message: "/delegated-component-probe" });
  await expect(dialog.getByRole("textbox")).toBeVisible();
  await dialog.getByRole("textbox").fill("still connected");
  await dialog.getByRole("textbox").press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "delegated-component"
        ],
    )
    .toBe("still connected");
}
