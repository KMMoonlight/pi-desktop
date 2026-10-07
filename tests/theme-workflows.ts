import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import { selectField } from "./select-field.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

interface ThemeResult {
  result?: { success: boolean; error?: string };
  themes: { name: string; path?: string }[];
  current: string;
  saved: string | null;
  setting: string | null;
  nativeHeading: string;
  heading: string;
}

export async function verifyThemeInvalidation(page: Page) {
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (args: Record<string, unknown>) =>
    sdkAction(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/sdk-themes.mjs`,
      args,
    });
  try {
    await probe({ theme: "light" });
    await sdkAction(page, "prompt", {
      message: "/component-theme-cache-probe",
    });
    await expect(
      page.getByText("Cached theme: light:light", { exact: true }),
    ).toBeVisible();
    await probe({ theme: "dark" });
    await expect(
      page.getByText("Cached theme: dark:dark", { exact: true }),
    ).toBeVisible();
    await probe({ theme: "light", instance: true });
    await expect(
      page.getByText("Cached theme: light:light", { exact: true }),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark" });
    await probe({ theme: "system" });
    await expect(
      page.getByText("Cached theme: system:dark", { exact: true }),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(
      page.getByText("Cached theme: system:light", { exact: true }),
    ).toBeVisible();
  } finally {
    await sdkAction(page, "prompt", {
      message: "/component-theme-cache-probe remove",
    });
    await probe({ theme: "system" });
  }
}

export async function verifySystemThemes(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (args: Record<string, unknown> = {}) =>
    sdkAction<ThemeResult>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/sdk-themes.mjs`,
      args,
    });
  const styled = async (name: string, appearance: string) => {
    await expect
      .poll(async () => {
        const state = await sdkAction<DesktopSnapshot>(page, "snapshot");
        const theme = state.extensionUI.theme;
        const actual = await page.evaluate(() => ({
          appearance: document.documentElement.dataset.theme,
          accent: getComputedStyle(document.documentElement)
            .getPropertyValue("--pi-accent")
            .trim(),
        }));
        return (
          theme?.name === name &&
          theme.appearance === appearance &&
          actual.appearance === appearance &&
          actual.accent === theme.colors.accent
        );
      })
      .toBe(true);
  };
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    const automatic = await probe({ setting: "light/dark" });
    expect(automatic.setting).toBe("light/dark");
    await styled("dark", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await styled("light", "light");
    expect((await probe()).setting).toBe("light/dark");
    await probe({ theme: "dark" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await styled("dark", "dark");
    await probe({ theme: "light", instance: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await styled("light", "light");
    await probe({ theme: "system" });
    await styled("system", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await styled("system", "light");
    await probe({ fileAccent: "#216a51", activateFile: true });
    await styled("desktop-live-theme", "light");
    await probe({ fileAccent: "#944859" });
    await expect
      .poll(async () => {
        const state = await sdkAction<DesktopSnapshot>(page, "snapshot");
        const accent = await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--pi-accent")
            .trim(),
        );
        return (
          state.extensionUI.theme?.colors.accent === "#944859" &&
          accent === "#944859"
        );
      })
      .toBe(true);
    const updated = await probe();
    expect(updated.nativeHeading).toBe(updated.heading);
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await sdkAction(page, "theme.set", { theme: "system" });
    await styled("system", "light");
    const openSidebar = page.getByRole("button", {
      name: "打开侧边栏",
      exact: true,
    });
    if (await openSidebar.isVisible()) await openSidebar.click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "颜色模式", exact: true }),
    ).toHaveAttribute("data-value", "system");
    await selectField(page.getByRole("combobox", { name: "颜色模式", exact: true }), "dark");
    await styled("dark", "dark");
    await expect.poll(async () => (await probe()).saved).toBe("dark");
    await selectField(page.getByRole("combobox", { name: "颜色模式", exact: true }), "system");
    await styled("system", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await styled("system", "dark");
    await expect(
      page.getByRole("combobox", { name: "颜色模式", exact: true }),
    ).toHaveAttribute("data-value", "system");
  } finally {
    await page.emulateMedia({ colorScheme: null });
    await probe({ theme: "light" });
    if (
      await page
        .getByRole("heading", { name: "工作区设置", exact: true })
        .isVisible()
    )
      await page.getByRole("button", { name: "设置", exact: true }).click();
  }
}

export async function verifySdkThemes(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (theme?: string, instance = false, reapply = false) =>
    sdkAction<ThemeResult>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/sdk-themes.mjs`,
      args: { theme, instance, reapply },
    });
  const styled = async (name: string) => {
    await expect
      .poll(async () => {
        const state = await sdkAction<DesktopSnapshot>(page, "snapshot");
        const theme = state.extensionUI.theme;
        const actual = await page.evaluate(() => ({
          accent: getComputedStyle(document.documentElement)
            .getPropertyValue("--pi-accent")
            .trim(),
          appearance: document.documentElement.dataset.theme,
        }));
        return (
          theme?.name === name &&
          actual.accent === theme.colors.accent &&
          actual.appearance === theme.appearance
        );
      })
      .toBe(true);
  };
  try {
    const catalog = await probe();
    expect(catalog.themes[0].name).toBe("system");
    expect(catalog.themes.map((theme) => theme.name)).toEqual(
      expect.arrayContaining(["system", "light", "dark"]),
    );
    const dark = await probe("dark");
    expect(dark.result?.success).toBe(true);
    expect(dark.saved).toBe("dark");
    expect(dark.nativeHeading).toBe(dark.heading);
    await styled("dark");
    await page.screenshot({
      path: screenshot.replace(".png", "-dark.png"),
      animations: "disabled",
    });
    const light = await probe("light", true);
    expect(light.current).toBe("light");
    expect(light.saved).toBe("dark");
    expect(light.nativeHeading).toBe(light.heading);
    await styled("light");
    const reapplied = await probe(undefined, false, true);
    expect(reapplied.result?.success).toBe(true);
    expect(reapplied.current).toBe("light");
    expect(reapplied.saved).toBe("dark");
    expect(reapplied.nativeHeading).toBe(reapplied.heading);
    await styled("light");
    const missing = await probe("unavailable-theme");
    expect(missing.result?.success).toBe(false);
    expect(missing.current).toBe("system");
    expect(missing.saved).toBe("dark");
    expect(missing.nativeHeading).toBe(missing.heading);
    await styled("system");
    await page.screenshot({ path: screenshot, animations: "disabled" });
  } finally {
    await probe("light");
    await styled("light");
  }
}
