import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

interface State {
  mode: string;
  disposed: number;
  submitted: string[];
  calls: string[];
  value?: string;
  focused: boolean;
  updates: number;
}

export async function verifyCompositeFocus(
  page: Page,
  kind: string,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/composite-focus-probe ${kind}`,
  });
  const dialog = page.getByRole("dialog");
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  await expect(dialog).toBeVisible();
  const surface = (await snapshot()).desktopSurfaces.find(
    (item) => item.slot === "dialog",
  )!;
  const target = dialog
    .locator(`[data-component-action="${surface.focusRequest!.action}"]`)
    .first();
  const state = async () =>
    JSON.parse((await snapshot()).statuses["composite-focus-state"]);
  try {
    await expect(target).toBeFocused();
    await page.keyboard.press(kind === "readonly" ? "ArrowDown" : "z");
    await expect
      .poll(async () => (await state()).calls)
      .toEqual([kind === "readonly" ? "\x1b[B" : "z"]);
    if (kind === "readonly") expect((await state()).selected).toBe(1);
    else
      await expect(
        dialog.getByRole("textbox", { name: "Composite peer", exact: true }),
      ).toHaveValue("");
    await page.screenshot({ path: screenshot });
    await page.keyboard.press("F4");
    await pending;
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => {
        const result = (await snapshot()).statuses["composite-focus-result"];
        return result && JSON.parse(result).disposed;
      })
      .toBe(1);
  } finally {
    if (!page.isClosed() && (await dialog.count())) {
      await sdkAction(page, "desktop.close", { id: surface.id });
      await pending.catch(() => {});
    }
  }
}

export async function verifyTerminalTransition(
  page: Page,
  kind: string,
  holder: string,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/terminal-transition-probe ${kind} ${holder}`,
  });
  const dialog = page.getByRole("dialog");
  const editing = ["Input", "Editor", "CustomEditor"].includes(kind);
  const native =
    kind === "SelectList"
      ? dialog
          .getByRole("combobox", { name: "选择", exact: true })
          .or(dialog.getByRole("listbox", { name: "选择", exact: true }))
      : kind === "SettingsList"
        ? dialog.locator('[data-desktop-action$=":setting:alpha"]').first()
        : dialog.getByRole("textbox", {
            name: kind === "Input" ? "Transition field" : "编辑内容",
            exact: true,
          });
  const frame = dialog.getByLabel("扩展终端组件");
  const input = frame.locator(".xterm-helper-textarea");
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async (): Promise<State> =>
    JSON.parse((await snapshot()).statuses["terminal-transition-state"]);
  try {
    await expect(native).toBeVisible();
    const focusAction = (await snapshot()).desktopSurfaces.find(
      (item) => item.slot === "dialog",
    )!.focusRequest!.action;
    const keyTarget =
      kind === "SettingsList"
        ? dialog.locator(`[data-component-action="${focusAction}"]`).first()
        : native;
    await expect(keyTarget).toBeFocused();
    await expect(frame).toHaveCount(0);
    for (let round = 0; round < 2; round++) {
      await keyTarget.press("F2");
      await expect(frame).toBeVisible();
      await expect(native).toHaveCount(0);
      await expect(input).toBeFocused();
      expect((await state()).focused).toBe(true);
      expect((await state()).disposed).toBe(0);
      if (editing) {
        await input.press("Control+e");
        await page.keyboard.type("x");
        await input.press("Control+a");
        await page.keyboard.type("!");
        await expect
          .poll(async () => (await state()).value)
          .toBe(round ? "!SDK update 1x" : "!onex");
        await input.press("Control+e");
        await input.evaluate((element) => {
          const clipboardData = new DataTransfer();
          clipboardData.setData("text/plain", "-paste");
          element.dispatchEvent(
            new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData,
            }),
          );
        });
        await expect
          .poll(async () => (await state()).value)
          .toBe(round ? "!SDK update 1x-paste" : "!onex-paste");
      } else await input.press("ArrowDown");
      await input.press("Enter");
      await expect
        .poll(async () => (await state()).submitted)
        .toEqual(
          Array.from({ length: round + 1 }, (_, index) =>
            editing
              ? index
                ? "!SDK update 1x-paste"
                : "!onex-paste"
              : kind === "SelectList"
                ? "beta"
                : "beta:on",
          ),
        );
      await input.press("F3");
      await expect.poll(async () => (await state()).updates).toBe(round + 1);
      expect((await state()).disposed).toBe(0);
      if (!round) await page.screenshot({ path: screenshot });
      await input.press("F2");
      await expect(frame).toHaveCount(0);
      await expect(native).toBeVisible();
      await expect(keyTarget).toBeFocused();
      if (editing) await expect(native).toHaveValue(`SDK update ${round + 1}`);
      expect((await state()).focused).toBe(true);
      expect((await state()).disposed).toBe(0);
    }
    await keyTarget.press("F4");
    await pending;
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => {
        const result = (await snapshot()).statuses[
          "terminal-transition-result"
        ];
        return result && JSON.parse(result).disposed;
      })
      .toBe(1);
  } finally {
    if (!page.isClosed() && (await dialog.count())) {
      const surface = (await snapshot()).desktopSurfaces.find(
        (item) => item.slot === "dialog",
      );
      if (surface) await sdkAction(page, "desktop.close", { id: surface.id });
      await pending.catch(() => {});
    }
  }
}
