import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyScrollbars(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/scrollbar-probe" });
  const dialog = page.getByRole("dialog");
  const scroll = dialog.locator(".desktop-scroll");
  const select = dialog.getByRole("combobox", { name: "选择", exact: true });
  const choose = async (value: string) => {
    await select.selectOption(value);
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
  };
  const colors = "rgb(0, 128, 0) rgb(0, 0, 128)";
  const hidden = "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)";
  await expect(scroll).toHaveCSS("overflow-y", "scroll");
  await expect(scroll).toHaveCSS("scrollbar-color", colors);
  const gutter = await scroll.evaluate((element: HTMLDivElement) => {
    const bounds = element.getBoundingClientRect();
    return {
      width: element.offsetWidth - element.clientWidth,
      x: bounds.right - 3,
      y: bounds.top + 20,
    };
  });
  expect(gutter.width).toBeGreaterThan(0);
  await page.mouse.move(gutter.x, gutter.y);
  await expect(scroll).toHaveCSS(
    "scrollbar-color",
    "rgb(128, 0, 0) rgb(0, 0, 128)",
  );
  await select.hover();
  await expect(scroll).toHaveCSS("scrollbar-color", colors);
  await choose("short");
  await expect(scroll).toContainText("Short content");
  await expect(scroll).toHaveCSS("scrollbar-color", colors);
  await choose("auto");
  await expect(scroll).toHaveCSS("scrollbar-color", hidden);
  await expect(scroll).toHaveCSS("overflow-y", "auto");
  await choose("long");
  await expect
    .poll(async () => {
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      const [content, viewport] = (snapshot.statuses["scrollbar-layout"] ?? "")
        .split(":")
        .map(Number);
      return content === 60 && viewport > 0 && viewport < content;
    })
    .toBe(true);
  await choose("active");
  await expect(scroll).toHaveCSS(
    "scrollbar-color",
    "rgb(128, 0, 0) rgb(0, 0, 128)",
  );
  await page.waitForTimeout(500);
  await expect(scroll).toHaveCSS(
    "scrollbar-color",
    "rgb(128, 0, 0) rgb(0, 0, 128)",
  );
  await choose("inactive");
  await expect(scroll).toHaveCSS("scrollbar-color", hidden);
  await choose("scroll");
  await expect(scroll).toHaveCSS("scrollbar-color", colors);
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(scroll).toHaveCSS("scrollbar-color", hidden);
  await choose("hidden");
  await expect(scroll).toHaveCSS("scrollbar-width", "none");
  await choose("always");
  await expect(scroll).toHaveCSS("scrollbar-color", colors);
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await choose("close");
  await expect(dialog).toBeHidden();
}
