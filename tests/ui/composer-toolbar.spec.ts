import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("composer keeps usage below the input and model controls aligned when desktop panels reduce available width", async ({
  page,
}) => {
  await mkdir(".local/composer-toolbar", { recursive: true });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const modelsPath = join(initial.agentDir, "models.json");
  const original = await readFile(modelsPath, "utf8");
  const config = JSON.parse(original);
  config.providers["desktop-test"].models[0].name = "DeepSeek V4.1 Flash";
  config.providers["desktop-test"].models[0].reasoning = true;
  await writeFile(modelsPath, JSON.stringify(config));
  const seed = join(
    initial.agentDir,
    "desktop",
    "composer-toolbar-history.mjs",
  );
  await writeFile(
    seed,
    `export default ({session}) => {
    session.sessionManager.appendMessage({role: "user", content: "检查工具栏布局", timestamp: Date.now()});
    session.sessionManager.appendMessage({role: "assistant", content: [{type: "text", text: "已完成检查。"}], api: "openai-completions", provider: "desktop-test", model: "desktop-test", stopReason: "stop", timestamp: Date.now(), usage: {input: 70200, output: 2800, cacheRead: 0, cacheWrite: 0, totalTokens: 73000, cost: {input:0, output:0, cacheRead:0, cacheWrite:0, total:0}}});
    session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
  };`,
  );
  try {
    await sdkAction(page, "models.refresh");
    await sdkAction(page, "model.set", {
      provider: "desktop-test",
      id: "desktop-test",
    });
    await sdkAction(page, "thinking.set", { level: "low" });
    await sdkAction(page, "sdk.run", { path: seed });
    await expect(page.locator(".session-token-usage")).toContainText("70.2k");
    const inspect = async (visible: boolean) => {
      const close = page.getByRole("button", {
        name: "关闭检查器",
        exact: true,
      });
      if (visible && !(await close.isVisible()))
        await page
          .getByRole("button", { name: "打开检查器", exact: true })
          .click();
      if (!visible && (await close.isVisible())) await close.click();
    };
    const checkLayout = async (name: string) => {
      const composer = (await page.locator(".composer").boundingBox())!;
      const model = page.getByRole("combobox", { name: "模型", exact: true });
      const thinking = page.getByRole("combobox", {
        name: "思考等级",
        exact: true,
      });
      const action = page.locator("[data-composer-action]");
      const usage = page.locator(".session-token-usage");
      const boxes = await Promise.all(
        [
          model,
          thinking,
          action,
          page.getByRole("button", { name: "添加上下文", exact: true }),
        ].map((node) => node.boundingBox()),
      );
      const [modelBox, thinkingBox, actionBox] = boxes.map(
        (box) => box!,
      );
      expect(Math.abs(actionBox.width - actionBox.height), name).toBeLessThan(1);
      const iconBox = (await action.locator("svg").boundingBox())!;
      expect(Math.abs(iconBox.x + iconBox.width / 2 - actionBox.x - actionBox.width / 2), name).toBeLessThan(1);
      expect(Math.abs(iconBox.y + iconBox.height / 2 - actionBox.y - actionBox.height / 2), name).toBeLessThan(1);
      const center = (box: { y: number; height: number }) =>
        box.y + box.height / 2;
      expect(
        Math.abs(center(modelBox) - center(thinkingBox)),
        name,
      ).toBeLessThan(1);
      expect(Math.abs(center(modelBox) - center(actionBox)), name).toBeLessThan(
        1,
      );
      if (composer.width <= 602) {
        const options = (await page
          .locator(".composer-options")
          .boundingBox())!;
        expect(
          modelBox.y - options.y - options.height,
          name,
        ).toBeGreaterThanOrEqual(0);
        expect(
          modelBox.y - options.y - options.height,
          name,
        ).toBeLessThanOrEqual(12);
      }
      for (const box of boxes.map((box) => box!)) {
        expect(box.x, name).toBeGreaterThanOrEqual(composer.x);
        expect(box.x + box.width, name).toBeLessThanOrEqual(
          composer.x + composer.width,
        );
        expect(box.y + box.height, name).toBeLessThanOrEqual(
          composer.y + composer.height,
        );
      }
      expect(modelBox.width, name).toBeGreaterThanOrEqual(96);
      expect(
        await thinking
          .locator("span")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        name,
      ).toBe(true);
      expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(96);
      await expect(page.locator(".composer .session-token-usage"), name).toHaveCount(0);
      await expect(page.locator(".composer .composer-context"), name).toHaveCount(0);
      const metadata = page.locator(".composer-usage");
      const metaBox = (await metadata.boundingBox())!;
      expect(metaBox.y - composer.y - composer.height, name).toBeGreaterThanOrEqual(8);
      const context = metadata.getByRole("button", { name: "查看上下文与用量", exact: true });
      const contextBox = (await context.boundingBox())!;
      const usageBox = (await usage.boundingBox())!;
      expect(Math.abs(center(contextBox) - center(usageBox)), name).toBeLessThan(1);
      expect(contextBox.x + contextBox.width, name).toBeLessThanOrEqual(usageBox.x);
      for (const box of [contextBox, usageBox]) {
        expect(box.x, name).toBeGreaterThanOrEqual(composer.x);
        expect(box.x + box.width, name).toBeLessThanOrEqual(composer.x + composer.width);
        expect(box.y + box.height, name).toBeLessThanOrEqual(metaBox.y + metaBox.height);
      }
      const region = (await page.locator(".composer-region").boundingBox())!;
      expect(region.y + region.height - metaBox.y - metaBox.height, name).toBeGreaterThanOrEqual(24);
      const rate = page.locator(".composer-usage .generation-status");
      if (await rate.count()) {
        const rateBox = (await rate.boundingBox())!;
        expect(contextBox.x + contextBox.width, name).toBeLessThanOrEqual(rateBox.x);
        expect(rateBox.x + rateBox.width, name).toBeLessThanOrEqual(usageBox.x);
        expect(Math.abs(center(rateBox) - center(usageBox)), name).toBeLessThan(1);
      }
      await page.mouse.move(4, 4);
      await page.screenshot({ path: `.local/composer-toolbar/${name}.png` });
    };
    for (const viewport of [
      { width: 1440, height: 940 },
      { width: 1280, height: 740 },
      { width: 1181, height: 740 },
      { width: 1024, height: 740 },
      { width: 760, height: 580 },
    ]) {
      await page.setViewportSize(viewport);
      const closeSidebar = page.getByRole("button", {
        name: "收起侧边栏",
        exact: true,
      });
      if (viewport.width < 1024 && (await closeSidebar.isVisible()))
        await closeSidebar.click();
      for (const font of ["", "Courier New"]) {
        await page.evaluate(async (font) => {
          const path = "/src/fonts.ts";
          (await import(path)).setFontPreference("interface", font);
        }, font);
        for (const panel of [true, false]) {
          await inspect(panel);
          await sdkAction(page, "theme.set", {
            theme: panel ? "light" : "dark",
          });
          await checkLayout(
            `${viewport.width}-${font ? "mono" : "default"}-${panel ? "inspector" : "wide"}`,
          );
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 940 });
    const openSidebar = page.getByRole("button", {
      name: "打开侧边栏",
      exact: true,
    });
    if (await openSidebar.isVisible()) await openSidebar.click();
    await inspect(true);
    await editor.fill("streaming-metrics-probe");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.locator(".composer-usage .generation-status")).toContainText(
      "tok/s",
    );
    await checkLayout("streaming-inspector");
    await page.getByRole("button", { name: "停止任务", exact: true }).click();
    await expect(page.locator(".composer-usage .generation-status")).toHaveCount(0);
    await checkLayout("stopped-inspector");
    await page.getByRole("button", { name: "查看上下文与用量", exact: true }).click();
    const popup = page.getByRole("dialog", { name: "上下文与用量", exact: true });
    await expect(popup).toBeInViewport({ ratio: 1 });
    await expect(popup).toContainText("累计 token");
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await inspect(false);
    await sdkAction(page, "session.new");
    await checkLayout("empty-conversation");
    await page.getByRole("combobox", { name: "模型", exact: true }).click();
    await expect(
      page.getByRole("option", { name: /DeepSeek V4.1 Flash/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await writeFile(modelsPath, original);
    await sdkAction(page, "models.refresh");
  }
});
