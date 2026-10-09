import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";
import { selectField, selectSettingsCategory } from "../select-field.ts";

test.beforeAll(() => mkdir(".local/structure-evidence", { recursive: true }));

test("session navigation, composer controls and selection rules work at all agreed widths", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 940 });
    if (width < 800 && await page.getByRole("button", { name: "收起侧边栏", exact: true }).isVisible())
      await page.getByRole("button", { name: "收起侧边栏", exact: true }).click();
    const nav = page.getByRole("navigation", { name: "会话视图" });
    for (const name of ["对话", "文件与更改", "会话树"])
      await expect(nav.getByRole("button", { name, exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "文件与更改", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "刷新历史会话" })).toHaveCount(0);
    await expect(page.getByLabel("就绪", { exact: true })).toHaveCount(0);
    const usage = page.locator(".composer-usage").getByRole("button", { name: "查看上下文与用量" });
    await expect(usage).toBeInViewport();
    const chooser = await page.getByRole("button", { name: "选择工作区", exact: true }).boundingBox();
    const composer = await page.locator(".composer").boundingBox();
    expect(chooser!.y + chooser!.height, "workspace chooser must sit above the input").toBeLessThan(composer!.y);
    expect(Math.abs(chooser!.x - composer!.x), "workspace chooser must align with the input's left edge").toBeLessThan(2);
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("布局草稿");
    await nav.getByRole("button", { name: "文件与更改", exact: true }).click();
    await expect(page.getByRole("region", { name: "文件与更改" })).toBeVisible();
    await page.getByRole("button", { name: "关闭文件面板", exact: true }).click();
    await expect(input).toHaveValue("布局草稿");
    await usage.click();
    await expect(page.getByRole("dialog", { name: "上下文与用量", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "打开完整检查器", exact: true }).click();
    await expect(page.locator(".inspector")).toBeVisible();
    await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
    await page.screenshot({ path: `.local/structure-evidence/chat-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const open = page.getByRole("button", { name: "打开侧边栏", exact: true });
    if (await open.isVisible()) await open.click();
    const sidebar = page.locator(".sidebar");
    await expect(sidebar.getByRole("button", { name: "添加工作区", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "搜索会话", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "资源", exact: true })).toHaveCount(0);
    expect(await sidebar.locator(".brand").evaluate(node => getComputedStyle(node).userSelect)).toBe("none");
    expect(await input.evaluate(node => getComputedStyle(node).userSelect)).toBe("text");
  }
});

test("transcript presets collapse standard steps and retain replies and original expansion", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "run-tool" });
  const setView = async (name: string) => {
    await page.getByRole("button", { name: "会话操作", exact: true }).click();
    await page.getByRole("group", { name: "对话视图" }).getByRole("button", { name, exact: true }).click();
  };
  await setView("普通");
  const row = page.locator('.tool-execution[data-tool-call-id="call-read"]');
  await expect(row.locator(".tool-step-summary")).toContainText("读取");
  await expect(row.locator(".tool-body")).toBeHidden();
  await expect(page.getByText("SDK desktop tool verified.", { exact: true })).toBeVisible();
  const before = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await setView("详细");
  await page.locator(".process-group > summary").click();
  await expect(row.locator(".tool-body")).toBeVisible();
  await row.getByRole("button", { name: "收起 read 输出", exact: true }).click();
  await expect(row.locator(".tool-body")).toBeHidden();
  await setView("思考");
  const after = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(after.thinking).toBe(before.thinking);
  expect(after.messages.length).toBe(before.messages.length);
  expect(await page.locator(".message-body").last().evaluate(node => getComputedStyle(node).userSelect)).toBe("text");
  await page.screenshot({ path: ".local/structure-evidence/steps.png" });
});

test("settings categories preserve drafts, scopes and integration add forms", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const categories = page.getByRole("navigation", { name: "设置分类" });
  await expect(page.getByRole("button", { name: "终端", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "缓存预热" })).toHaveCount(0);
  const steering = page.getByRole("combobox", { name: "执行中消息", exact: true });
  await selectField(steering, "all");
  await expect(page.getByText("有未保存的更改", { exact: true })).toBeVisible();
  await categories.getByRole("button", { name: "外观与显示", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "配置范围", exact: true })).toHaveCount(0);
  await selectField(page.getByRole("combobox", { name: "颜色模式", exact: true }), "dark");
  await categories.getByRole("button", { name: "常规", exact: true }).click();
  await expect(steering).toHaveAttribute("data-value", "all");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("设置已保存", { exact: true })).toBeVisible();
  await categories.getByRole("button", { name: "模型与账号", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "默认模型", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "配置范围", exact: true })).toHaveCount(0);
  await categories.getByRole("button", { name: "MCP", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "添加服务器", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toBeFocused();
  const mcpForm = page.getByRole("group", { name: "添加服务器", exact: true });
  await expect(page.getByText("尚未配置 MCP 服务器", { exact: true })).toHaveCount(0);
  const misplacedFields = await mcpForm.locator(".field").evaluateAll(fields => fields.filter(field => {
    const label = field.querySelector("span")!.getBoundingClientRect();
    const control = field.querySelector("input,button")!.getBoundingClientRect();
    return control.top < label.bottom || Math.abs(control.left - label.left) > 1;
  }).map(field => field.textContent));
  expect(misplacedFields, "integration fields must consistently place labels above controls").toEqual([]);
  expect(await mcpForm.getByRole("combobox", { name: "传输方式" }).evaluate(node => parseFloat(getComputedStyle(node).borderWidth))).toBe(1);
  const header = await mcpForm.getByRole("heading").boundingBox();
  const cancel = await mcpForm.getByRole("button", { name: "取消添加" }).boundingBox();
  expect(Math.abs(header!.y + header!.height / 2 - cancel!.y - cancel!.height / 2)).toBeLessThan(1);
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("draft-server");
  await categories.getByRole("button", { name: "扩展包", exact: true }).click();
  await page.getByRole("button", { name: "添加扩展包", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "包地址" })).toBeFocused();
  await page.getByRole("button", { name: "取消添加", exact: true }).click();
  await categories.getByRole("button", { name: "MCP", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toHaveValue("draft-server");
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "取消添加", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toHaveCount(0);
  await categories.getByRole("button", { name: "扩展包", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "包地址" })).toHaveCount(0);
  await page.getByRole("button", { name: "添加扩展包", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "包地址" })).toBeFocused();
  await expect(page.getByText("尚未安装扩展包", { exact: true })).toHaveCount(0);
  const packageForm = page.getByRole("group", { name: "添加扩展包", exact: true });
  await expect(packageForm.getByRole("heading", { name: "添加扩展包" })).toBeInViewport();
  const install = await packageForm.getByRole("button", { name: "安装", exact: true }).boundingBox();
  const source = await packageForm.getByRole("textbox", { name: "包地址" }).boundingBox();
  expect(Math.abs(install!.x + install!.width - source!.x - source!.width), "primary installation action must align to the form edge").toBeLessThan(1);
  await page.getByRole("button", { name: "取消添加", exact: true }).click();
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 940 });
    await selectSettingsCategory(page.getByRole("dialog", { name: "设置", exact: true }), "高级");
    await expect(page.getByRole("combobox", { name: "缓存预热" })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存设置", exact: true })).toBeInViewport();
    await page.screenshot({ path: `.local/structure-evidence/settings-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await sdkAction(page, "theme.set", { theme: "light" });
});
