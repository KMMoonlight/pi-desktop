import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyDialogSubmission(page: Page) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const configure = (bindings: Record<string, string>) =>
    sdkAction(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/editor-action.mjs`,
      args: { action: "bindings", bindings },
    });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox");
  const open = () =>
    sdkAction(page, "prompt", { message: "/dialog-text-probe editor" });
  const result = async (value: string) => {
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
            "dialog-text-result"
          ],
      )
      .toBe(JSON.stringify({ value }));
  };
  await open();
  await input.fill("before OLD after");
  await expect(input).toHaveValue("before OLD after");
  await input.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(7, 10),
  );
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("before \n after");
  await input.press("Control+z");
  await expect(input).toHaveValue("before OLD after");
  await input.fill("  first\\");
  await input.press("End");
  await input.press("Enter");
  await expect(input).toHaveValue("  first\n");
  await input.press("Control+z");
  await expect(input).toHaveValue("  first\\");
  await input.press("Control+Shift+z");
  await expect(input).toHaveValue("  first\n");
  await input.pressSequentially("second  ");
  await input.press("Enter");
  await result("first\nsecond");
  await open();
  await input.fill("  button answer \n");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await result("button answer");
  await configure({
    "tui.input.submit": "shift+enter",
    "tui.input.newLine": "enter",
  });
  try {
    await open();
    await input.fill("  remapped\\");
    await input.press("End");
    await input.press("Enter");
    await result("remapped");
    await open();
    await input.fill(" \n ");
    await input.press("Shift+Enter");
    await result("");
  } finally {
    await configure({});
  }
}
