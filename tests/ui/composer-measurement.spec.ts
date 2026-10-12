import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";

test("composer reuses its isolated measurement node and cleans it up with the editor", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  await sdkAction(page, "session.new");
  const mirror = page.locator("[data-composer-measure]");
  await expect(mirror).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).measureNode = document.querySelector(
      "[data-composer-measure]",
    );
    (window as any).measureMutations = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of [...record.addedNodes, ...record.removedNodes])
          if (
            node instanceof HTMLElement &&
            node.hasAttribute("data-composer-measure")
          )
            (window as any).measureMutations++;
    });
    observer.observe(document.body, { childList: true });
    (window as any).measureObserver = observer;
  });
  await editor.pressSequentially(
    "normal typing should not remount the measuring textarea",
  );
  await expect(editor).toHaveValue(
    "normal typing should not remount the measuring textarea",
  );
  expect(
    await page.evaluate(() => ({
      same:
        (window as any).measureNode ===
        document.querySelector("[data-composer-measure]"),
      mutations: (window as any).measureMutations,
    })),
  ).toEqual({ same: true, mutations: 0 });
  await expect(mirror).toHaveCSS("contain", "strict");
  await expect(mirror).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "文件与更改", exact: true }).click();
  await expect(mirror).toHaveCount(0);
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(mirror).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).measureNode !==
        document.querySelector("[data-composer-measure]"),
    ),
  ).toBe(true);
  await page.evaluate(() => (window as any).measureObserver.disconnect());
});

test("composer height follows wrapping, resizing and font changes without moving the caret", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  await sdkAction(page, "session.new");
  const text = "Wrapping and 中文🙂 text with spaces ".repeat(10);
  await editor.fill(text);
  await expect(editor).toHaveValue(text);
  const height = () =>
    editor.evaluate((node) => node.getBoundingClientRect().height);
  const wide = await height();
  await page.setViewportSize({ width: 760, height: 940 });
  await expect.poll(height).toBeGreaterThan(wide);
  await editor.focus();
  await editor.evaluate((node: HTMLTextAreaElement) =>
    node.setSelectionRange(12, 12),
  );
  await page.evaluate(() =>
    document.documentElement.style.setProperty(
      "--app-font-sans",
      '"Courier New"',
    ),
  );
  await expect
    .poll(() =>
      page
        .locator("[data-composer-measure]")
        .evaluate((node) => getComputedStyle(node).fontFamily),
    )
    .toContain("Courier New");
  expect(
    await editor.evaluate((node: HTMLTextAreaElement) => node.selectionStart),
  ).toBe(12);
  await editor.fill("short");
  await expect.poll(height).toBe(96);
});
