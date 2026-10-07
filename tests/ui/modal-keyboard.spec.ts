import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";

for (const width of [1440, 390]) {
  test(`a mapped modal retains original Escape navigation after its control loses focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "prompt", { message: "/mapped-settings" });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Nested/ }).click();
    await expect(dialog.getByRole("combobox")).toBeVisible();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    expect(
      await page.evaluate(() => document.activeElement === document.body),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("button", { name: /Nested/ })).toBeVisible();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}
