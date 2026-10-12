import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";

test("ordinary typing does not scan or transmit every caret in a long draft", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  await sdkAction(page, "session.new");
  const draft = "A long draft line with several words.\n".repeat(200);
  const identity = await editor.evaluate(node => {
    const surface = node.closest<HTMLElement>("[data-surface-id]")!;
    return { id: surface.dataset.surfaceId, instanceId: surface.dataset.instanceId, action: (node as HTMLElement).dataset.desktopAction! };
  });
  await sdkAction(page, "desktop.action", { ...identity, value: draft });
  await expect(editor).toHaveValue(draft);
  await sdkAction(page, "desktop.action", {
    ...identity, action: `${identity.action}:selection`,
    value: { start: draft.length, end: draft.length, text: draft },
  });
  await editor.focus();
  await expect.poll(() => editor.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(draft.length);
  await page.evaluate(() => {
    const original = Range.prototype.getClientRects;
    (window as any).typingCaretMeasurements = 0;
    Range.prototype.getClientRects = function () {
      if (this.startContainer.textContent?.endsWith("\u200b"))
        (window as any).typingCaretMeasurements++;
      return original.call(this);
    };
  });
  const inputs: any[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/action") || request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (body.action === "desktop.input") inputs.push(body.args);
  });
  await editor.pressSequentially("typing");
  await expect(editor).toHaveValue(draft + "typing");
  await expect.poll(() => inputs.filter(input => input.event?.type === "press").length).toBe(6);
  expect(inputs.every(input => input.editorLayout === undefined)).toBe(true);
  expect(await page.evaluate(() => (window as any).typingCaretMeasurements)).toBe(0);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.imeSetComposition", { text: "nihao", selectionStart: 5, selectionEnd: 5 });
    await cdp.send("Input.insertText", { text: "你好" });
    await expect(editor).toHaveValue(draft + "typing你好");
    await expect.poll(() => inputs.some(input => input.data === "你好")).toBe(true);
    expect(inputs.every(input => input.editorLayout === undefined)).toBe(true);
    expect(await page.evaluate(() => (window as any).typingCaretMeasurements)).toBe(0);
  } finally {
    await cdp.detach();
  }
  // Real cursor navigation must still use the browser's wrapped rows.
  await editor.press("ArrowUp");
  await expect.poll(() => inputs.some(input => input.event?.key === "ArrowUp" && input.editorLayout?.rows.length > 1)).toBe(true);
  await expect.poll(() => editor.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBeLessThan(draft.length);
});
