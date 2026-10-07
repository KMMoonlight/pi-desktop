import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyComponentAppearance(
  page: Page,
  screenshot: string,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "desktop.appearance", { appearance: "light" });
  await sdkAction(page, "prompt", { message: "/component-appearance-probe" });
  const dialog = page.getByRole("dialog");
  try {
    const query = dialog.getByText(/^Color query: /);
    await expect(query).toBeVisible();
    const colors = JSON.parse(
      (await query.innerText()).slice("Color query: ".length),
    );
    expect(colors.foreground).toEqual({ r: 228, g: 231, b: 237 });
    expect(colors.background).toEqual({ r: 19, g: 22, b: 28 });
    expect(colors.palette).toHaveLength(16);
    const change = (appearance: string) =>
      sdkAction(page, "desktop.appearance", { appearance });
    const command = async (text: string) => {
      const input = dialog.getByRole("textbox");
      await input.fill(text);
      await input.press("Enter");
      await expect(input).toHaveValue("");
    };
    await change("dark");
    await expect(
      dialog.getByText("Appearance: dark; callbacks: 1", { exact: true }),
    ).toBeVisible();
    await command("disable");
    await change("light");
    await expect(
      dialog.getByText("Appearance: dark; callbacks: 1", { exact: true }),
    ).toBeVisible();
    await command("enable");
    await change("dark");
    await expect(
      dialog.getByText("Appearance: dark; callbacks: 2", { exact: true }),
    ).toBeVisible();
    await change("light");
    await expect(
      dialog.getByText("Appearance: light; callbacks: 3", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: screenshot });
    await command("unsubscribe");
    await change("dark");
    await expect(
      dialog.getByText("Appearance: light; callbacks: 3", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("textbox").fill("close");
    await dialog.getByRole("textbox").press("Enter");
    await expect(dialog).toHaveCount(0);
    await change("light");
    expect(
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
        "component-appearance"
      ],
    ).toBe("light:3");
  } finally {
    await sdkAction(page, "abort").catch(() => {});
  }
}
