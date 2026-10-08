import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("model switching keeps task controls, editor and layout stable; reasoning values stay untranslated", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "session.name", { name: "Model switching fixture" });
  await sdkAction(page, "prompt", { message: "Check desktop model switching" });
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const modelsPath = join(initial.agentDir, "models.json");
  const original = await readFile(modelsPath, "utf8");
  const probe = join(initial.agentDir, "desktop", "model-switch-delay.mjs");
  await mkdir(join(initial.agentDir, "desktop"), { recursive: true });
  // Hold the real SDK operation long enough to inspect every pending frame.
  await writeFile(
    probe,
    `const originals = new WeakMap();
    export default ({session}, {restore}) => {
      if (restore) { const original = originals.get(session); if (original) session.setModel = original; return; }
      if (originals.has(session)) return;
      const original = session.setModel;
      originals.set(session, original);
      session.setModel = async function(...args) {
        await new Promise(resolve => setTimeout(resolve, 400));
        const result = await original.apply(this, args);
        await new Promise(resolve => setTimeout(resolve, 400));
        return result;
      };
    };`,
  );
  try {
    const config = JSON.parse(original);
    const model = config.providers["desktop-test"].models[0];
    model.reasoning = true;
    model.name = "GPT";
    config.providers["desktop-test"].models.push({
      ...model,
      id: "layout-probe",
      name: "DeepSeek V4.1 Flash",
    });
    await writeFile(modelsPath, JSON.stringify(config));
    await sdkAction(page, "models.refresh");
    await sdkAction(page, "model.set", {
      provider: "desktop-test",
      id: "desktop-test",
    });
    await sdkAction(page, "sdk.run", { path: probe });
    await editor.fill("保留草稿 Keep this draft");
    for (const [index, size] of [
      { width: 1440, height: 940 },
      { width: 760, height: 580 },
    ].entries()) {
      await page.setViewportSize(size);
      await sdkAction(page, "theme.set", { theme: index ? "dark" : "light" });
      const model = page.getByRole("combobox", { name: "模型", exact: true });
      await model.click();
      await page
        .getByRole("listbox", { name: "模型", exact: true })
        .locator(
          `[data-value="desktop-test/${index ? "desktop-test" : "layout-probe"}"]`,
        )
        .hover();
      await page.evaluate(() => {
        const composer = document.querySelector(".composer")!;
        const editor = composer.querySelector("textarea")!;
        const transcript = document.querySelector(".transcript")!;
        const baseline = composer.getBoundingClientRect();
        const terminal = document.querySelector<HTMLElement>(
          '.header-tools [aria-controls="pi-terminal-panel"]',
        )!;
        const terminalPosition = terminal.getBoundingClientRect();
        const controls = [
          ...document.querySelectorAll<HTMLElement>(
            '.composer-models [role="combobox"]',
          ),
        ];
        const positions = controls.map((control) =>
          control.getBoundingClientRect(),
        );
        const buttons = [
          ...document.querySelectorAll<HTMLElement>(
            ".sidebar-actions button,.workspace-add,.session-row button,.composer-workspace-picker>button,.send-controls>[data-ui-button]",
          ),
        ];
        const appearance = buttons.map((button) => {
          const style = getComputedStyle(button);
          return `${style.opacity}/${style.backgroundColor}/${style.color}`;
        });
        const samples: {
          task: boolean;
          replaced: boolean;
          shift: number;
          controlShift: number;
          headerShift: number;
          opacity: string;
          appearanceChanged: boolean;
        }[] = [];
        const probe = { active: true, samples };
        (window as any).modelSwitchProbe = probe;
        const frame = () => {
          const rect = composer.getBoundingClientRect();
          samples.push({
            task: !!document.querySelector(
              '.status-tag.running,.run-indicator,[name="消息交付方式"],[aria-label="停止任务"]',
            ),
            replaced: !editor.isConnected || !transcript.isConnected,
            shift: Math.max(
              Math.abs(rect.y - baseline.y),
              Math.abs(rect.height - baseline.height),
            ),
            controlShift: Math.max(
              ...controls.map((control, index) => {
                const box = control.getBoundingClientRect();
                return Math.max(
                  Math.abs(box.x - positions[index].x),
                  Math.abs(box.width - positions[index].width),
                );
              }),
            ),
            opacity: getComputedStyle(controls[0]).opacity,
            headerShift: Math.abs(
              terminal.getBoundingClientRect().x - terminalPosition.x,
            ),
            appearanceChanged: buttons.some((button, index) => {
              const style = getComputedStyle(button);
              return (
                `${style.opacity}/${style.backgroundColor}/${style.color}` !==
                appearance[index]
              );
            }),
          });
          if (probe.active) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      await page
        .getByRole("listbox", { name: "模型", exact: true })
        .locator(
          `[data-value="desktop-test/${index ? "desktop-test" : "layout-probe"}"]`,
        )
        .click();
      await expect
        .poll(
          async () =>
            (await sdkAction<DesktopSnapshot>(page, "snapshot")).changing,
        )
        .toBe(true);
      const pending = await sdkAction<DesktopSnapshot>(page, "snapshot");
      expect(pending.busy).toBe(true);
      expect(pending.running).toBe(false);
      await expect(
        page.getByRole("button", { name: "停止任务", exact: true }),
      ).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await sdkAction<DesktopSnapshot>(page, "snapshot")).changing,
        )
        .toBe(false);
      const samples = await page.evaluate(() => {
        const probe = (window as any).modelSwitchProbe;
        probe.active = false;
        return probe.samples as {
          task: boolean;
          replaced: boolean;
          shift: number;
          controlShift: number;
          headerShift: number;
          opacity: string;
          appearanceChanged: boolean;
        }[];
      });
      await mkdir(".local/model-switch", { recursive: true });
      await writeFile(
        `.local/model-switch/frames-${size.width}.json`,
        JSON.stringify(samples),
      );
      expect(samples.length).toBeGreaterThan(5);
      expect(samples.some((sample) => sample.task || sample.replaced)).toBe(
        false,
      );
      expect(Math.max(...samples.map((sample) => sample.shift))).toBeLessThan(
        1,
      );
      expect(samples.every((sample) => sample.opacity === "1")).toBe(true);
      expect(samples.some((sample) => sample.appearanceChanged)).toBe(false);
      expect(
        Math.max(...samples.map((sample) => sample.controlShift)),
      ).toBeLessThan(1);
      expect(
        Math.max(...samples.map((sample) => sample.headerShift)),
      ).toBeLessThan(1);
      await expect(
        page.getByRole("combobox", { name: "模型", exact: true }),
      ).toBeFocused();
      expect(
        await page
          .getByRole("combobox", { name: "思考等级", exact: true })
          .locator("span")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await expect(editor).toHaveValue("保留草稿 Keep this draft");
      expect(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId,
      ).toBe(initial.sessionId);
    }
    for (const locale of ["zh-CN", "en"]) {
      await page.evaluate(async (locale) => {
        const path = "/src/i18n.ts";
        (await import(path)).setLocale(locale);
      }, locale);
      const thinking = page.getByRole("combobox", {
        name: locale === "en" ? "Thinking level" : "思考等级",
        exact: true,
      });
      await thinking.click();
      const levels = (await sdkAction<DesktopSnapshot>(page, "snapshot"))
        .thinkingLevels;
      await expect(page.getByRole("option")).toHaveText(levels);
      await page.getByRole("option", { name: "high", exact: true }).click();
      await expect(thinking).toHaveText("high");
      await expect
        .poll(
          async () =>
            (await sdkAction<DesktopSnapshot>(page, "snapshot")).thinking,
        )
        .toBe("high");
      const openSidebar = page.getByRole("button", {
        name: locale === "en" ? "Open sidebar" : "打开侧边栏",
        exact: true,
      });
      if (await openSidebar.isVisible()) await openSidebar.click();
      await page
        .getByRole("button", {
          name: locale === "en" ? "Settings" : "设置",
          exact: true,
        })
        .click();
      const settings = page.locator(".settings-modal");
      await settings
        .getByRole("button", {
          name: locale === "en" ? "Models & accounts" : "模型与账号",
          exact: true,
        })
        .click();
      await settings
        .getByRole("combobox", {
          name: locale === "en" ? "Default thinking level" : "默认思考等级",
          exact: true,
        })
        .click();
      await expect(page.getByRole("option")).toHaveText([
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
      await page.keyboard.press("Escape");
      await settings
        .getByRole("button", {
          name: locale === "en" ? "Close settings" : "关闭设置",
          exact: true,
        })
        .click();
    }
  } finally {
    await sdkAction(page, "sdk.run", { path: probe, args: { restore: true } });
    await writeFile(modelsPath, original);
    await sdkAction(page, "models.refresh");
    await sdkAction(page, "model.set", {
      provider: initial.model!.provider,
      id: initial.model!.id,
    });
    await sdkAction(page, "theme.set", { theme: "light" });
    await page.evaluate(async () => {
      const path = "/src/i18n.ts";
      (await import(path)).setLocale("zh-CN");
    });
  }
});
