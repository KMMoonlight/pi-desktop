import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types";

export async function verifyComponentImage(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const state = await sdkAction<DesktopSnapshot>(page, "snapshot");
      return state.changing || state.busy;
    })
    .toBe(false);
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/image-probe" });
  const dialog = page.getByRole("dialog");
  const picture = dialog.getByRole("img", { name: "mapped-image.svg" });
  await expect(picture).toBeVisible();
  const size = () =>
    picture.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [Math.round(bounds.width), Math.round(bounds.height)];
    });
  await expect.poll(size).toEqual([160, 80]);
  expect(
    await picture.evaluate((element: HTMLImageElement) => element.naturalWidth),
  ).toBe(800);
  const select = dialog.getByRole("combobox", { name: "选择", exact: true });
  const change = async (value: string) => {
    await select.selectOption(value);
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
  };
  await change("narrow");
  await expect.poll(size).toEqual([80, 40]);
  await change("broken");
  await expect(picture).toContainText(
    "Unavailable [Image: mapped-image.svg [image/svg+xml] 800x400]",
  );
  const fallback = picture.locator("span").first();
  await expect(fallback).toHaveCSS("color", "rgb(128, 0, 0)");
  await expect(fallback).toHaveCSS("font-style", "italic");
  await change("recover");
  await expect(picture).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
  await expect
    .poll(() =>
      picture.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(800);
  await expect.poll(size).toEqual([80, 40]);
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await change("close");
  await expect(dialog).toBeHidden();
}
