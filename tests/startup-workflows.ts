import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot, StartupSnapshot } from "../shared/types.ts";
export const startupModes = [
  "collapsed",
  "expanded",
  "messages",
  "diagnostics",
] as const;
interface Probe {
  same: boolean;
  scopeSame: boolean;
  state: StartupSnapshot;
  classes: string[];
  fullClasses?: string[];
  fullHasPinnedLinks?: boolean;
  userMessages: { text: string; images: number }[];
  rows: number;
}
export async function verifyStartup(
  page: Page,
  mode: (typeof startupModes)[number],
  screenshot: string,
) {
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .waitFor({ state: "visible", timeout: 30000 });
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action = "inspect") =>
    sdkAction<Probe>(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/startup-probe.mjs`,
      args: { action, mode },
    });
  const seeded = await probe("seed");
  try {
    expect(seeded.same && seeded.scopeSame).toBe(true);
    expect(seeded.state.state).toBe("settled");
    if (mode === "messages") {
      expect(seeded.userMessages).toEqual([
        { text: "Native first startup input", images: 1 },
        { text: "Native next startup input", images: 0 },
      ]);
      expect(seeded.state.completed).toBe(2);
      await expect(
        page.locator('.transcript:not([aria-hidden="true"])'),
      ).toContainText("Native next startup input");
      await expect(
        page.getByRole("textbox", { name: "消息", exact: true }),
      ).toHaveValue("");
    } else {
      const surface = page.locator(
        '[data-surface-id="widget:startup-preview"]',
      );
      if (mode === "collapsed") {
        expect(seeded.classes).toEqual([
          "DynamicBorder",
          "Text",
          "DynamicBorder",
        ]);
        await expect(surface).toContainText("Updated to v1.0.0");
        await expect(surface).toContainText("/changelog");
      } else if (mode === "expanded") {
        expect(seeded.classes).toContain("Markdown");
        await expect(surface).toContainText("What's New");
        await expect(surface).toContainText("Fullscreen by default");
        await expect(
          surface.locator('a[href*="/v1.0.0/"]').first(),
        ).toBeVisible();
      } else {
        for (const text of [
          "Native startup information",
          "Warning: Native startup warning",
          "Error: Native startup error",
          "Migrated credentials to auth.json: desktop-test",
          "Native model fallback",
        ])
          await expect(surface).toContainText(text);
      }
      expect(await surface.locator(".xterm,canvas").count()).toBe(0);
    }
    const full = await probe("full");
    expect(full.fullHasPinnedLinks).toBe(true);
    expect(full.fullClasses).toEqual([
      "Spacer",
      "DynamicBorder",
      "ThemedText",
      "Spacer",
      "Markdown",
      "DynamicBorder",
    ]);
    await page.screenshot({ path: screenshot, animations: "disabled" });
    const reloaded = await probe("reload");
    expect(reloaded.same && reloaded.scopeSame).toBe(true);
    expect(reloaded.rows).toBe(0);
    await expect(
      page.locator('[data-surface-id="widget:startup-preview"]'),
    ).toHaveCount(0);
    if (mode === "messages")
      expect(reloaded.userMessages).toEqual(seeded.userMessages);
  } finally {
    await probe("cleanup");
  }
}
