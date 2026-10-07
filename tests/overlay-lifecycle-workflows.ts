import { expect, type Page } from "@playwright/test";
import type { DesktopSnapshot } from "../shared/types.ts";
import { sdkAction } from "./editor-workflows.ts";

export const overlayLifecycleModes = [
  "native",
  "xterm",
  "direct-native",
  "direct-xterm",
];

export async function verifyOverlayLifecycle(
  page: Page,
  mode: string,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  const pending = sdkAction(page, "prompt", {
    message: `/overlay-lifecycle-probe ${mode}`,
  });
  const state = async () =>
    JSON.parse(
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
        "overlay-lifecycle-state"
      ],
    );
  const control = (operation: string) =>
    sdkAction(page, "prompt", {
      message: `/overlay-lifecycle-control ${operation}`,
    });
  const input = page.getByRole("textbox", {
    name: "Overlay lifecycle input",
    exact: true,
  });
  const terminal = page.getByLabel("扩展终端组件");
  let directId: string | undefined;
  const focus = async () => {
    if (mode.endsWith("xterm")) {
      await expect(input).toHaveCount(0);
      await expect(terminal).toBeVisible();
      await terminal.locator(".xterm-helper-textarea").focus();
    } else {
      await expect(terminal).toHaveCount(0);
      await expect(input).toBeVisible();
      await input.focus();
    }
  };
  try {
    await focus();
    if (mode.startsWith("direct"))
      directId = (
        await sdkAction<DesktopSnapshot>(page, "snapshot")
      ).desktopSurfaces.find((surface) => surface.overlay)?.id;
    await page.keyboard.type("before");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await state()).value).toBe("before");
    await page.screenshot({ path: screenshot });
    await control("temporary");
    await expect(input).toBeHidden();
    await expect(terminal).toBeHidden();
    expect(await state()).toMatchObject({
      settled: false,
      disposed: 0,
      hidden: true,
      focused: false,
    });
    await control("restore");
    await focus();
    await page.keyboard.press("End");
    await page.keyboard.type("-after");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await state()).value).toBe("before-after");
    await control(mode.startsWith("direct") ? "hide-stack" : "hide");
    await control("focus");
    await expect(input).toHaveCount(0);
    await expect(terminal).toHaveCount(0);
    expect(await state()).toMatchObject({
      settled: false,
      disposed: 0,
      hidden: false,
      focused: false,
      value: "before-after",
    });
    if (mode.startsWith("direct"))
      await expect(
        page.getByRole("textbox", {
          name: "Overlay lifecycle parent",
          exact: true,
        }),
      ).toBeVisible();
    await control("done");
    await pending;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await state()).toMatchObject({
      settled: true,
      disposed: mode.startsWith("direct") ? 0 : 1,
      result: "before-after",
    });
    if (directId) {
      await sdkAction(page, "desktop.close", { id: directId });
      expect((await state()).disposed).toBe(1);
    }
  } finally {
    await control("done").catch(() => {});
    await pending.catch(() => {});
  }
}
