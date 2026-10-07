import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

const categories = ["General", "Appearance", "Models & accounts", "Project", "MCP", "Packages", "Advanced"];
test("language preference updates immediately, persists and preserves drafts and extension text", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await editor.fill("用户草稿 / User draft");
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).editor.text).toBe("用户草稿 / User draft");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.locator(".settings-modal");
  await settings.getByRole("combobox", { name: "执行中消息", exact: true }).click();
  await page.getByRole("option", { name: "全部交付", exact: true }).click();
  await settings.getByRole("button", { name: "外观与显示", exact: true }).click();
  await settings.getByRole("combobox", { name: "界面语言", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(settings.getByRole("combobox", { name: "Interface language", exact: true })).toHaveText("English");
  await settings.getByRole("button", { name: "General", exact: true }).click();
  await expect(settings.getByRole("combobox", { name: "Messages during a task", exact: true })).toHaveAttribute("data-value", "all");
  await expect(settings.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "MCP", exact: true }).click();
  await settings.getByRole("button", { name: "Add server", exact: true }).click();
  await settings.getByRole("textbox", { name: "Name", exact: true }).fill("invalid name");
  await settings.getByRole("textbox", { name: "Executable", exact: true }).fill("node");
  await settings.getByRole("button", { name: "Save server", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("Server names may contain only");
  // This changes only the shared language store, without changing tabs or editor lifetime.
  await page.evaluate(async () => { const path = "/src/i18n.ts"; (await import(path)).setLocale("zh-CN"); });
  await expect(settings.getByRole("alert")).toContainText("服务器名称只能");
  await expect(settings.getByRole("textbox", { name: "名称", exact: true })).toHaveValue("invalid name");
  await page.evaluate(async () => { const path = "/src/i18n.ts"; (await import(path)).setLocale("en"); });
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("用户草稿 / User draft");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("用户草稿 / User draft");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const current = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect([current.cwd, current.sessionId, current.messages, current.globalSettings, current.projectSettings])
    .toEqual([initial.cwd, initial.sessionId, initial.messages, initial.globalSettings, initial.projectSettings]);
  await sdkAction(page, "prompt", { message: "/desktop-dialog" });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Extension confirmation", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const probe = join(initial.agentDir, "desktop", "language-dialog.mjs");
  await writeFile(probe, 'export default ({host}, args) => host.ask({kind:"select", title:"总结当前分支", message:"设置", options:["不总结", "总结"], ...args});');
  for (const owned of [false, true]) {
    const pending = sdkAction(page, "sdk.run", { path: probe, args: { desktopTitle: owned, desktopOptions: owned } });
    await expect(dialog.getByRole("heading", { name: owned ? "Summarize current branch" : "总结当前分支", exact: true })).toBeVisible();
    await expect(dialog.locator(".dialog-message")).toHaveText("设置");
    await dialog.getByRole("button", { name: owned ? "Skip summary" : "不总结", exact: true }).click();
    expect(await pending).toBe("不总结");
  }
});

test("mapped component labels use English while original close actions still run", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pi.locale", "en"));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await sdkAction(page, "prompt", { message: "/mapped-settings" });
  const dialog = page.getByRole("dialog");
  const component = dialog.locator(".desktop-extension");
  await expect(component.getByRole("textbox", { name: "Search", exact: true })).toBeVisible();
  await component.getByRole("button", { name: "Close extension", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("English layouts cover all settings and primary carriers in both themes", async ({ page }) => {
  test.setTimeout(180000);
  await mkdir(".local/i18n/rendered", { recursive: true });
  await page.addInitScript(() => localStorage.setItem("pi.locale", "en"));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  for (const theme of ["light", "dark"]) {
    await sdkAction(page, "theme.set", { theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [1440, 1024, 768, 390, 375]) {
      await page.setViewportSize({ width, height: width === 1024 ? 600 : width > 700 ? 940 : 740 });
      if (await button("Open sidebar").isVisible()) await button("Open sidebar").click();
      await button("Settings").click();
      const settings = page.getByRole("dialog", { name: "Settings", exact: true });
      for (const category of categories) {
        await settings.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: category, exact: true }).click();
        if (category === "Appearance") {
          await expect(settings.getByRole("option")).toHaveCount(0);
          await expect(settings.getByRole("combobox", { name: "Interface language" })).toBeInViewport();
        }
        if (category === "MCP" || category === "Packages") await settings.getByRole("button", { name: category === "MCP" ? "Add server" : "Add package", exact: true }).click();
        if (category === "Models & accounts") await settings.getByRole("button", { name: "Add custom endpoint", exact: true }).click();
        const untranslated = await settings.evaluate(root => {
          const copy = root.cloneNode(true) as HTMLElement;
          copy.querySelectorAll('input,textarea,[name="interface-language"],.provider-identity,.model-row,.settings-locations dd').forEach(node => node.remove());
          return /\p{Script=Han}/u.test(copy.textContent ?? "");
        });
        expect(untranslated, category).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(settings).toBeInViewport();
        const inconsistent = await settings.locator(".settings-action").evaluateAll(buttons => buttons.filter(button => button.getBoundingClientRect().height > 0 && button.getBoundingClientRect().height !== 32).map(button => button.textContent));
        expect(inconsistent, category).toEqual([]);
        await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-${category.replaceAll(/[^\w]/g, "-")}.png`, animations: "disabled" });
        if (category === "Models & accounts") await settings.getByRole("button", { name: "Cancel editing", exact: true }).click();
        if (category === "MCP" || category === "Packages") await settings.getByRole("button", { name: "Cancel adding", exact: true }).click();
      }
      await settings.getByRole("button", { name: "Close settings", exact: true }).click();
      if (width < 1024 && await button("Collapse sidebar").isVisible()) await button("Collapse sidebar").click();
      await button("Session actions").click();
      await expect(page.getByRole("dialog", { name: "Session actions", exact: true })).toBeInViewport();
      await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-menu.png` });
      await page.keyboard.press("Escape");
      await button("Choose workspace").click();
      await page.getByRole("menuitem", { name: "Add workspace…", exact: true }).click();
      const folder = page.getByRole("dialog", { name: "Add workspace", exact: true });
      await expect(folder).toBeInViewport();
      await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-folder.png` });
      await folder.getByRole("button", { name: "Cancel", exact: true }).click();
      await button("Files & changes").click();
      await expect(page.getByRole("complementary", { name: "Files and changes panel", exact: true })).toBeVisible();
      if (width === 1440 || width === 375) await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-files.png` });
      await button("Close files panel").click();
      await button("Session tree").click();
      if (width === 1440 || width === 375) await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-tree.png` });
      await button("Resources").click();
      if (width === 1440 || width === 375) await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-resources.png` });
      await button("Chat").click();
      if (width === 1440 || width === 375) {
        await button("Add context").click();
        await expect(page.getByRole("dialog", { name: "Add context", exact: true })).toBeInViewport();
        await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-context.png` });
        await page.keyboard.press("Escape");
        await button("View context and usage").click();
        await expect(page.getByRole("dialog", { name: "Context and usage", exact: true })).toBeInViewport();
        await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-usage.png` });
        await button("Open full inspector").click();
        await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-inspector.png` });
        await button("Close inspector").click();
        await page.locator('.workspace-header button[aria-controls="pi-terminal-panel"]').click();
        await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-terminal.png` });
        await page.locator('.workspace-header button[aria-controls="pi-terminal-panel"]').click();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.local/i18n/rendered/${theme}-${width}-chat.png` });
    }
  }
  await sdkAction(page, "theme.set", { theme: "light" });
  expect(errors).toEqual([]);
});
