import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const width of [1440, 390]) {
  test(`streaming thinking stays on one line until manually expanded at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.waitFor();
    const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
    await sdkAction(page, "session.new");
    // The SDK's expand-thinking setting must not automatically open live thoughts.
    await sdkAction(page, "display.thinking", { visible: true });
    const thinking = page.locator(".assistant-reply .thinking-block:visible");
    const sourceLength = async () => {
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      return snapshot.streaming?.content.find(block => block.type === "thinking")?.thinking?.length ?? 0;
    };
    try {
      await sdkAction(page, "prompt", { message: "thinking-line-probe" });
      await expect(thinking).toHaveCount(1);
      await expect(thinking).not.toHaveAttribute("open", "", { timeout: 2000 });
      for (const theme of ["light", "dark"]) {
        await sdkAction(page, "theme.set", { theme });
        const summary = thinking.locator(":scope > summary");
        await expect(summary).toHaveText("思考过程");
        await expect(thinking.locator(".transcript-markdown-body")).toHaveCount(0);
        const box = (await thinking.boundingBox())!;
        expect(box.height).toBeLessThanOrEqual(28);
        expect(box.width).toBeLessThanOrEqual(width);
        await mkdir(".local/thinking-line", { recursive: true });
        await page.screenshot({ path: `.local/thinking-line/${width}-${theme}.png` });

        await summary.click();
        await expect(thinking).toHaveAttribute("open", "");
        await expect(thinking.getByText("第一段思考内容。", { exact: true })).toBeVisible();
        const expandedLength = await sourceLength();
        await expect.poll(sourceLength).toBeGreaterThan(expandedLength);
        await editor.fill("流式更新与输入快照不改变手动展开状态");
        await expect(thinking).toHaveAttribute("open", "");

        await summary.click();
        await expect(thinking).not.toHaveAttribute("open");
        const collapsedLength = await sourceLength();
        await expect.poll(sourceLength).toBeGreaterThan(collapsedLength);
        await expect(thinking).not.toHaveAttribute("open");
        await expect(thinking.locator(".transcript-markdown-body")).toHaveCount(0);
        expect((await thinking.boundingBox())!.height).toBeLessThanOrEqual(28);
      }
      await sdkAction(page, "abort");
      await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
      await expect(thinking).not.toHaveAttribute("open");
      await page.reload();
      await editor.waitFor();
      await expect(thinking).not.toHaveAttribute("open");
    } finally {
      await sdkAction(page, "abort");
      await sdkAction(page, "display.thinking", { visible: initial.settings.hideThinkingBlock !== true });
      await sdkAction(page, "theme.set", { theme: initial.extensionUI.theme?.name ?? "light" });
    }
  });
}
