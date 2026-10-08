import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";
import { mkdir } from "node:fs/promises";

test("session and context menus support keyboard operation and errors stay in the local dialog", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  const trigger = page.getByRole("button", { name: "会话操作", exact: true });
  await trigger.focus();
  await trigger.press("ArrowDown");
  const menu = page.getByRole("dialog", { name: "会话操作", exact: true });
  await expect(
    menu.getByRole("button", { name: "普通", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("button", { name: "运行 Shell 命令…", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole("button", { name: "导入会话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入会话", exact: true });
  await dialog.getByRole("textbox").fill("missing-session.jsonl");
  await dialog.getByRole("button", { name: "导入会话", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("missing-session");
  await dialog.getByRole("textbox").fill("corrected-path");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const add = page.getByRole("button", { name: "添加上下文", exact: true });
  await add.focus();
  await add.press("ArrowDown");
  const context = page.getByRole("dialog", { name: "添加上下文", exact: true });
  const search = context.getByRole("textbox", { name: "搜索技能与命令" });
  await expect(search).toBeFocused();
  await search.press("ArrowDown");
  await expect(
    context.getByRole("button", { name: "添加图片", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    context.getByRole("button", { name: "项目文件", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  await add.click();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const command = snapshot.commands[0]!;
  await search.fill(command.name);
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(context).toBeHidden();
  await expect(editor).toHaveValue(`/${command.name} `);
});

test("structured provider editor saves actual SDK models, preserves advanced fields and cancels safely", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const original = await sdkAction<string>(page, "config.read", {
    name: "models.json",
  });
  try {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings
      .getByRole("button", { name: "模型与账号", exact: true })
      .click();
    await settings
      .getByRole("button", { name: "添加自定义端点", exact: true })
      .click();
    const form = settings.locator(".custom-provider-form");
    const actions = await form.locator("button").evaluateAll(buttons => buttons
      .filter(button => button.textContent?.trim() && button.getAttribute("role") !== "combobox")
      .map(button => {
        const css = getComputedStyle(button);
        return [button.getBoundingClientRect().height, css.fontSize, css.borderRadius];
      }));
    expect(actions.every(([height, font, radius]) => height === 36 && font === "13px" && radius === "8px")).toBe(true);
    await expect(settings.getByRole("button", { name: "保存设置", exact: true })).toBeHidden();
    const inheritedRows = await form.locator(".field").evaluateAll(fields => fields
      .filter(field => parseFloat(getComputedStyle(field).borderBottomWidth) > 0
        || field.querySelector('input, button')!.getBoundingClientRect().top < field.querySelector('span')!.getBoundingClientRect().bottom)
      .map(field => field.textContent));
    expect(inheritedRows, "endpoint fields must use form layout rather than divided preference rows").toEqual([]);
    const inputSkins = await form.locator('.field > input').evaluateAll(inputs => inputs.map(input => {
      const css = getComputedStyle(input);
      return `${css.backgroundColor}/${css.height}`;
    }));
    expect(new Set(inputSkins).size, 'text and number fields must share the same control style').toBe(1);
    await settings
      .getByRole("textbox", { name: "提供商 ID", exact: true })
      .fill("ui-custom");
    await settings
      .getByRole("textbox", { name: "API 地址", exact: true })
      .fill("bad-url");
    await settings
      .getByRole("button", { name: "保存端点", exact: true })
      .click();
    await expect(settings.getByRole("alert")).toContainText("HTTP");
    expect(await sdkAction(page, "config.read", { name: "models.json" })).toBe(
      original,
    );
    await settings
      .getByRole("textbox", { name: "API 地址", exact: true })
      .fill("http://127.0.0.1:18888/v1");
    await settings
      .getByRole("textbox", { name: "API Key 或环境变量", exact: true })
      .fill("fixture-key");
    await settings
      .getByRole("textbox", { name: "模型 ID", exact: true })
      .fill("custom-chat");
    await settings
      .getByRole("textbox", { name: "显示名称", exact: true })
      .fill("桌面自定义模型");
    await settings
      .getByRole("spinbutton", { name: "上下文长度", exact: true })
      .fill("65536");
    await settings
      .getByRole("spinbutton", { name: "最大输出 tokens", exact: true })
      .fill("4096");
    await settings
      .getByRole("button", { name: "保存端点", exact: true })
      .click();
    await expect(
      settings.getByRole("button", { name: "编辑端点 ui-custom", exact: true }),
    ).toBeVisible();
    const config = JSON.parse(
      await sdkAction<string>(page, "config.read", { name: "models.json" }),
    );
    expect(config.providers["ui-custom"].models[0].contextWindow).toBe(65536);
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(
      snapshot.models.some(
        (model) => model.provider === "ui-custom" && model.id === "custom-chat",
      ),
    ).toBe(true);
    config.providers["ui-custom"].headers = { "X-Fixture": "keep" };
    config.providers["ui-custom"].models[0].compat = { supportsStore: false };
    await sdkAction(page, "config.save", {
      name: "models.json",
      content: JSON.stringify(config),
    });
    await settings.getByRole("button", { name: "常规", exact: true }).click();
    await settings
      .getByRole("button", { name: "模型与账号", exact: true })
      .click();
    await settings
      .getByRole("button", { name: "编辑端点 ui-custom", exact: true })
      .click();
    await settings
      .getByRole("textbox", { name: "显示名称", exact: true })
      .fill("修改的名称");
    await settings
      .getByRole("button", { name: "保存端点", exact: true })
      .click();
    await expect(settings.locator(".custom-provider-form")).toHaveCount(0);
    const saved = await sdkAction<string>(page, "config.read", {
      name: "models.json",
    });
    const updated = JSON.parse(saved).providers["ui-custom"];
    expect(updated.headers).toEqual({ "X-Fixture": "keep" });
    expect(updated.models[0].compat).toEqual({ supportsStore: false });
    expect(updated.models[0].name).toBe("修改的名称");
    await settings
      .getByRole("button", { name: "编辑端点 ui-custom", exact: true })
      .click();
    await settings
      .getByRole("textbox", { name: "API 地址", exact: true })
      .fill("http://unused.invalid/v1");
    await settings
      .getByRole("button", { name: "取消编辑", exact: true })
      .click();
    expect(await sdkAction(page, "config.read", { name: "models.json" })).toBe(
      saved,
    );
    await mkdir(".local/ui-omissions/evidence", { recursive: true });
    await page.screenshot({
      path: ".local/ui-omissions/evidence/providers.png",
    });
    await settings
      .getByRole("button", { name: "移除端点 ui-custom", exact: true })
      .click();
    await settings
      .getByRole("button", { name: "确认移除", exact: true })
      .click();
    await expect(
      settings.getByRole("button", { name: "编辑端点 ui-custom", exact: true }),
    ).toHaveCount(0);
  } finally {
    await sdkAction(page, "config.save", {
      name: "models.json",
      content: original,
    });
  }
});
