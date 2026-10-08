import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows";
import type { DesktopSnapshot } from "../../shared/types";

for (const width of [1440, 390]) {
  test(`session branches draw connected lanes and retain navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "session.new");
    const prompt = async (message: string) => {
      await sdkAction(page, "prompt", { message });
      await expect
        .poll(
          async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
        )
        .toBe(false);
      return sdkAction<DesktopSnapshot>(page, "snapshot");
    };
    const start = await prompt("shared tree root");
    const first = await prompt("first branch question");
    await sdkAction(page, "session.navigate", {
      id: start.leafId,
      summarize: false,
    });
    const second = await prompt("second branch question");
    await page
      .getByRole("navigation", { name: "会话视图" })
      .getByRole("button", { name: "会话树", exact: true })
      .click();
    const tree = page.getByRole("tree", { name: "会话分支" });
    const row = (id: string) => tree.locator(`.tree-row[data-node-id="${id}"]`);
    await expect(tree.getByRole("treeitem")).toHaveCount(second.tree.length);
    await expect(row(start.leafId!)).toHaveAttribute("data-lane", "0");
    await expect(row(first.leafId!)).toHaveAttribute("data-lane", "1");
    await expect(row(second.leafId!)).toHaveAttribute("data-lane", "1");
    await expect(row(second.leafId!)).toHaveAttribute("aria-current", "true");
    await expect(row(second.leafId!)).toContainText("当前位置");
    await expect(
      tree.locator(`path[data-node-id="${first.leafId}"]`),
    ).not.toHaveClass(/is-active/);
    await expect(
      tree.locator(`path[data-node-id="${second.leafId}"]`),
    ).toHaveClass(/is-active/);
    const paths = await tree
      .locator("path")
      .evaluateAll((paths) => paths.map((path) => path.getAttribute("d")!));
    expect(paths.some((path) => path.includes("Q"))).toBe(true);
    expect(paths.some((path) => !path.includes("Q"))).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/screenshots/session-tree-${width}.png`,
    });
    await sdkAction(page, "theme.set", { theme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({
      path: `.local/screenshots/session-tree-dark-${width}.png`,
    });
    await sdkAction(page, "theme.set", { theme: "light" });
    await row(start.leafId!).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(tree.getByRole("treeitem")).toHaveCount(start.tree.length);
    await page.keyboard.press("ArrowRight");
    await expect(tree.getByRole("treeitem")).toHaveCount(second.tree.length);
    await page.keyboard.press("ArrowRight");
    await expect(row(start.leafId!)).not.toBeFocused();
    await page
      .getByRole("textbox", { name: "搜索会话树" })
      .fill("second branch question");
    await expect(tree).toContainText("shared tree root");
    await expect(tree).toContainText("second branch question");
    await expect(tree).not.toContainText("first branch question");
    await page.getByRole("textbox", { name: "搜索会话树" }).fill("");
    // Navigation still calls the real SDK and moves the current location.
    const summary = page.locator('input[name="branch-summary"]');
    await page.locator("label").filter({ has: summary }).click();
    await expect(summary).not.toBeChecked();
    await row(first.leafId!).locator(".tree-content").click();
    await expect
      .poll(
        async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).leafId,
      )
      .toBe(first.leafId);
    await expect(row(first.leafId!)).toHaveAttribute("aria-current", "true");
  });
}
