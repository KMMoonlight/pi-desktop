import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

interface State {
  active: number;
  consumed: number;
  focused: number;
  calls: string[];
  values: string[];
  submitted: string[];
}

export async function verifyTerminalDescendant(
  page: Page,
  kind: string,
  mode: string,
  screenshot?: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/terminal-descendant-probe ${kind} ${mode}`,
  });
  const dialog = page.getByRole("dialog");
  const frames = dialog.getByLabel("扩展终端组件");
  const initial = mode === "regions" ? 1 : 0;
  const input = frames.nth(initial).locator(".xterm-helper-textarea");
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async (): Promise<State> =>
    JSON.parse((await snapshot()).statuses["terminal-descendant-state"]);
  const editing = ["Input", "Editor", "CustomEditor"].includes(kind);
  const frameCount = mode === "regions" ? 2 : 1;
  try {
    await expect(frames).toHaveCount(frameCount);
    await expect(input).toBeFocused();
    await page.keyboard.press(editing ? "a" : "ArrowDown");
    await expect
      .poll(async () => (await state()).calls.at(-1))
      .toBe(`${initial}:${editing ? "a" : "\x1b[B"}`);
    expect((await state()).focused).toBe(initial);
    if (editing) {
      await input.press("Control+a");
      await page.keyboard.type("!");
      await expect
        .poll(async () => (await state()).values[initial])
        .toBe(initial ? "!twoa" : "!onea");
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
        .poll(async () => (await state()).values[initial])
        .toBe(initial ? "!twoa-paste" : "!onea-paste");
      await input.evaluate((element) => {
        const target = element as HTMLTextAreaElement;
        target.value = "";
        target.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        );
        target.value = "\u4e2d\u6587";
        target.dispatchEvent(
          new CompositionEvent("compositionupdate", {
            bubbles: true,
            data: "\u4e2d\u6587",
          }),
        );
        target.dispatchEvent(
          new CompositionEvent("compositionend", {
            bubbles: true,
            data: "\u4e2d\u6587",
          }),
        );
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertFromComposition",
            data: "\u4e2d\u6587",
          }),
        );
      });
      await expect
        .poll(async () => (await state()).values[initial])
        .toBe(initial ? "!twoa-paste\u4e2d\u6587" : "!onea-paste\u4e2d\u6587");
    }
    // Clicking an opaque emitter must retain the original SDK input target.
    await frames
      .first()
      .locator(".xterm-screen")
      .click({ position: { x: 12, y: 8 } });
    await page.keyboard.press("F2");
    await expect.poll(async () => (await state()).focused).toBe(1);
    const current = frames.first().locator(".xterm-helper-textarea");
    await expect(current).toBeFocused();
    await expect
      .poll(async () => (await state()).calls.at(-1))
      .toBe(`1:${editing ? "b" : "\x1b[B"}`);
    await current.press("Enter");
    await expect
      .poll(async () => (await state()).submitted)
      .toEqual([
        editing
          ? `1:${initial ? "!twoa-paste\u4e2d\u6587b" : "twob"}`
          : kind === "SelectList"
            ? "1:beta"
            : "1:beta:on",
      ]);
    const before = (await state()).calls;
    await current.press("F3");
    await expect.poll(async () => (await state()).consumed).toBe(1);
    expect((await state()).calls).toEqual(before);
    if (screenshot) await page.screenshot({ path: screenshot });
    await current.press("F5");
    await expect.poll(async () => (await state()).focused).toBe(-1);
    await expect(current).not.toBeFocused();
    const surface = (await snapshot()).desktopSurfaces.find(
      (value) => value.slot === "dialog",
    )!;
    await sdkAction(page, "desktop.input", {
      surfaceId: surface.id,
      data: "after-clear",
    });
    expect((await state()).calls).toEqual(before);
    await sdkAction(page, "desktop.input", {
      surfaceId: surface.id,
      data: "\x1b[17~",
      raw: true,
    });
    await expect.poll(async () => (await state()).focused).toBe(0);
    await expect(
      frames.first().locator(".xterm-helper-textarea"),
    ).toBeFocused();
    await expect
      .poll(async () => (await state()).calls.at(-1))
      .toBe(`0:${editing ? "q" : "\r"}`);
    await page.keyboard.press("F4");
    await pending;
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => {
        const result = (await snapshot()).statuses[
          "terminal-descendant-result"
        ];
        return result && JSON.parse(result).disposed;
      })
      .toEqual([1, 1]);
  } finally {
    if (!page.isClosed() && (await dialog.count())) {
      const surface = (await snapshot()).desktopSurfaces.find(
        (value) => value.slot === "dialog",
      );
      if (surface) await sdkAction(page, "desktop.close", { id: surface.id });
      await pending.catch(() => {});
    }
  }
}
