import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyDialogPaste(page: Page) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const hook = (text?: string) =>
    sdkAction(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/editor-action.mjs`,
      args: { action: "pasteStreamHook", text },
    });
  for (const kind of ["input", "editor"] as const) {
    await sdkAction(page, "prompt", { message: `/dialog-text-probe ${kind}` });
    const dialog = page.getByRole("dialog");
    const control = dialog.getByRole("textbox");
    await control.fill("before OLD after");
    await expect(control).toHaveValue("before OLD after");
    const paste = async (text: string, start: number, end: number) =>
      control.evaluate(
        (element: HTMLTextAreaElement | HTMLInputElement, args) => {
          element.setSelectionRange(args.start, args.end);
          const clipboardData = new DataTransfer();
          clipboardData.setData("text/plain", args.text);
          element.dispatchEvent(
            new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData,
            }),
          );
        },
        { text, start, end },
      );
    await paste("A\tB\r\nC", 7, 10);
    const inserted = kind === "input" ? "A    BC" : "A    B\nC";
    await expect(control).toHaveValue(`before ${inserted} after`);
    await expect
      .poll(() =>
        control.evaluate(
          (element: HTMLTextAreaElement) => element.selectionStart,
        ),
      )
      .toBe(7 + inserted.length);
    await control.press("Control+z");
    await expect(control).toHaveValue("before OLD after");
    await control.press("Control+Shift+z");
    await expect(control).toHaveValue(`before ${inserted} after`);
    const large = "row\tvalue\r\n".repeat(12);
    const expected =
      kind === "input"
        ? "row    value".repeat(12)
        : "row    value\n".repeat(12);
    await paste(large, 0, `before ${inserted} after`.length);
    await expect(control).toHaveValue(expected);
    await expect
      .poll(() =>
        control.evaluate(
          (element: HTMLTextAreaElement) => element.selectionStart,
        ),
      )
      .toBe(expected.length);
    await control.press("Enter");
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
            "dialog-text-result"
          ],
      )
      .toBe(
        JSON.stringify({
          value: kind === "editor" ? expected.trim() : expected,
        }),
      );
    await sdkAction(page, "prompt", { message: `/dialog-text-probe ${kind}` });
    await control.fill("before OLD after");
    await expect(control).toHaveValue("before OLD after");
    await hook(kind);
    try {
      await control.evaluate((element: HTMLTextAreaElement) =>
        element.setSelectionRange(7, 10),
      );
      await control.pressSequentially("1");
      await expect(control).toHaveValue("before OLD after");
      await control.pressSequentially("2");
      await expect(control).toHaveValue("before OLD after");
      await control.pressSequentially("3");
      const streamed =
        kind === "input" ? "before A    BC after" : "before A    B\nC after";
      await expect(control).toHaveValue(streamed);
      await control.press("Control+z");
      await expect(control).toHaveValue("before OLD after");
      await control.press("Control+Shift+z");
      await expect(control).toHaveValue(streamed);
      await control.press("Enter");
      await expect(dialog).toBeHidden();
      await expect
        .poll(
          async () =>
            (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
              "dialog-text-result"
            ],
        )
        .toBe(JSON.stringify({ value: streamed }));
    } finally {
      await hook();
    }
  }
}
