import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const sharedTuiModes = ["native", "terminal"] as const;
export async function verifySharedTui(
  page: Page,
  mode: string,
  screenshot: string,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  const command = (message: string) => sdkAction(page, "prompt", { message });
  const action = (name: string) => command(`/shared-tui-action ${name}`);
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async () =>
    JSON.parse((await snapshot()).statuses["shared-tui"]);
  try {
    await command(`/shared-tui-probe ${mode}`);
    await expect.poll(async () => (await state()).same).toBe(true);
    expect((await state()).terminalSame).toBe(true);
    const second = page.getByRole("textbox", {
      name: "共享输入 B",
      exact: true,
    });
    await expect(second).toBeVisible();
    await action("transfer");
    const first =
      mode === "native"
        ? page.getByRole("textbox", { name: "共享输入 A", exact: true })
        : page
            .getByLabel("扩展终端组件", { exact: true })
            .locator(".xterm-helper-textarea");
    await first.press("x");
    await expect(second).toHaveValue("y");
    await expect(second).toBeFocused();
    await action("report");
    expect((await state()).first).toBe("");
    expect((await state()).hooks).toBe(2);
    expect((await state()).events).toEqual([
      { key: "x", phase: "press" },
      { key: "x", phase: "release" },
    ]);
    await page.screenshot({
      path: screenshot.replace(/\.png$/, "-transfer.png"),
      fullPage: true,
    });
    await action("register");
    await expect(
      page.getByText("Shared runtime registration", { exact: true }),
    ).toBeVisible();
    await action("stop");
    const before = await snapshot();
    const input = before.desktopSurfaces.find(
      (surface) => surface.slot === "footer",
    )!;
    const blocked = await sdkAction<{ consume: boolean }>(
      page,
      "desktop.input",
      { surfaceId: input.id, data: "z" },
    );
    expect(blocked.consume).toBe(true);
    await action("start");
    expect(
      (await snapshot()).desktopSurfaces.find(
        (surface) => surface.id === input.id,
      )?.instanceId,
    ).toBe(input.instanceId);
    await action("retire");
    await expect(
      page.getByText("Shared runtime registration", { exact: true }),
    ).toBeVisible();
    await action("refresh");
    await expect(
      page.getByText("Updated from retained runtime", { exact: true }),
    ).toBeVisible();
    await action("overlay");
    const overlay = page.getByRole("textbox", {
      name: "共享覆盖层",
      exact: true,
    });
    await expect(overlay).toBeVisible();
    await overlay.pressSequentially("original");
    await expect(overlay).toHaveValue("original");
    await page.screenshot({ path: screenshot, fullPage: true });
    await overlay.press("Enter");
    await expect(overlay).toHaveCount(0);
    await expect
      .poll(async () => (await snapshot()).statuses["shared-tui-result"])
      .toBe("original");
    await command("/shared-tui-cleanup");
    await expect(
      page.getByText("Shared runtime registration", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await command("/shared-tui-cleanup").catch(() => {});
  }
}
