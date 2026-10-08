import { test, expect } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows";
import type { DesktopSnapshot } from "../../shared/types";

for (const width of [1440, 390]) {
  test(`completion floats above the composer and truncates long skill descriptions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.waitFor();
    await sdkAction(page, "session.new");
    const { agentDir } = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const skillDir = join(agentDir, "skills", "visual-style-check");
    const description =
      "飞书云文档内容操作：读取、创建、编辑文档，插入或下载图片附件，以及操作思维笔记。".repeat(
        8,
      );
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: visual-style-check\ndescription: ${description}\n---\n\nPreview fixture.\n`,
    );
    try {
      await sdkAction(page, "resources.reload");
      await editor.fill("/");
      const list = page.locator(".desktop-completion");
      await expect(list).toBeVisible();
      await page.setViewportSize({ width, height: 600 });
      await expect
        .poll(async () => {
          const menu = (await page
            .locator(".desktop-completion-popover")
            .boundingBox())!;
          const chat = (await page.locator(".chat-view").boundingBox())!;
          return menu.y - chat.y;
        })
        .toBeGreaterThanOrEqual(8);
      for (let index = 0; index < 8; index++) await editor.press("ArrowDown");
      await expect(list.locator('[aria-selected="true"]')).toBeInViewport();
      await page.screenshot({
        path: `.local/screenshots/command-completion-${width}.png`,
      });
      await editor.press("Escape");
      await expect(list).toHaveCount(0);
      await page.setViewportSize({ width, height: 940 });
      await editor.fill("draft");
      const initialHeight = (await page.locator(".composer").boundingBox())!
        .height;
      await editor.fill("/skill:visual-style");
      const option = list.getByRole("option", { name: /visual-style-check/ });
      await expect(option).toBeVisible();
      await expect(option.locator("strong")).toHaveText("visual-style-check");
      await expect(option).not.toHaveAttribute("title");
      const box = (await page
        .locator(".desktop-completion-popover")
        .boundingBox())!;
      const composer = (await page.locator(".composer").boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(composer.y);
      expect(Math.abs(composer.height - initialHeight)).toBeLessThanOrEqual(1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const caption = option.locator(".completion-description");
      expect(
        await caption.evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(true);
      await expect(caption).toHaveCSS("white-space", "nowrap");
      await page.screenshot({
        path: `.local/screenshots/skill-completion-${width}.png`,
      });
      await sdkAction(page, "theme.set", { theme: "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.screenshot({
        path: `.local/screenshots/skill-completion-dark-${width}.png`,
      });
      await option.click();
      await expect(editor).toHaveValue("/skill:visual-style-check ");
      await expect(list).toHaveCount(0);
    } finally {
      await sdkAction(page, "theme.set", { theme: "light" });
      await rm(skillDir, { recursive: true, force: true });
      await sdkAction(page, "resources.reload");
      await editor.fill("");
    }
  });
}

test("provider actions keep centered text and icons in expanded settings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "设置", exact: true });
  await modal.getByRole("button", { name: "模型与账号", exact: true }).click();
  await modal.getByRole("button", { name: "添加提供商", exact: true }).click();
  const provider = modal
    .locator(".provider-row")
    .filter({ hasText: "DeepSeek" });
  await provider.getByRole("button", { name: "连接", exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 940 });
    await provider.scrollIntoViewIfNeeded();
    const actions = provider.getByRole("button");
    for (const button of await actions.all()) {
      await expect(button).toHaveCSS("height", "36px");
      const alignment = await button.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return [...node.querySelectorAll("span, svg")]
          .filter(
            (child) =>
              child.tagName.toLowerCase() === "svg" ||
              (child.childNodes.length === 1 &&
                child.firstChild?.nodeType === Node.TEXT_NODE),
          )
          .map((child) => {
            const rect = child.getBoundingClientRect();
            return Math.abs(
              rect.y + rect.height / 2 - (box.y + box.height / 2),
            );
          });
      });
      expect(Math.max(...alignment)).toBeLessThanOrEqual(1);
    }
    await expect(
      provider.getByRole("button", { name: "API Key", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: `.local/screenshots/provider-actions-${width}.png`,
    });
  }
});
