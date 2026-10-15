import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
});

test("empty composer caret follows focus and composition without editing the draft", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  const caret = page.locator(".composer-empty-caret");
  await editor.focus();
  await expect(caret).toBeVisible();
  await expect(editor).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await expect(caret).toHaveAttribute("aria-hidden", "true");
  await expect(caret).toHaveCSS("pointer-events", "none");
  await editor.evaluate((node) => {
    (window as any).originalComposer = node;
  });

  await editor.pressSequentially("a");
  await expect(editor).toHaveValue("a");
  await expect(caret).toBeHidden();
  await expect(editor).not.toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await editor.press("Backspace");
  await expect(editor).toHaveValue("");
  await expect(caret).toBeVisible();

  await editor.dispatchEvent("compositionstart", { data: "" });
  await expect(caret).toBeHidden();
  await expect(editor).not.toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await editor.dispatchEvent("compositionend", { data: "" });
  await expect(caret).toBeVisible();
  await expect(editor).toHaveValue("");

  // Headless pages stay focused when bringing a second tab to the front.
  // Exercise the window activation events delivered by the desktop WebView.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(caret).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(caret).toBeVisible();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(caret).toBeHidden();
  await page.keyboard.press("Escape");
  await editor.focus();
  await expect(caret).toBeVisible();
  expect(
    await editor.evaluate((node) => node === (window as any).originalComposer),
  ).toBe(true);
  expect(
    await editor.evaluate((node: HTMLTextAreaElement) => [
      node.selectionStart,
      node.selectionEnd,
    ]),
  ).toEqual([0, 0]);
});

test("empty caret stays in the first text line through layout, font and theme changes", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  const caret = page.locator(".composer-empty-caret");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await editor.focus();
  for (const size of [
    { width: 1440, height: 940 },
    { width: 1920, height: 1080 },
    { width: 1440, height: 700 },
    { width: 760, height: 580 },
  ]) {
    await page.setViewportSize(size);
    for (const font of ['"PingFang SC"', '"Courier New"', "Inter"]) {
      await page.evaluate(
        (font) =>
          document.documentElement.style.setProperty("--app-font-sans", font),
        font,
      );
      await expect(caret).toBeVisible();
      const metrics = await editor.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const css = getComputedStyle(node);
        const caret = node.parentElement!.querySelector(
          ".composer-empty-caret",
        )!;
        const caretBox = caret.getBoundingClientRect();
        return {
          x: caretBox.left - box.left,
          expectedX: parseFloat(css.paddingLeft),
          center: (caretBox.top + caretBox.bottom) / 2 - box.top,
          expectedCenter:
            parseFloat(css.paddingTop) + parseFloat(css.lineHeight) / 2,
          font: getComputedStyle(caret).fontFamily,
          expectedFont: css.fontFamily,
        };
      });
      expect(Math.abs(metrics.x - metrics.expectedX)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(metrics.center - metrics.expectedCenter),
      ).toBeLessThanOrEqual(1);
      expect(metrics.font).toBe(metrics.expectedFont);
      await expect(editor).toHaveValue("");
      await expect(editor).toBeFocused();
    }
  }
  for (const theme of ["dark", "light"]) {
    await sdkAction(page, "theme.set", { theme });
    await expect(caret).toBeVisible();
    expect(
      await caret.evaluate(
        (node) => getComputedStyle(node).borderInlineStartColor,
      ),
    ).toBe(await editor.evaluate((node) => getComputedStyle(node).color));
  }
  await editor.fill("第一行\n第二行");
  await editor.evaluate((node: HTMLTextAreaElement) =>
    node.setSelectionRange(1, 4, "backward"),
  );
  await page.setViewportSize({ width: 1440, height: 940 });
  await expect(caret).toBeHidden();
  expect(
    await editor.evaluate((node: HTMLTextAreaElement) => [
      node.selectionStart,
      node.selectionEnd,
    ]),
  ).toEqual([1, 4]);
});
