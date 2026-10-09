import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";

test("a delayed arrow-key reply cannot replace a newer pointer caret", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await editor.fill("abcdef");
  await editor.press("End");
  let release!: () => void;
  let arrived!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let delayed = false;
  await page.route("**/api/action", async (route) => {
    const request = route.request().postDataJSON();
    if (
      !delayed &&
      request.action === "desktop.input" &&
      request.args.event?.key === "ArrowLeft"
    ) {
      delayed = true;
      const response = await route.fetch();
      arrived();
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await editor.press("ArrowLeft");
    await ready;
    // Reproduce a native click before its queued SDK pointer transaction runs.
    await editor.dispatchEvent("pointerdown", { pointerId: 99, button: 0 });
    await editor.evaluate((node) => {
      (node as HTMLTextAreaElement).setSelectionRange(1, 1);
    });
    release();
    await expect
      .poll(() => editor.evaluate((node) => node.dataset.piInputPending ?? ""))
      .toBe("");
    await page.waitForTimeout(150);
    expect(
      await editor.evaluate(
        (node) => (node as HTMLTextAreaElement).selectionStart,
      ),
    ).toBe(1);
    await expect(editor).toHaveValue("abcdef");
  } finally {
    release();
  }
});
