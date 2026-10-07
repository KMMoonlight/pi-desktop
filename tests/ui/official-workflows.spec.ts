import { test, expect } from "@playwright/test";

test("official workflows use desktop controls, preserve extraction and expand status messages", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [
    { width: 1440, height: 940 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    const send = page.getByRole("button", { name: "发送消息", exact: true });
    await expect(composer).toBeVisible();
    if (viewport.width < 800)
      await page
        .getByRole("button", { name: "打开侧边栏", exact: true })
        .click();
    const replaced = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/action") &&
        response.request().postDataJSON()?.action === "session.new",
    );
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    expect((await (await replaced).json()).error).toBeUndefined();
    if (viewport.width < 800)
      await page
        .getByRole("button", { name: "收起侧边栏", exact: true })
        .click();
    const prompt = async (text: string) => {
      await composer.fill(text);
      await send.click();
      await expect(
        page.getByRole("button", { name: "停止任务", exact: true }),
      ).toBeHidden();
    };

    await prompt("official-todo-add first");
    await expect(
      page.getByText("Added todo #1: First task", { exact: true }),
    ).toBeVisible();
    await prompt("official-todo-toggle");
    await expect(
      page.getByText("Todo #1 completed", { exact: true }),
    ).toBeVisible();
    await composer.fill("/todos");
    await send.click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Todos", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("cell", { name: "First task", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("cell", { name: "Completed", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `.local/screenshots/official-todos-${viewport.width}.png`,
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Close", exact: true })
      .press("Control+c");
    await expect(dialog).toBeHidden();

    await composer.fill("/qna");
    await send.click();
    await expect(
      dialog.getByRole("progressbar", {
        name: "Extracting questions using desktop-test",
      }),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(composer).toHaveValue(
      "Q: Which desktop controls should be used?\nA: ",
    );
    await composer.fill("/qna");
    await send.click();
    await expect(
      dialog.getByRole("heading", { name: "Q&A", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(composer).toHaveValue("");

    await prompt("/status warn Provider is busy");
    await expect(
      page.getByText("[WARN] Provider is busy", { exact: true }),
    ).toBeVisible();
    const openInspector = page.getByRole("button", {
      name: "打开检查器",
      exact: true,
    });
    if (await openInspector.isVisible()) await openInspector.click();
    const expansion = page.locator('input[name="expand-tools"]');
    await expansion.press("Space");
    await expect(expansion).toBeChecked();
    await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
    await expect(
      page.getByText(/\[WARN\] Provider is busy\s+at /),
    ).toBeVisible();
    await page.screenshot({
      path: `.local/screenshots/official-workflows-${viewport.width}.png`,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "打开检查器", exact: true }).click();
    await expansion.press("Space");
    await expect(expansion).not.toBeChecked();
    await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
  }
  expect(errors).toEqual([]);
});
