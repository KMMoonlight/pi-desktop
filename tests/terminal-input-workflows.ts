import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const terminalInputModes = [
  "default",
  "mapped",
  "terminal",
  "dialog",
] as const;
export async function verifyTerminalInput(
  page: Page,
  mode: (typeof terminalInputModes)[number],
  screenshot?: string,
) {
  const command = (message: string) => sdkAction(page, "prompt", { message });
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async () =>
    JSON.parse((await snapshot()).statuses["global-input"]);
  const terminal = page.getByLabel("扩展终端组件", { exact: true });
  try {
    await command("/global-input-probe");
    await expect(
      page.getByText("Global input header", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Global input footer", { exact: true }),
    ).toBeVisible();
    if (mode !== "default") await command(`/global-input-open ${mode}`);
    const target =
      mode === "default"
        ? page.getByRole("textbox", { name: "消息", exact: true })
        : mode === "terminal"
          ? terminal.locator(".xterm-helper-textarea")
          : mode === "dialog"
            ? page.getByRole("textbox", {
                name: "Shared native dialog",
                exact: true,
              })
            : page.getByRole("textbox", {
                name: "Shared mapped input",
                exact: true,
              });
    await expect(target).toBeVisible();
    await target.focus();
    const before = await state();
    await target.press("g");
    await expect
      .poll(async () => (await state()).events.slice(before.events.length))
      .toEqual([
        "context:press:g",
        "header:press:g",
        "footer:press:H",
        "context:release:g",
        "header:release:g",
        "footer:press:H",
      ]);
    await expect
      .poll(async () => (await state()).duplicates - before.duplicates)
      .toBe(2);
    // Both the press and release are deliberately transformed into printable
    // input. The release path must ignore stale DOM context.
    if (mode === "terminal")
      await expect(terminal.locator(".xterm-rows")).toContainText(
        "Shared terminal: GG",
      );
    else await expect(target).toHaveValue("GG");
    await target.press("d");
    await expect.poll(async () => (await state()).debug).toBe(2);
    await target.press("s");
    await expect.poll(async () => (await state()).shortcuts).toBe(2);
    if (mode === "terminal")
      await expect(terminal.locator(".xterm-rows")).toContainText(
        "Shared terminal: GG",
      );
    else await expect(target).toHaveValue("GG");
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
    if (mode !== "default") {
      await target.press("Enter");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect
        .poll(async () => (await snapshot()).statuses["global-input-result"])
        .toBe(`${mode}:GG`);
    }
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.fill("");
    await command("/global-input-retire");
    await expect(
      page.getByText("Global input header", { exact: true }),
    ).toHaveCount(0);
    await editor.press("g");
    await expect(editor).toHaveValue("GG");
    await command("/global-input-remove");
    await editor.fill("");
    await editor.press("g");
    await expect(editor).toHaveValue("g");
    await command("/global-input-cleanup");
    await expect(
      page.getByText("Global input footer", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await sdkAction(page, "auth.cancel").catch(() => {});
    await command("/global-input-cleanup").catch(() => {});
  }
}
