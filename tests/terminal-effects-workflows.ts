import { cp } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { DesktopSnapshot } from "../shared/types.ts";
import { sdkAction } from "./editor-workflows.ts";

export async function verifyTerminalEffects(page: Page, screenshot?: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(initial.agentDir, "desktop", "terminal-effects.mjs");
  await cp(new URL("./fixtures/terminal-effects.mjs", import.meta.url), path);
  await cp(
    new URL("./fixtures/terminal-effects-extension.mjs", import.meta.url),
    join(initial.agentDir, "extensions", "terminal-effects.ts"),
  );
  await sdkAction(page, "resources.reload");
  const run = (mode: string) =>
    sdkAction<{
      writes: { length: number; text?: string }[];
      inputs: string[];
    }>(page, "sdk.run", { path, args: { mode } });
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  try {
    await run("setup");
    await run("raw-start");
    const panel = page.getByRole("region", { name: "Pi 终端" });
    await page.getByRole("button", { name: "终端", exact: true }).click();
    await panel.getByRole("button", { name: "Pi 扩展", exact: true }).click();
    await expect(page).toHaveTitle("Standalone terminal title");
    await expect
      .poll(async () => (await snapshot()).extensionUI.windowProgress)
      .toBe(true);
    await panel
      .locator('[data-terminal-source="pi"] .xterm-helper-textarea')
      .press("t");
    await expect.poll(async () => (await run("inspect")).inputs).toContain("t");
    await run("raw-stop");
    await expect(page).toHaveTitle("Standalone OSC 2 title");
    await expect
      .poll(async () => (await snapshot()).extensionUI.windowProgress)
      .toBe(false);
    await run("copy");
    const copied = "OSC clipboard \u4e2d\u6587 \ud83d\ude00";
    const expected = [
      { length: copied.length, text: copied },
      { length: 0, text: "" },
      { length: 75000 },
    ];
    await expect
      .poll(async () => (await run("inspect")).writes)
      .toEqual(expected);
    if (screenshot) await page.screenshot({ path: screenshot });
    await page.reload();
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await expect
      .poll(async () => (await run("inspect")).writes)
      .toEqual(expected);
    await page.getByRole("button", { name: "终端", exact: true }).click();
    await panel.getByRole("button", { name: "Pi 扩展", exact: true }).click();
    const blocked = run("blocked-child");
    await expect
      .poll(async () => {
        const output = await sdkAction<{ chunks: { data: string }[] }>(
          page,
          "terminal.snapshot",
        );
        return output.chunks.map((chunk) => chunk.data).join("");
      })
      .toContain("BLOCKED_TERMINAL_READY");
    await panel
      .locator('[data-terminal-source="pi"] .xterm-helper-textarea')
      .press("q");
    await blocked;
    expected.push({ length: 18, text: "blocked child copy" });
    await expect(page).toHaveTitle("Blocked child title");
    await expect
      .poll(async () => (await run("inspect")).writes)
      .toEqual(expected);
    await expect
      .poll(async () => (await snapshot()).extensionUI.windowProgress)
      .toBe(false);
    await run("owner");
    await expect
      .poll(async () => (await snapshot()).extensionUI.windowProgress)
      .toBe(true);
    await sdkAction(page, "prompt", { message: "/terminal-effect-component" });
    const fallback = page.getByLabel("扩展终端组件");
    await expect(fallback).toBeVisible();
    await expect(page).toHaveTitle("Component terminal title");
    await expect.poll(async () => (await run("inspect")).writes.length).toBe(5);
    await page.reload();
    await expect(fallback).toBeVisible();
    await expect(page).toHaveTitle("Component terminal title");
    await expect.poll(async () => (await run("inspect")).writes.length).toBe(5);
    await fallback.locator(".xterm-helper-textarea").press("x");
    await fallback.locator(".xterm-helper-textarea").press("Enter");
    await expect(fallback).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await snapshot()).statuses["terminal-effect-component-result"],
      )
      .toBe("submitted");
    expect((await snapshot()).extensionUI.windowProgress).toBe(true);
    expect((await run("inspect")).writes).toEqual([
      ...expected,
      { length: 14, text: "component copy" },
    ]);
    await run("owner-clear");
    expect((await snapshot()).extensionUI.windowProgress).toBe(true);
    await run("progress-clear");
    await expect
      .poll(async () => (await snapshot()).extensionUI.windowProgress)
      .toBe(false);
  } finally {
    await run("cleanup");
  }
}
