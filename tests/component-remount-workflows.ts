import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const remountModes = [
  "writable",
  "configurable",
  "inherited",
  "getter",
  "locked",
  "frozen",
  "overlap",
  "wrapped",
  "wrapped-chain",
  "wrapped-frozen",
  "wrapped-overlap",
  "wrapped-async",
  "wrapped-async-frozen",
  "wrapped-async-overlap",
];

export async function verifyComponentRemount(
  page: Page,
  mode: string,
  screenshot: string,
) {
  const overlap = mode.endsWith("overlap");
  const levels = mode === "wrapped-chain" ? 3 : 1;
  const wrapperCycle = mode.startsWith("wrapped")
    ? [
        ...Array.from(
          { length: levels },
          (_, index) => `before-${levels - index - 1}`,
        ),
        "original",
        ...Array.from({ length: levels }, (_, index) => `after-${index}`),
      ]
    : [];
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/component-remount-probe ${mode}`,
  });
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async () => {
    const value = (await snapshot()).statuses["component-remount-state"];
    return value === undefined ? {} : JSON.parse(value);
  };
  const input = page.getByRole("textbox", {
    name: "Reusable lifecycle",
    exact: true,
  });
  try {
    if (overlap) {
      await pending;
      await expect(input).toHaveCount(2);
      await input.first().fill("shared-original");
      await expect(input.last()).toHaveValue("shared-original");
      if (mode.startsWith("wrapped")) {
        await input.first().press("Control+e");
        await expect.poll(async () => (await state()).wrapped).toBe(true);
      }
      await expect.poll(async () => (await state()).disposals).toBe(0);
      await sdkAction(page, "prompt", {
        message: "/component-remount-clear header",
      });
      await expect(input).toHaveCount(1);
      await expect.poll(async () => (await state()).disposals).toBe(1);
      await input.press("Control+e");
      await input.press("!");
      await expect(input).toHaveValue("shared-original!");
      await input.press("Enter");
      await expect
        .poll(
          async () =>
            (await snapshot()).statuses["component-remount-submitted"],
        )
        .toBe("shared-original!");
      await page.screenshot({ path: screenshot });
      await sdkAction(page, "prompt", {
        message: "/component-remount-clear footer",
      });
      await expect(input).toHaveCount(0);
      await expect.poll(async () => (await state()).disposals).toBe(2);
      expect(await state()).toMatchObject({
        disposals: 2,
        receiverErrors: 0,
        wrapperEvents: [...wrapperCycle, ...wrapperCycle],
        restored: true,
      });
      return;
    }
    const dialog = page.getByRole("dialog");
    const field =
      mode === "frozen" || mode.endsWith("-frozen")
        ? dialog.getByLabel("扩展终端组件").locator(".xterm-helper-textarea")
        : input;
    for (let index = 0; index < 3; index++) {
      await expect.poll(async () => (await state()).mounts).toBe(index + 1);
      await expect.poll(async () => (await state()).disposals).toBe(index);
      await expect(field).toBeFocused();
      expect(await state()).toMatchObject({
        disposals: index,
        reads: mode === "getter" ? index : 0,
      });
      await page.keyboard.type(`mount-${index}`);
      await expect
        .poll(async () => (await state()).text)
        .toBe(`mount-${index}`);
      if (index === 2) await page.screenshot({ path: screenshot });
      await field.press("Enter");
    }
    await pending;
    await expect(dialog).toHaveCount(0);
    expect(
      JSON.parse((await snapshot()).statuses["component-remount-result"]),
    ).toEqual({
      results: ["mount-0", "mount-1", "mount-2"],
      disposals: 3,
      reads: mode === "getter" ? 3 : 0,
      receiverErrors: 0,
      wrapperEvents: [...wrapperCycle, ...wrapperCycle, ...wrapperCycle],
      restored: true,
    });
  } finally {
    if (!page.isClosed()) {
      if (overlap)
        for (const slot of ["header", "footer"])
          await sdkAction(page, "prompt", {
            message: `/component-remount-clear ${slot}`,
          }).catch(() => {});
      else if (await page.getByRole("dialog").count()) {
        const current = (await snapshot()).desktopSurfaces.find(
          (surface) => surface.slot === "dialog",
        );
        if (current) await sdkAction(page, "desktop.close", { id: current.id });
        await pending.catch(() => {});
      }
    }
  }
}
