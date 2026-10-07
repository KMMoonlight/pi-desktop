import { test, expect } from "@playwright/test";

test("official extensions use native questions and questionnaires on desktop and mobile", async ({
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
    const send = page.getByRole("button", { name: "发送消息", exact: true });
    await composer.fill("official-question");
    await send.click();
    const modal = page.getByRole("dialog");
    await expect(
      modal.getByText("Which interface should be used?", { exact: true }),
    ).toBeVisible();
    await modal
      .getByRole("combobox", { name: "Answer", exact: true })
      .selectOption("other");
    await modal
      .getByRole("textbox", { name: "Your answer", exact: true })
      .fill("Native desktop components");
    await modal
      .getByRole("button", { name: "Confirm answer", exact: true })
      .click();
    await expect(modal).toBeHidden();
    await expect(
      page.getByText("User wrote: Native desktop components", { exact: true }),
    ).toBeVisible();

    await composer.fill("official-questionnaire");
    await send.click();
    await expect(
      modal.getByText("Which scope?", { exact: true }),
    ).toBeVisible();
    await expect(
      modal
        .getByRole("combobox", { name: "Answer", exact: true })
        .locator("option"),
    ).toHaveCount(2);
    await modal
      .getByRole("button", { name: "Save answer", exact: true })
      .click();
    await expect(
      modal.getByText("Any additional requirements?", { exact: true }),
    ).toBeVisible();
    await modal
      .getByRole("combobox", { name: "Answer", exact: true })
      .selectOption("other");
    const acknowledged = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/action") &&
        response.request().postDataJSON()?.args?.action === "answer",
    );
    await modal
      .getByRole("textbox", { name: "Your answer", exact: true })
      .fill("Keep extension callbacks");
    await acknowledged;
    await expect(
      modal.getByRole("textbox", { name: "Your answer", exact: true }),
    ).toHaveValue("Keep extension callbacks");
    await page.screenshot({
      path: `.local/screenshots/official-questionnaire-${viewport.width}.png`,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await modal
      .getByRole("button", { name: "Save answer", exact: true })
      .click();
    await expect(
      modal.getByRole("cell", { name: "Desktop app", exact: true }),
    ).toBeVisible();
    await modal
      .getByRole("button", { name: "Submit answers", exact: true })
      .click();
    await expect(modal).toBeHidden();
    await expect(
      page.getByText("Q2: user wrote: Keep extension callbacks", {
        exact: false,
      }),
    ).toBeVisible();

    await composer.fill("official-questionnaire-cancel");
    await send.click();
    await expect(
      modal.getByText("Which scope?", { exact: true }),
    ).toBeVisible();
    await modal
      .getByRole("button", { name: "Save answer", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(
      page.getByText("User cancelled the questionnaire", { exact: true }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});
