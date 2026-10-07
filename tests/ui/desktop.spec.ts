import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import { selectField } from "../select-field.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("desktop SDK workflows and editable settings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await page.getByRole("button", { name: "文件与更改", exact: true }).click();
  await page.getByRole("treeitem", { name: /test-note.txt/ }).click();
  await expect(
    page
      .locator(".file-preview")
      .getByText("Real file attachment content.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加到消息", exact: true }).click();
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("run-tool");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByText("SDK desktop tool verified.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.tool-execution[data-tool-state="success"]').first(),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/desktop-chat.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("first-session-draft");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: /run-tool Attached file/ }).click();
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toHaveValue("first-session-draft");
  const previousSession = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect
    .poll(async () => {
      const current = await sdkAction<DesktopSnapshot>(page, "snapshot");
      return (
        !current.changing && current.sessionId !== previousSession.sessionId
      );
    })
    .toBe(true);
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await sdkAction(page, "sdk.run", {
    path: `${snapshot.agentDir}/desktop/clear-model.mjs`,
  });
  await expect(page.getByText("未配置模型", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("/desktop-dialog");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Extension input", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Extension input", exact: true }),
  ).toHaveAttribute("placeholder", "Value");
  await page
    .getByRole("textbox", { name: "Extension input", exact: true })
    .fill("Extension answer");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toHaveValue("Extension answer");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "高级", exact: true }).click();
  await page.getByText("完整设置", { exact: true }).click();
  const settings = page.getByRole("textbox", {
    name: "完整设置 JSON",
    exact: true,
  });
  await settings.fill('{"retry":');
  await expect(settings).toHaveValue('{"retry":');
  await page.getByRole("button", { name: "保存完整设置", exact: true }).click();
  await expect(
    page.getByText("设置必须是有效的 JSON 对象", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "外观与显示", exact: true }).click();
  await selectField(page.getByRole("combobox", { name: "颜色模式", exact: true }), "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: ".local/screenshots/desktop-settings-dark.png",
    fullPage: true,
  });
  await selectField(page.getByRole("combobox", { name: "颜色模式", exact: true }), "light");
  expect(errors).toEqual([]);
});

test("native overlays position and close at desktop and mobile sizes", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 940 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.fill("/desktop-native-overlay");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const overlay = page.locator(".desktop-overlay");
    await expect(
      overlay.getByRole("textbox", { name: "Task name" }),
    ).toBeFocused();
    await page.screenshot({
      path: `.local/screenshots/native-overlay-${viewport.width}.png`,
      animations: "disabled",
    });
    const bounds = await overlay.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await overlay
      .getByRole("button", { name: "关闭扩展", exact: true })
      .click();
    await expect(overlay).not.toBeVisible();
  }
});

test("mobile views remain accessible without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开侧边栏", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/mobile-chat.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "打开检查器", exact: true }).click();
  await expect(page.getByText("会话检查器", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
  await page.getByRole("button", { name: "打开侧边栏", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "打开侧边栏", exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/mobile-settings.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("extension TUI form adapter renders native desktop controls", async ({
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
    await composer.fill("/desktop-native-form");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Extension task" }),
    ).toBeVisible();
    await dialog
      .getByRole("textbox", { name: "Task name" })
      .fill("Desktop task");
    await dialog
      .getByRole("combobox", { name: "Priority" })
      .selectOption("high");
    await expect(
      dialog.getByRole("button", { name: "Unavailable" }),
    ).toBeDisabled();
    await page.screenshot({
      path: `.local/screenshots/native-extension-${viewport.width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Apply task" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(composer).toHaveValue("Desktop task");
  }
  expect(errors).toEqual([]);
});

test("extension keys, native transcript renderers and keyboard completion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await composer.fill("/desktop-input");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(composer).toHaveValue("");
  await composer.focus();
  await composer.pressSequentially("xyab");
  await expect(composer).toHaveValue("Zab");
  await composer.press("Backspace");
  await expect(composer).toHaveValue("Za");
  await composer.evaluate((control: HTMLTextAreaElement) => {
    control.dispatchEvent(
      new InputEvent("beforeinput", {
        data: "y",
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(composer).toHaveValue("ZaZ");
  await composer.evaluate((control: HTMLTextAreaElement) => {
    control.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const start = control.selectionStart;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(
      control,
      control.value.slice(0, start) + "y" + control.value.slice(start),
    );
    control.setSelectionRange(start + 1, start + 1);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(
      new CompositionEvent("compositionend", { data: "y", bubbles: true }),
    );
  });
  await expect(composer).toHaveValue("ZaZZ");
  await composer.press("Control+Alt+u");
  await expect(composer).toHaveValue("Shortcut handled");
  await composer.fill("/desktop-input-off");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(composer).toHaveValue("");
  await composer.fill("/desktop-renderers");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByText("Native message renderer", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Native entry renderer", { exact: true }),
  ).toBeVisible();
  await composer.fill("/desktop-nat");
  await expect(
    page.getByRole("listbox", { name: "选择", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /desktop-native-form/ }),
  ).toHaveCount(1);
  await composer.press("Tab");
  await expect(composer).toHaveValue("/desktop-native-form ");
  await page.screenshot({
    path: ".local/screenshots/native-transcript-1440.png",
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
