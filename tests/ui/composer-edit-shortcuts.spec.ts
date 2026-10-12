import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";

test("Command editing shortcuts use the native clipboard and keep the editor synchronized", async ({ page, context }) => {
  test.skip(process.platform !== "darwin", "Command editing shortcuts are native macOS bindings");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  await sdkAction(page, "session.new");
  await editor.fill("copy sample");
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 4));
  await page.evaluate(() => navigator.clipboard.writeText("sentinel"));
  await editor.press("Meta+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("copy");
  await expect(editor).toHaveValue("copy sample");
  await editor.press("Meta+x");
  await expect(editor).toHaveValue(" sample");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("copy");
  await editor.press("Meta+z");
  await expect(editor).toHaveValue("copy sample");
  await editor.press("Meta+Shift+z");
  await expect(editor).toHaveValue(" sample");
  await editor.press("Meta+a");
  await expect.poll(() => editor.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 7]);
  await editor.press("Meta+v");
  await expect(editor).toHaveValue("copy");
  // A subsequent SDK edit must start from the clipboard edit's current value.
  await editor.press("ArrowLeft");
  await editor.pressSequentially("!");
  await expect(editor).toHaveValue("cop!y");
  const submitted = page.waitForRequest(request => request.method() === "POST" && request.postDataJSON()?.action === "prompt");
  try {
    await editor.press("Enter");
    expect((await submitted).postDataJSON().args.message).toBe("cop!y");
  } finally {
    await sdkAction(page, "abort");
  }
});
