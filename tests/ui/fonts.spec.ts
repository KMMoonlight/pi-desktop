import { test, expect } from "@playwright/test";
import { selectField, selectSettingsCategory } from "../select-field";
import { sdkAction } from "../editor-workflows";

test("font preferences apply across the interface and running terminals, persist and reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Preference behavior is independent of which fonts this test machine has.
  await page.route("**/api/action", (route) => {
    if (route.request().postDataJSON()?.action !== "fonts.list")
      return route.continue();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: ["Arial", "Courier New"] }),
    });
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await editor.fill("字体设置保留草稿");
  await page.getByRole("button", { name: "终端", exact: true }).click();
  const shellRows = page.locator('[data-terminal-source="shell"] .xterm-rows');
  const piRows = page.locator('[data-terminal-source="pi"] .xterm-rows');
  await expect(shellRows).toBeVisible();
  const originalInterface = await editor.evaluate(
    (node) => getComputedStyle(node).fontFamily,
  );
  const originalCode = await shellRows.evaluate(
    (node) => getComputedStyle(node).fontFamily,
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await selectSettingsCategory(settings, "外观与显示");
  await expect(
    settings.getByRole("button", { name: "刷新字体", exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("textbox", { name: "搜索已安装字体", exact: true }),
  ).toHaveCount(0);
  const ui = settings.getByRole("combobox", { name: "界面字体", exact: true });
  const code = settings.getByRole("combobox", {
    name: "代码与终端字体",
    exact: true,
  });
  await selectField(ui, "Arial");
  await selectField(code, "Courier New");
  await expect(editor).toHaveCSS("font-family", /^Arial,/);
  await expect(
    settings.getByRole("heading", { name: "设置", exact: true }),
  ).toHaveCSS("font-family", /^Arial,/);
  await expect(settings.locator(".font-preview code")).toHaveCSS(
    "font-family",
    /^"Courier New",/,
  );
  await expect(shellRows).toHaveCSS("font-family", /^"Courier New",/);
  await expect(piRows).toHaveCSS("font-family", /^"Courier New",/);
  await selectField(ui, "custom");
  const custom = settings.getByRole("textbox", {
    name: "自定义界面字体名称",
    exact: true,
  });
  await custom.fill("My Local Font");
  await expect(editor).toHaveCSS("font-family", /^"My Local Font",/);
  await selectField(code, "custom");
  await settings
    .getByRole("textbox", { name: "自定义代码字体名称", exact: true })
    .fill("Local Mono Font");
  await expect(shellRows).toHaveCSS("font-family", /^"Local Mono Font",/);
  await page.setViewportSize({ width: 390, height: 740 });
  await settings
    .getByRole("group", { name: "字体预览", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await settings.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: ".local/screenshots/font-settings-mobile.png",
  });
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.screenshot({ path: ".local/screenshots/font-settings.png" });
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(editor).toHaveValue("字体设置保留草稿");
  await page.reload();
  await expect(editor).toHaveCSS("font-family", /^"My Local Font",/);
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await expect(shellRows).toHaveCSS("font-family", /^"Local Mono Font",/);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await selectSettingsCategory(settings, "外观与显示");
  await expect(custom).toHaveValue("My Local Font");
  await expect(
    settings.getByRole("textbox", { name: "自定义代码字体名称", exact: true }),
  ).toHaveValue("Local Mono Font");
  await selectField(ui, "");
  await selectField(code, "");
  await expect(editor).toHaveCSS("font-family", originalInterface);
  await expect(shellRows).toHaveCSS("font-family", originalCode);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("pi.fontPreferences")!),
    ),
  ).toEqual({ interface: "", code: "" });
  expect(errors).toEqual([]);
});

test("font settings translate and tolerate invalid saved preferences", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("pi.fontPreferences", "invalid-json");
    localStorage.setItem("pi.locale", "en");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await selectSettingsCategory(settings, "Appearance");
  await expect(
    settings.getByRole("combobox", { name: "Interface font", exact: true }),
  ).toHaveValue("App default font");
  await expect(
    settings.getByRole("combobox", {
      name: "Code & terminal font",
      exact: true,
    }),
  ).toHaveValue("App default font");
  await expect(
    settings.getByRole("group", { name: "Font preview", exact: true }),
  ).toBeVisible();
});

