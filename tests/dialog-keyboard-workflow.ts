import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
export async function verifyDialogKeyboard(page: Page) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  const dialog = page.getByRole("dialog");
  await sdkAction(page, "prompt", { message: "/dialog-text-probe confirm" });
  const yes = dialog.getByRole("button", { name: "确认", exact: true });
  const no = dialog.getByRole("button", { name: "取消", exact: true });
  await expect(yes).toBeFocused();
  await yes.press("ArrowDown");
  await expect(no).toBeFocused();
  await no.press("ArrowUp");
  await expect(yes).toBeFocused();
  await yes.press("Control+o");
  await expect(dialog).toBeVisible();
  await yes.press("ArrowDown");
  await expect(no).toBeFocused();
  await no.press("Enter");
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(JSON.stringify({ value: false }));
  await sdkAction(page, "prompt", { message: "/dialog-text-probe confirm" });
  await expect(yes).toBeFocused();
  await yes.press("Enter");
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(JSON.stringify({ value: true }));
  await sdkAction(page, "prompt", { message: "/dialog-text-probe input" });
  const input = dialog.getByRole("textbox");
  await input.fill("keyboard answer");
  await input.press("End");
  await input.press("Control+w");
  await expect(input).toHaveValue("keyboard ");
  await input.press("Control+y");
  await expect(input).toHaveValue("keyboard answer");
  await input.press("Enter");
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(JSON.stringify({ value: "keyboard answer" }));
  await sdkAction(page, "prompt", { message: "/dialog-text-probe" });
  const options = dialog.getByRole("button", { name: "Choice", exact: true });
  await options.nth(0).focus();
  await options.nth(0).press("ArrowDown");
  await expect(options.nth(1)).toBeFocused();
  await options.nth(1).press("Enter");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(JSON.stringify({ value: "\x1b[38;2;30;130;60mChoice\x1b[0m" }));
  await sdkAction(page, "prompt", { message: "/dialog-text-probe" });
  await options.nth(0).focus();
  await options.nth(0).evaluate((element) => {
    for (const key of ["ArrowDown", "Enter"])
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(JSON.stringify({ value: "\x1b[38;2;30;130;60mChoice\x1b[0m" }));
  await sdkAction(page, "prompt", { message: "/dialog-text-probe editor" });
  await input.fill("alpha beta\ngamma");
  await input.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(6, 6),
  );
  await input.press("Control+k");
  await expect(input).toHaveValue("alpha \ngamma");
  await input.press("Control+y");
  await expect(input).toHaveValue("alpha beta\ngamma");
  await input.press("Control+z");
  await expect(input).toHaveValue("alpha \ngamma");
  await input.press("Control+Shift+z");
  await expect(input).toHaveValue("alpha beta\ngamma");
  await input.press("Control+a");
  await expect
    .poll(() =>
      input.evaluate((element: HTMLTextAreaElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    )
    .toEqual([0, 16]);
  await input.press("Backspace");
  await expect(input).toHaveValue("");
  await input.fill("first");
  await input.press("End");
  await input.press("Shift+Enter");
  await input.pressSequentially("second");
  await expect(input).toHaveValue("first\nsecond");
  await input.press("Control+g");
  await expect(input).toHaveValue("first\nsecond\nExternal editor result");
  await expect(input).toBeEditable();
  await input.press("Enter");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(JSON.stringify({ value: "first\nsecond\nExternal editor result" }));
  await sdkAction(page, "prompt", { message: "/dialog-text-probe editor" });
  await input.fill("fail-external");
  await input.press("Control+g");
  await expect(page.getByText(/Dialog editor fixture failure/)).toBeVisible();
  await expect(input).toBeEditable();
  await expect(input).toHaveValue("fail-external");
  await input.fill("wait-external");
  await input.press("Control+g");
  await expect(input).not.toBeEditable();
  await input.press("Escape");
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(JSON.stringify({ value: null }));
}
