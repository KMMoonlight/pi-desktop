import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";

export async function verifySelectionShortcuts(page: Page) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/mapped-form" });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", { name: "Name", exact: true });
  for (const key of ["Control+a", "Shift+ArrowLeft"]) {
    await input.fill("shortcut-probe");
    await input.press(key);
    await expect(input).toHaveValue("shortcut handled");
    await expect
      .poll(() =>
        input.evaluate((el: HTMLInputElement) => [
          el.selectionStart,
          el.selectionEnd,
        ]),
      )
      .toEqual([14, 14]);
  }
  await input.fill("ordinary input");
  await input.press("Control+a");
  await expect
    .poll(() =>
      input.evaluate((el: HTMLInputElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
    )
    .toEqual([0, 14]);
  await input.press("X");
  await expect(input).toHaveValue("X");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await sdkAction(page, "prompt", { message: "/mapped-editor" });
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  // A string avoids tsx's function-name helpers leaking into the WebView.
  await page.evaluate(`(() => {
    const original = navigator.clipboard.writeText;
    const copied = [];
    navigator.clipboard.writeText = async (text) => {
      copied.push(text);
    };
    Reflect.set(window, "selectionShortcutClipboard", {
      copied,
      restore: () => {
        navigator.clipboard.writeText = original;
      },
    });
  })()`);
  try {
    await editor.fill("copy sample");
    for (const key of ["Control+c", "Control+x"]) {
      await editor.evaluate((el: HTMLTextAreaElement) =>
        el.setSelectionRange(0, 4),
      );
      await editor.press(key);
      await expect(editor).toHaveValue(
        key === "Control+c" ? "copy sample" : " sample",
      );
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, "selectionShortcutClipboard").copied,
        ),
      )
      .toEqual(["copy", "copy"]);
  } finally {
    await page.evaluate(() => {
      Reflect.get(window, "selectionShortcutClipboard").restore();
      Reflect.deleteProperty(window, "selectionShortcutClipboard");
    });
  }
  await sdkAction(page, "session.new");
}
