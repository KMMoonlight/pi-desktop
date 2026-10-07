import { expect, type Page } from "@playwright/test";
import type { DesktopSnapshot } from "../shared/types.ts";
import { sdkAction } from "./editor-workflows.ts";

export const customCloseModes = ["native", "native-overlay", "xterm-overlay"];

export async function verifyCustomCloseOrder(
  page: Page,
  mode: string,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  const pending = sdkAction(page, "prompt", {
    message: `/custom-close-order-probe ${mode}`,
  });
  const dialog = page.getByRole("dialog");
  try {
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("textbox", {
      name: "Custom close ordering",
      exact: true,
    });
    const terminal = dialog.getByLabel("扩展终端组件");
    if (mode.startsWith("xterm")) {
      await expect(input).toHaveCount(0);
      await expect(terminal).toBeVisible();
      await terminal.locator(".xterm-helper-textarea").focus();
      await page.keyboard.type("original-result");
    } else {
      await expect(terminal).toHaveCount(0);
      await input.fill("original-result");
      await input.focus();
    }
    await page.screenshot({ path: screenshot });
    await page.keyboard.press("Enter");
    await pending;
    await expect(dialog).toHaveCount(0);
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(JSON.parse(snapshot.statuses["custom-close-order-result"])).toEqual({
      mode,
      value: "original-result",
      events: [
        "dispose",
        "done-return",
        "cleanup:1",
        "cleanup:2",
        "cleanup:3",
        "cleanup:4",
        "cleanup:5",
        "result:5",
        "cleanup:6",
        "cleanup:7",
        "cleanup:8",
      ],
    });
  } finally {
    if (!page.isClosed()) {
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      for (const surface of snapshot.desktopSurfaces.filter(
        (surface) => surface.slot === "dialog",
      ))
        await sdkAction(page, "desktop.close", { id: surface.id });
      await pending.catch(() => {});
    }
  }
}
