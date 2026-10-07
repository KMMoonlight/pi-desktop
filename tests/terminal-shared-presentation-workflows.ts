import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const terminalStateModes = ["native", "terminal"] as const;
export async function verifySharedTerminalPresentation(
  page: Page,
  mode: string,
  screenshot: string,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  const command = (message: string) => sdkAction(page, "prompt", { message });
  const action = (name: string) => command(`/terminal-state-action ${name}`);
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async () =>
    JSON.parse((await snapshot()).statuses["terminal-state"]);
  const appearance = (value: string) =>
    sdkAction(page, "desktop.appearance", { appearance: value });
  try {
    await appearance("light");
    await command(`/terminal-state-probe ${mode}`);
    await expect(page.getByText(/^Shared terminal footer: /)).toBeVisible();
    if (mode === "native")
      await expect(
        page.getByText("Shared terminal header", { exact: true }),
      ).toBeVisible();
    else
      await expect(
        page.getByLabel("扩展终端组件", { exact: true }).locator(".xterm-rows"),
      ).toContainText("Shared terminal cursor");
    await action("enable");
    await expect
      .poll(async () => (await state()).footer)
      .toEqual({ cursor: true, shrink: true });
    await expect(
      page.getByText("Shared terminal footer: cursor=true, shrink=true", {
        exact: true,
      }),
    ).toBeVisible();
    await appearance("dark");
    await expect
      .poll(async () => (await state()).events)
      .toEqual(["header:dark", "footer:dark"]);
    await action("silence");
    await appearance("light");
    expect((await state()).events).toEqual(["header:dark", "footer:dark"]);
    await action("listen");
    await appearance("dark");
    await expect
      .poll(async () => (await state()).events)
      .toEqual(["header:dark", "footer:dark", "header:dark", "footer:dark"]);
    await action("progress");
    expect((await snapshot()).extensionUI.windowProgress).toBe(false);
    await page.screenshot({ path: screenshot, fullPage: true });
    await action("retire");
    try {
      await expect(page).toHaveTitle("Retained terminal state");
    } catch (error) {
      const terminal = await sdkAction<{
        chunks: { sequence: number; data: string }[];
      }>(page, "terminal.snapshot");
      console.log(
        "Shared terminal title diagnostic:",
        JSON.stringify({
          windowTitle: (await snapshot()).extensionUI.windowTitle,
          titles: terminal.chunks.filter((chunk) =>
            /\x1b\](?:0|2);/.test(chunk.data),
          ),
        }),
      );
      throw error;
    }
    expect((await snapshot()).extensionUI.windowProgress).toBe(true);
    await expect(
      page.getByText("Shared terminal footer: cursor=false, shrink=false", {
        exact: true,
      }),
    ).toBeVisible();
    await appearance("light");
    await expect
      .poll(async () => (await state()).events.slice(-2))
      .toEqual(["header:light", "footer:light"]);
    await action("query");
    const colors = (await state()).colors;
    expect(colors.foreground).toEqual({ r: 228, g: 231, b: 237 });
    expect(colors.background).toEqual({ r: 19, g: 22, b: 28 });
    expect(colors.palette).toHaveLength(16);
    await command("/terminal-state-cleanup");
    expect((await snapshot()).extensionUI.windowProgress).toBe(false);
    await expect(page.getByText(/^Shared terminal footer: /)).toHaveCount(0);
  } finally {
    await command("/terminal-state-cleanup").catch(() => {});
  }
}