test("installed fonts are read from the local OS and offered in both selectors", async ({
  page,
}) => {
  await page.goto("/");
  const installed = await sdkAction<string[]>(page, "fonts.list");
  expect(installed.length).toBeGreaterThan(0);
  expect(new Set(installed).size).toBe(installed.length);
  expect(
    installed.some(
      (font) => font.startsWith(".") || /[\u202a-\u202e]/.test(font),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await selectSettingsCategory(settings, "外观与显示");
  await expect(settings.getByText(/^已找到 .* 种已安装字体$/)).toHaveCount(0);
  for (const label of ["界面字体", "代码与终端字体"]) {
    await settings.getByRole("combobox", { name: label, exact: true }).click();
    const options = page
      .getByRole("listbox", { name: label, exact: true })
      .getByRole("option");
    await expect(options).toHaveCount(installed.length + 2);
    expect(await options.allTextContents()).toEqual([
      "应用默认字体",
      ...installed,
      "自定义字体",
    ]);
    if (label === "界面字体") {
      await page.screenshot({
        path: ".local/screenshots/device-font-picker.png",
      });
    }
    await page.keyboard.press("Escape");
  }
  const selected = installed.find((font) => font === "Arial") ?? installed[0];
  const ui = settings.getByRole("combobox", { name: "界面字体", exact: true });
  await ui.click();
  await ui.fill(selected.toLowerCase());
  const list = page.getByRole("listbox", { name: "界面字体", exact: true });
  await list.getByRole("option", { name: selected, exact: true }).click();
  await expect(ui).toHaveValue(selected);
  const saved = await page.evaluate(() =>
    localStorage.getItem("pi.fontPreferences"),
  );
  await ui.click();
  await ui.fill("font-with-no-matches-123456789");
  await expect(list.getByText("没有匹配的字体", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("pi.fontPreferences")),
  ).toBe(saved);
  await page.keyboard.press("Escape");
  await expect(ui).toHaveValue(selected);
  await expect(settings).toBeVisible();
  await settings
    .getByRole("combobox", { name: "代码与终端字体", exact: true })
    .click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(
    installed.length + 2,
  );
  await page.keyboard.press("Escape");
});

test("font scan failures preserve custom fonts without status clutter and reopening reads the list again", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "pi.fontPreferences",
      JSON.stringify({ interface: "Device Sans", code: "Device Mono" }),
    ),
  );
  let attempts = 0;
  await page.route("**/api/action", async (route) => {
    if (route.request().postDataJSON()?.action !== "fonts.list")
      return route.continue();
    attempts++;
    return route.fulfill({
      status: attempts === 1 ? 500 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        attempts === 1
          ? { error: "scan failed" }
          : { data: ["Device Mono", "Device Sans", "New Installed Font"] },
      ),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await selectSettingsCategory(settings, "外观与显示");
  await expect(
    settings.getByRole("textbox", { name: "自定义界面字体名称", exact: true }),
  ).toHaveValue("Device Sans");
  await expect(
    settings.getByRole("textbox", { name: "自定义代码字体名称", exact: true }),
  ).toHaveValue("Device Mono");
  await expect(settings.getByRole("status")).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "刷新字体", exact: true }),
  ).toHaveCount(0);
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await selectSettingsCategory(settings, "外观与显示");
  const ui = settings.getByRole("combobox", { name: "界面字体", exact: true });
  const code = settings.getByRole("combobox", {
    name: "代码与终端字体",
    exact: true,
  });
  await expect(ui).toHaveValue("Device Sans");
  await expect(code).toHaveValue("Device Mono");
  await selectField(ui, "New Installed Font");
  await expect(ui).toHaveValue("New Installed Font");
});

test("font selectors combine independent search and selection with keyboard cancellation", async ({
  page,
}) => {
  await page.route("**/api/action", (route) =>
    route.request().postDataJSON()?.action === "fonts.list"
      ? route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: ["Arial", "Noto Sans SC", "Noto Sans Mono"],
          }),
        })
      : route.continue(),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await selectSettingsCategory(settings, "外观与显示");
  const ui = settings.getByRole("combobox", { name: "界面字体", exact: true });
  const code = settings.getByRole("combobox", {
    name: "代码与终端字体",
    exact: true,
  });
  await ui.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(5);
  await ui.fill("nOtO");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
    "Noto Sans SC",
    "Noto Sans Mono",
  ]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(ui).toHaveValue("Noto Sans Mono");
  await code.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(5);
  await code.fill("arial");
  await page.keyboard.press("Enter");
  await expect(code).toHaveValue("Arial");
  await ui.click();
  await ui.fill("unsaved search");
  await page.keyboard.press("Escape");
  await expect(ui).toHaveValue("Noto Sans Mono");
  await expect(code).toHaveValue("Arial");
  await expect(settings).toBeVisible();
  await ui.click();
  await ui.fill("Arial");
  await settings.locator(".font-preview").click();
  await expect(ui).toHaveValue("Noto Sans Mono");
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 940 });
    for (const theme of ["light", "dark"]) {
      await sdkAction(page, "theme.set", { theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await ui.click();
      await ui.fill("noto");
      await expect(page.getByRole("listbox")).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: `.local/screenshots/font-search-${width}-${theme}.png`,
      });
      await page.keyboard.press("Escape");
    }
  }
});
