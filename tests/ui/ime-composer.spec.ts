import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows";

test("IME punctuation with key code 229 inserts a slash once and preserves repeated slashes", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await sdkAction(page, "session.new");
  const sent: { event?: { key: string; type: string }; data?: string }[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/action") || request.method() !== "POST")
      return;
    const body = request.postDataJSON();
    if (body.action === "desktop.input") sent.push(body.args);
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    await composer.focus();
    for (const text of ["/", "//"]) {
      await cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: "/",
        code: "Slash",
        windowsVirtualKeyCode: 229,
      });
      await cdp.send("Input.insertText", { text: "/" });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "/",
        code: "Slash",
        windowsVirtualKeyCode: 229,
      });
      await expect(composer).toHaveValue(text, { timeout: 3000 });
    }
    expect(sent.filter((input) => input.event?.key === "/")).toEqual([]);
    await expect.poll(() => sent.filter((input) => input.data === "/")).toHaveLength(2);
    await composer.fill("");
    await composer.pressSequentially("//");
    await expect(composer).toHaveValue("//");
  } finally {
    await cdp.detach();
  }
});

for (const width of [1440, 760]) {
  test(`composer selects reserve stable space and keep long models within the viewport at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    const model = page.locator('.composer-models [role="combobox"]').first();
    const thinking = page.locator('.composer-models [role="combobox"]').last();
    // Fixed control widths keep model changes from moving neighboring actions.
    await model.locator("span").evaluate((node) => {
      node.textContent = "请选择";
    });
    for (const select of [model, thinking]) {
      const sizes = await select.evaluate((node) => {
        const css = getComputedStyle(node);
        const label = node.querySelector("span")!;
        const range = document.createRange();
        range.selectNodeContents(label);
        return {
          actual: node.getBoundingClientRect().width,
          expected:
            range.getBoundingClientRect().width +
            node.querySelector("svg")!.getBoundingClientRect().width +
            parseFloat(css.columnGap) +
            parseFloat(css.paddingLeft) +
            parseFloat(css.paddingRight),
        };
      });
      expect(sizes.actual).toBeGreaterThanOrEqual(sizes.expected - 2);
    }
    await page.screenshot({
      path: `.local/screenshots/composer-select-width-${width}.png`,
    });
    await model.locator("span").evaluate((node) => {
      node.textContent = "A model with a very long name ".repeat(8);
    });
    await expect(thinking).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
