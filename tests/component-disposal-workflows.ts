import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const disposalModes = [
  "writable",
  "configurable",
  "inherited",
  "getter",
  "locked",
  "frozen",
  "children",
  "self",
  "none",
  "transition",
  "cached",
];

export async function verifyComponentDisposal(
  page: Page,
  mode: string,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/component-disposal-probe ${mode}`,
  });
  const dialog = page.getByRole("dialog");
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async () =>
    JSON.parse((await snapshot()).statuses["component-disposal-state"]);
  const frame = dialog.getByLabel("扩展终端组件");
  const field =
    mode === "frozen"
      ? frame.locator(".xterm-helper-textarea")
      : dialog.getByRole("textbox", {
          name: "Readonly lifecycle",
          exact: true,
        });
  await expect(dialog).toBeVisible();
  const surface = (await snapshot()).desktopSurfaces.find(
    (item) => item.slot === "dialog",
  )!;
  try {
    await expect(field).toBeFocused();
    await page.keyboard.type("desktop");
    await expect.poll(async () => (await state()).text).toBe("desktop");
    expect((await state()).events).toEqual([]);
    expect((await state()).reads).toBe(0);
    if (mode === "transition") {
      await field.press("F2");
      const terminalInput = frame.locator(".xterm-helper-textarea");
      await expect(terminalInput).toBeFocused();
      await terminalInput.press("Control+e");
      await page.keyboard.type("-terminal");
      await expect
        .poll(async () => (await state()).text)
        .toBe("desktop-terminal");
      await terminalInput.press("F3");
      await expect
        .poll(async () => (await state()).text)
        .toBe("SDK readonly update");
      await expect.poll(async () => (await state()).events).toEqual([]);
      await page.screenshot({ path: screenshot });
      await terminalInput.press("F2");
      await expect(frame).toHaveCount(0);
      await expect(field).toHaveValue("SDK readonly update");
      await expect(field).toBeFocused();
    } else if (mode === "cached") {
      await field.press("F2");
      await expect(
        dialog.getByText("Cached child hidden", { exact: true }),
      ).toBeVisible();
      await expect.poll(async () => (await state()).events).toEqual(["parent"]);
      await sdkAction(page, "desktop.input", {
        surfaceId: surface.id,
        instanceId: surface.instanceId,
        data: "\x1bOQ",
      });
      await expect(field).toHaveValue("restored");
      await expect(field).toBeFocused();
      await field.press("Control+e");
      await page.keyboard.type("!");
      await expect(field).toHaveValue("restored!");
      await page.screenshot({ path: screenshot });
    } else await page.screenshot({ path: screenshot });
    await field.press("Enter");
    await pending;
    await expect(dialog).toHaveCount(0);
    const result = JSON.parse(
      (await snapshot()).statuses["component-disposal-result"],
    );
    expect(result.result).toBe(
      mode === "transition"
        ? "SDK readonly update"
        : mode === "cached"
          ? "restored!"
          : "desktop",
    );
    expect(result.events).toEqual(
      mode === "frozen" || mode === "self"
        ? ["root"]
        : mode === "cached"
          ? ["parent", "child"]
          : ["children", "transition"].includes(mode)
            ? ["root", "child"]
            : ["child"],
    );
    expect(result.reads).toBe(mode === "getter" ? 1 : 0);
  } finally {
    if (!page.isClosed() && (await dialog.count())) {
      await sdkAction(page, "desktop.close", { id: surface.id });
      await pending.catch(() => {});
    }
  }
}
