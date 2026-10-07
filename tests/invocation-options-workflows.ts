import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
export const invocationModes = [
  "layout-theme",
  "terminal",
  "implicit-trust",
] as const;
interface Probe {
  mode: string;
  theme: string;
  same: boolean;
  setting: string | null;
  trusted: boolean | null;
  input: string;
  starts: number;
  stops: number;
  titleSame: boolean;
  writeSame: boolean;
  titleMethodSame: boolean;
  colors: { foreground?: { r: number; g: number; b: number } };
  schemes: string[];
}
export async function verifyInvocationOptions(
  page: Page,
  mode: (typeof invocationModes)[number],
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action = "inspect") =>
    sdkAction<Probe>(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/invocation-options-probe.mjs`,
      args: { action, mode },
    });
  await page.emulateMedia({ colorScheme: "light" });
  const initial = await probe("seed");
  try {
    expect(initial.mode).toBe("regular");
    expect(initial.theme).toBe("light");
    expect(initial.trusted).toBe(null);
    if (mode === "layout-theme") {
      await page.emulateMedia({ colorScheme: "dark" });
      await expect.poll(async () => (await probe()).theme).toBe("dark");
      expect((await probe("reload")).theme).toBe("dark");
      expect((await probe("new")).theme).toBe("dark");
      expect((await probe()).setting).toBe(initial.setting);
      expect((await probe("switch")).mode).toBe("fullscreen");
      const reloaded = await probe("reload");
      expect(reloaded.mode).toBe("fullscreen");
      expect(reloaded.same).toBe(true);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe("dark");
    } else if (mode === "terminal") {
      expect(initial.starts).toBe(1);
      const direct = await probe("direct");
      expect(
        direct.titleSame && direct.writeSame && direct.titleMethodSame,
      ).toBe(true);
      expect(direct.colors.foreground).toEqual({ r: 255, g: 0, b: 0 });
      expect(direct.schemes).toEqual(["dark"]);
      await probe("input");
      await expect(
        page.getByRole("textbox", { name: "消息", exact: true }),
      ).toHaveValue("x");
      expect((await probe("reload")).starts).toBe(1);
      expect((await probe("switch")).starts).toBe(2);
      expect((await probe()).stops).toBe(1);
    } else {
      expect((await probe("reload")).trusted).toBe(null);
      await probe("resources");
      expect((await probe("reload")).trusted).toBe(true);
      expect((await probe("new")).trusted).toBe(true);
    }
    const surface = page.locator(
      '[data-surface-id="widget:invocation-options"]',
    );
    const collapseTerminal = page.getByRole("button", {
      name: "收起终端",
      exact: true,
    });
    if (await collapseTerminal.isVisible()) await collapseTerminal.click();
    await expect(surface).toContainText("Invocation layout:");
    expect(await surface.locator(".xterm,canvas").count()).toBe(0);
    await page.screenshot({ path: screenshot, animations: "disabled" });
  } finally {
    const cleanup = await probe("cleanup");
    if (mode === "terminal") expect(cleanup.stops).toBe(2);
  }
}
