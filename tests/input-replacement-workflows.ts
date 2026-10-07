import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyMultilineReplacement(
  page: Page,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const operation = (action: string, text?: string) =>
    sdkAction<string>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/editor-action.mjs`,
      args: { action, text },
    });
  await sdkAction(page, "prompt", { message: "/mapped-editor" });
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toHaveAttribute("data-desktop-action", /^component:/);
  await operation("compositionHook", "record");
  await operation("text", "draft text");
  await expect(editor).toHaveValue("draft text");
  await editor.press("ArrowLeft");
  await expect
    .poll(() =>
      editor.evaluate((control: HTMLTextAreaElement) => control.selectionStart),
    )
    .toBe(9);
  await editor.fill("line one\nline two");
  await expect(editor).toHaveValue("line one\nline two");
  expect(await operation("read")).toBe("line one\nline two");
  expect(
    await sdkAction<string[]>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/editor-action.mjs`,
      args: { action: "compositionRecords" },
    }),
  ).toContain("\x1b[200~line one\nline two\x1b[201~");
  await editor.press("Control+z");
  await expect(editor).toHaveValue("draft text");
  await editor.fill("line one\nline two");
  await expect(editor).toHaveValue("line one\nline two");
  await editor.press("ArrowUp");
  await editor.press("!");
  await expect(editor).toHaveValue("line onemapped\nline two");
  expect(await operation("read")).toBe("line onemapped\nline two");
  await operation("text", "prefix one\nsecond suffix");
  await expect(editor).toHaveValue("prefix one\nsecond suffix");
  await editor.focus();
  await editor.evaluate((control: HTMLTextAreaElement) =>
    control.setSelectionRange(7, 17),
  );
  await page.keyboard.insertText("A\nB");
  await expect(editor).toHaveValue("prefix A\nB suffix");
  await editor.press("Control+z");
  await expect(editor).toHaveValue("prefix one\nsecond suffix");
  for (const key of ["Backspace", "Delete"]) {
    await editor.focus();
    await editor.evaluate((control: HTMLTextAreaElement) =>
      control.setSelectionRange(7, 17),
    );
    await editor.press(key);
    await expect(editor).toHaveValue("prefix  suffix");
    expect(
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
        "editor-delete"
      ],
    ).toBe("prefix one\nsecond suffix");
    await editor.press("Control+z");
    await expect(editor).toHaveValue("prefix one\nsecond suffix");
  }
  await operation("text", "protected");
  await expect(editor).toHaveValue("protected");
  await editor.selectText();
  await editor.press("Backspace");
  await expect(editor).toHaveValue("protected");
  await expect
    .poll(() =>
      editor.evaluate((control: HTMLTextAreaElement) => [
        control.selectionStart,
        control.selectionEnd,
      ]),
    )
    .toEqual([0, 9]);
  for (const mode of ["consumeBulk", "replaceBulk"]) {
    await operation("text", "draft text");
    await expect(editor).toHaveValue("draft text");
    await operation("compositionHook", mode);
    await editor.fill("line one\nline two");
    await expect(editor).toHaveValue(
      mode === "consumeBulk" ? "draft text" : "changed one\nchanged two",
    );
  }
  await operation("compositionHook");
  await operation("text", "draft text");
  await expect(editor).toHaveValue("draft text");
  await editor.focus();
  await editor.selectText();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.imeSetComposition", {
      text: "preedit",
      selectionStart: 7,
      selectionEnd: 7,
      replacementStart: 0,
      replacementEnd: 10,
    });
    await cdp.send("Input.insertText", { text: "line one\nline two" });
    await expect(editor).toHaveValue("line one\nline two");
    await expect(editor).not.toHaveAttribute("data-pi-composing", "true");
    await editor.press("Control+z");
    await expect(editor).toHaveValue("draft text");
  } finally {
    await cdp.detach();
  }
  const previous = "\u5bbd\u5b57\u7b26\u{1f642} e\u0301 words ".repeat(100);
  await operation("text", previous);
  await expect(editor).toHaveValue(previous);
  const large = "header\nshort\n" + "Wide WWWW narrow iiii word ".repeat(100);
  await editor.fill(large);
  await expect(editor).toHaveValue(/\[paste #1/);
  await expect.poll(() => operation("read")).toBe(large);
  await editor.press("Control+z");
  await expect(editor).toHaveValue(previous);
  await operation("text", "prefix suffix");
  await expect(editor).toHaveValue("prefix suffix");
  await editor.focus();
  await editor.evaluate((control: HTMLTextAreaElement) =>
    control.setSelectionRange(7, 7),
  );
  await page.keyboard.insertText("A\nB");
  await page.keyboard.insertText("C\nD");
  await expect(editor).toHaveValue("prefix A\nBC\nDsuffix");
  await expect.poll(() => operation("read")).toBe("prefix A\nBC\nDsuffix");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await sdkAction(page, "session.new");
  await operation("compositionHook", "replaceBulk");
  await editor.fill("default draft");
  await expect(editor).toHaveValue("default draft");
  await editor.fill("line one\nline two");
  await expect(editor).toHaveValue("changed one\nchanged two");
  expect(await operation("read")).toBe("changed one\nchanged two");
  await operation("compositionHook");
  await sdkAction(page, "prompt", { message: "/mapped-form" });
  const dialog = page.getByRole("dialog");
  const nested = dialog.getByRole("textbox", { name: "编辑内容", exact: true });
  await nested.fill("dialog draft");
  await expect(nested).toHaveValue("dialog draft");
  await nested.fill("line one\nline two");
  await expect(nested).toHaveValue("line one\nline two");
  await nested.press("Control+z");
  await expect(nested).toHaveValue("dialog draft");
  const name = dialog.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("name draft");
  await expect(name).toHaveValue("name draft");
  await name.fill("first\nsecond\titem");
  await expect(name).toHaveValue("firstsecond    item");
  await name.press("Control+z");
  await expect(name).toHaveValue("name draft");
  for (const key of ["Backspace", "Delete"]) {
    await name.selectText();
    await name.press(key);
    await expect(name).toHaveValue("");
    expect(
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
        "form-input-delete"
      ],
    ).toBe("name draft");
    await name.press("Control+z");
    await expect(name).toHaveValue("name draft");
  }
  await name.fill("protected");
  await expect(name).toHaveValue("protected");
  await name.selectText();
  await name.press("Delete");
  await expect(name).toHaveValue("protected");
  await expect
    .poll(() =>
      name.evaluate((control: HTMLInputElement) => [
        control.selectionStart,
        control.selectionEnd,
      ]),
    )
    .toEqual([0, 9]);
  await name.fill("name draft");
  await expect(name).toHaveValue("name draft");
  await name.press("Enter");
  await expect(
    dialog.getByText("Input submitted: name draft", { exact: true }),
  ).toBeVisible();
  await sdkAction(page, "abort");
  await expect(dialog).toBeHidden();
  await sdkAction(page, "session.new");
}
