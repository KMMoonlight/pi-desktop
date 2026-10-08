import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";

test.beforeEach(async ({ page }) => {
  await mkdir(".local/title-image-presentation", { recursive: true });
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
});

test("small rename icon appears on title hover or keyboard focus without moving the title", async ({ page }) => {
  const title = page.locator(".header-title h1");
  const rename = page.getByRole("button", { name: "重命名会话", exact: true });
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.focus();
  await page.mouse.move(700, 300);
  await expect(rename).toHaveCSS("opacity", "0");
  const before = await title.boundingBox();
  await title.hover();
  await expect(rename).toHaveCSS("opacity", "1");
  expect((await rename.locator("svg").boundingBox())!.width).toBe(14);
  expect(await title.boundingBox()).toEqual(before);
  await page.screenshot({ path: ".local/title-image-presentation/title-hover.png" });
  await rename.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("图片预览调整");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(title).toHaveText("图片预览调整");
  await page.mouse.move(700, 300);
  await editor.focus();
  await expect(rename).toHaveCSS("opacity", "0");
  await title.focus();
  await expect(rename).toHaveCSS("opacity", "1");
  await page.keyboard.press("Tab");
  await expect(rename).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await editor.focus();
  await expect(rename).toHaveCSS("opacity", "0");
});

test("pasted image chips omit names and previews fit natural image dimensions and window bounds", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  for (const viewport of [{ width: 1440, height: 940 }, { width: 800, height: 600 }]) {
    await page.setViewportSize(viewport);
    const theme = viewport.width === 1440 ? "light" : "dark";
    await sdkAction(page, "theme.set", { theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const dimensions of [{ width: 320, height: 180 }, { width: 2400, height: 1000 }, { width: 600, height: 1800 }]) {
      const name = `pasted-${dimensions.width}x${dimensions.height}.png`;
      await editor.evaluate(async (node, { dimensions, name }) => {
        const canvas = document.createElement("canvas");
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#ede8df";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#cc785c";
        context.fillRect(canvas.width / 4, canvas.height / 4, canvas.width / 2, canvas.height / 2);
        const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
        const clipboard = new DataTransfer();
        clipboard.items.add(new File([blob], name, { type: "image/png" }));
        node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
      }, { dimensions, name });
      const thumbnail = page.getByRole("button", { name: `放大查看 ${name}`, exact: true });
      await expect(thumbnail).toBeVisible();
      await expect(page.locator(".attachment-list")).toHaveText("");
      await thumbnail.click();
      const preview = page.getByRole("dialog", { name: "图片预览", exact: true });
      const image = preview.getByRole("img");
      await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(dimensions.width);
      const scale = Math.min(1, (viewport.width - 48) / dimensions.width, (viewport.height - 48) / dimensions.height);
      const box = (await image.boundingBox())!;
      const container = (await preview.boundingBox())!;
      expect(Math.abs(box.width - dimensions.width * scale)).toBeLessThan(1);
      expect(Math.abs(box.height - dimensions.height * scale)).toBeLessThan(1);
      expect(Math.abs(container.width - box.width)).toBeLessThan(1);
      expect(Math.abs(container.height - box.height)).toBeLessThan(1);
      await expect(image).toBeInViewport({ ratio: 1 });
      await expect(preview.locator("header")).toHaveCount(0);
      await expect(preview).toHaveText("");
      const close = preview.getByRole("button", { name: "关闭图片预览", exact: true });
      await expect(close).toBeFocused();
      await expect(close).not.toHaveAttribute("aria-describedby");
      await expect(close).not.toHaveAttribute("title");
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      const closeBox = (await close.boundingBox())!;
      expect(Math.abs(closeBox.y - box.y - 8)).toBeLessThan(1);
      expect(Math.abs(box.x + box.width - closeBox.x - closeBox.width - 8)).toBeLessThan(1);
      await close.hover();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await page.screenshot({ path: `.local/title-image-presentation/preview-${dimensions.width}-${theme}.png` });
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(thumbnail).toBeFocused();
      await page.getByRole("button", { name: `移除 ${name}`, exact: true }).click();
      await expect(thumbnail).toHaveCount(0);
    }
  }
});
