import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
export const startupPolicyModes = [
  "version",
  "packages",
  "crash",
  "subscription",
  "bug",
] as const;
export async function verifyStartupPolicy(
  page: Page,
  mode: (typeof startupPolicyModes)[number],
  screenshot: string,
) {
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .waitFor({ state: "visible", timeout: 30000 });
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action: string) =>
    sdkAction<{
      same: boolean;
      classes: string[];
      rows: number;
      result: unknown;
    }>(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/startup-policy-probe.mjs`,
      args: { action, mode },
    });
  const seeded = await probe("seed");
  try {
    expect(seeded.same).toBe(true);
    expect(seeded.rows).toBeGreaterThan(0);
    const surface = page.locator('[data-surface-id="widget:startup-policy"]');
    if (mode === "version") {
      expect(seeded.classes).toContain("Markdown");
      await expect(surface).toContainText("Update Available");
      await expect(surface).toContainText("Native policy release");
      await expect(
        surface.locator('a[href="https://pi.dev/changelog"]').first(),
      ).toBeVisible();
    } else if (mode === "packages") {
      await expect(surface).toContainText("Package Updates Available");
      await expect(surface).toContainText("npm:original-desktop-package");
    } else if (mode === "crash") {
      await expect(surface).toContainText("Native desktop crash fixture");
      await expect(surface).toContainText(
        "crash details are attached automatically",
      );
    } else if (mode === "subscription") {
      expect(seeded.result).toBe(true);
      await expect(surface).toContainText("extra usage");
    } else await expect(surface).toContainText("/bug sends a report");
    expect(await surface.locator(".xterm,canvas").count()).toBe(0);
    const collapse = page.getByRole("button", {
      name: "收起终端",
      exact: true,
    });
    if (await collapse.isVisible()) await collapse.click();
    await page.screenshot({ path: screenshot });
  } finally {
    await probe("clear");
  }
}
