import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const width of [1440, 760]) {
  test(`queued messages can run now without resending or changing the draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await expect(editor).toBeVisible();
    await sdkAction(page, "session.new");
    try {
      await sdkAction(page, "prompt", { message: "application-status-gate" });
      for (const message of ["立即处理这条补充", "这条继续排队"])
        await sdkAction(page, "prompt", { message, mode: "followUp" });
      await editor.fill("保留正在编辑的草稿");
      const card = page.locator(".queue-item").filter({ hasText: "立即处理这条补充" });
      const button = card.getByRole("button", { name: "立即执行", exact: true });
      await expect(button).toBeInViewport();
      await button.click();
      await expect.poll(async () => {
        const { queue } = await sdkAction<DesktopSnapshot>(page, "snapshot");
        return { steering: queue.steering, followUp: queue.followUp };
      }).toEqual({ steering: ["立即处理这条补充"], followUp: ["这条继续排队"] });
      await expect(card).toContainText("调整方向");
      await expect(card.getByRole("button", { name: "立即执行", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "立即执行", exact: true })).toHaveCount(1);
      await expect(editor).toHaveValue("保留正在编辑的草稿");
      expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).running).toBe(true);
    } finally { await sdkAction(page, "abort"); }
  });
}
