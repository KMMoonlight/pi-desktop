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
    await expect
      .poll(() => sent.filter((input) => input.data === "/"))
      .toHaveLength(2);
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

test("an unmarked printable key can start native composition without being inserted by the backend", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await sdkAction(page, "session.new");
  const sent: any[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/action") && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.action === "desktop.input") sent.push(body.args);
    }
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    await composer.focus();
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "n",
      code: "KeyN",
      windowsVirtualKeyCode: 78,
    });
    await cdp.send("Input.imeSetComposition", {
      text: "ni",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await expect(composer).toHaveValue("ni");
    await cdp.send("Input.insertText", { text: "你" });
    await expect(composer).toHaveValue("你");
    await expect
      .poll(() => sent.some((input) => input.data === "你"))
      .toBe(true);
    expect(
      sent.some(
        (input) => input.event?.key === "n" && input.event?.type === "press",
      ),
    ).toBe(false);
  } finally {
    await cdp.detach();
  }
});

test("a late key release acknowledgement does not overwrite native composition", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await sdkAction(page, "session.new");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/api/action", async (route) => {
    const body = route.request().postDataJSON();
    if (
      body.action === "desktop.input" &&
      body.args.event?.type === "release" &&
      body.args.event.key === "x"
    ) {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    await composer.press("x");
    await expect.poll(() => held).toBe(true);
    await cdp.send("Input.imeSetComposition", {
      text: "ni",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await expect(composer).toHaveValue("xni");
    const acknowledged = page.waitForResponse((response) => {
      if (
        !response.url().endsWith("/api/action") ||
        response.request().method() !== "POST"
      )
        return false;
      const body = response.request().postDataJSON();
      return (
        body.action === "desktop.input" &&
        body.args.event?.type === "release" &&
        body.args.event.key === "x"
      );
    });
    release();
    await acknowledged;
    await expect(composer).toHaveValue("xni");
    await cdp.send("Input.insertText", { text: "你" });
    await expect(composer).toHaveValue("x你");
  } finally {
    release();
    await cdp.detach();
    await page.unrouteAll({ behavior: "wait" });
  }
});
