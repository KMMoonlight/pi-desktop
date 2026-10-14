import { test, expect } from "@playwright/test";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const width of [1440, 390])
  test(`Pi 1.2 status, image output and recorded tool duration at ${width}px`, async ({
    page,
  }) => {
    await mkdir(".local/pi-120", { recursive: true });
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.waitFor();
    await sdkAction(page, "session.new");
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const path = join(snapshot.agentDir, "desktop", "pi-120-probe.mjs");
    await cp(new URL("../fixtures/pi-120-probe.mjs", import.meta.url), path);
    const probe = (action: string) =>
      sdkAction(page, "sdk.run", { path, args: { action } });
    try {
      await editor.fill("slow-response");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect(
        page.locator('[data-program-state="working"]'),
      ).toBeVisible();
      await page.getByRole("button", { name: "停止任务", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await sdkAction<DesktopSnapshot>(page, "snapshot")).extensionUI
              .programStatus?.state,
        )
        .toBe("idle");
      await editor.fill("/desktop-dialog");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect(page.locator('[data-program-state="blocked"]')).toHaveText(
        "等待确认",
      );
      await page.screenshot({ path: `.local/pi-120/waiting-${width}.png` });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await expect(page.locator('[data-program-state="blocked"]')).toHaveText(
        "等待输入",
      );
      await page
        .getByRole("textbox", { name: "Extension input", exact: true })
        .fill("Confirmed");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await probe("prepare-image");
      await editor.fill("pi-120-image");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect(page.locator('[data-program-state="done"]')).toBeVisible();
      const current = await sdkAction<DesktopSnapshot>(page, "snapshot");
      expect(current.version).toBe("1.2.0");
      const result = current.messages.find(
        (message) =>
          message.role === "toolResult" && message.toolName === "codemode",
      )!;
      expect(result.isError).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.content.some((block) => block.type === "image")).toBe(true);
      const group = page.locator(".process-group").last();
      await group.locator(":scope > summary").click();
      const tool = page.locator(`[data-tool-call-id="${result.toolCallId}"]`);
      await expect(tool.locator(".tool-duration")).toContainText("用时");
      await tool
        .getByRole("button", { name: "展开 codemode 输出", exact: true })
        .click();
      await expect(tool.locator(".tool-images img")).toBeVisible();
      await expect(tool).toContainText("Took");
      await page.screenshot({
        path: `.local/pi-120/image-duration-${width}.png`,
      });
      await sdkAction(page, "session.new");
      await sdkAction(page, "session.switch", { path: current.sessionFile });
      const restored = await sdkAction<DesktopSnapshot>(page, "snapshot");
      expect(
        restored.messages.find(
          (message) => message.toolCallId === result.toolCallId,
        )?.durationMs,
      ).toBe(result.durationMs);
    } finally {
      await probe("cleanup");
    }
  });
