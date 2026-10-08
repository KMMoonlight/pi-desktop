import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import { selectField } from "../select-field.ts";

test("redesigned task entry and disclosed navigation work across window sizes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await expect(composer).toBeVisible();
    await sdkAction(page, "session.new");
    await expect(
      page.getByRole("heading", { name: "今天，想完成什么？" }),
    ).toBeVisible();
    await expect(page.locator(".inspector")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/screenshots/layout-empty-${width}.png`,
    });
    await expect(page.getByRole("button", { name: "分析项目", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "审查更改", exact: true })).toHaveCount(0);
    await composer.fill("Test task input");
    await expect(composer).toHaveValue("Test task input");
    await page.getByRole("button", { name: "打开检查器", exact: true }).click();
    await expect(page.getByText("会话检查器", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
    if (width < 760) {
      await page
        .getByRole("button", { name: "打开侧边栏", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "新建会话", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "关闭侧边栏遮罩", exact: true })
        .click({ position: { x: width - 5, y: 500 } });
      await expect(
        page.getByRole("button", { name: "打开侧边栏", exact: true }),
      ).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test("redesigned conversation and supporting views retain actual workspace actions", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await sdkAction(page, "session.new");
  await composer.fill("run-tool");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByText("SDK desktop tool verified.", { exact: true }),
  ).toBeVisible();
  const process = page.locator(".process-group").first();
  await expect(process).toHaveJSProperty("open", false);
  await process.locator(":scope > summary").click();
  await expect(
    page.locator('.tool-execution[data-tool-state="success"]').first(),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/layout-populated-1440.png",
  });
  await page.getByRole("button", { name: "会话操作", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "导出会话", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/screenshots/layout-menu-1440.png" });
  await page
    .getByRole("button", { name: "关闭会话菜单", exact: true })
    .click({ position: { x: 300, y: 250 } });
  await page.getByRole("button", { name: "文件与更改", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "test-note.txt", exact: true })
    .click();
  await expect(
    page
      .locator(".file-preview")
      .getByText("Real file attachment content.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/screenshots/layout-files-1440.png" });
  await page.getByRole("button", { name: "添加到消息", exact: true }).click();
  await expect(page.locator(".attachment-list")).toContainText("test-note.txt");
  for (const [name, file] of [
    ["会话树", "tree"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".workspace-section")).toBeVisible();
    await page.screenshot({
      path: `.local/screenshots/layout-${file}-1440.png`,
    });
  }
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/layout-settings-1440.png",
  });
  await page.getByRole("button", { name: "扩展与技能", exact: true }).click();
  await expect(page.locator(".settings-resources")).toBeVisible();
  await page.screenshot({ path: ".local/screenshots/layout-resources-1440.png" });
  await page.getByRole("button", { name: "外观与显示", exact: true }).click();
  await selectField(page.getByRole("combobox", { name: "颜色模式", exact: true }), "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.screenshot({
    path: ".local/screenshots/layout-populated-dark-1440.png",
  });
  await page.setViewportSize({ width: 390, height: 940 });
  await page.reload();
  await expect(composer).toBeVisible();
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/screenshots/layout-populated-dark-390.png",
  });
  await sdkAction(page, "theme.set", { theme: "light" });
});
