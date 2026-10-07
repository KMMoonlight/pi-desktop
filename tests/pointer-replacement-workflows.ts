import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";

export async function verifyPointerReplacement(page: Page) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/mapped-native-pointer" });
  const input = page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Pointer name", exact: true });
  for (let attempt = 0; attempt < 20; attempt++) {
    await input.fill(`Previous text ${attempt}`);
    await input.fill("Native input selection");
    const point = await input.evaluate((input: HTMLInputElement) => {
      const style = getComputedStyle(input);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = style.font;
      const rect = input.getBoundingClientRect();
      const x = rect.x + parseFloat(style.paddingLeft) + 1;
      return {
        x,
        y: rect.y + rect.height / 2,
        end: x + context.measureText(input.value.slice(0, 6)).width,
      };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.end, point.y, { steps: 5 });
    await page.mouse.up();
    await expect(input).not.toHaveAttribute("data-pi-input-pending", "true");
    await expect(input).not.toHaveAttribute("data-pointer-pending", /.+/);
    await expect
      .poll(
        () =>
          input.evaluate((input: HTMLInputElement) => [
            input.value,
            input.selectionStart,
            input.selectionEnd,
          ]),
        { timeout: 2000 },
      )
      .toEqual(["Native input selection", 0, 6]);
  }
  await sdkAction(page, "abort");
}
