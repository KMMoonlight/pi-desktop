import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import { verifyWorkingIndicator } from "../message-presentation-workflows.ts";

for (const width of [1440, 390]) {
  test(`working indicator frames and message retain Pi styles at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyWorkingIndicator(page);
  });
}

test("default working indicator assembles the Pi mark and respects reduced motion", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  try {
    await sdkAction(page, "prompt", { message: "application-status-gate" });
    const logo = page.locator(".run-indicator .pi-loading");
    await expect(logo).toBeVisible();
    await expect(logo.locator("path")).toHaveCount(3);
    await mkdir(".local/pi-loading", { recursive: true });
    const frames: string[] = [];
    for (const time of [240, 720, 1200, 1800]) {
      frames.push(await logo.evaluate((node, time) => {
        for (const animation of node.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = time; }
        return [...node.querySelectorAll("path")].map(path => getComputedStyle(path).transform).join(";");
      }, time));
      await page.locator(".run-indicator").screenshot({ path: `.local/pi-loading/frame-${time}.png` });
    }
    expect(new Set(frames).size).toBe(4);
    await sdkAction(page, "theme.set", { theme: "dark" });
    await page.locator(".run-indicator").screenshot({ path: ".local/pi-loading/dark.png" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const part of await logo.locator("path").all()) {
      await expect(part).toHaveCSS("animation-name", "none");
      await expect(part).toHaveCSS("opacity", "1");
    }
    await sdkAction(page, "abort");
    await expect(logo).toHaveCount(0);
  } finally {
    await sdkAction(page, "abort");
    await sdkAction(page, "theme.set", { theme: "light" });
  }
});
