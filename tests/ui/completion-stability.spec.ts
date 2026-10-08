import { test, expect } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const size of [
  { width: 1440, height: 940 },
  { width: 1024, height: 640 },
])
  test(`command and skill menus preserve transcript geometry and scroll position in every frame at ${size.width}px`, async ({
    page,
  }) => {
    await mkdir(".local/completion-stability", { recursive: true });
    await page.setViewportSize(size);
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.waitFor();
    await sdkAction(page, "session.new");
    const { agentDir } = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const skillDir = join(agentDir, "skills", "stable-completion");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: stable-completion\ndescription: Verify stable completion layout.\n---\n\nFixture.\n",
    );
    const seed = join(agentDir, "desktop", "completion-history.mjs");
    await writeFile(
      seed,
      `export default ({session}) => {
    session.sessionManager.appendMessage({ role: "user", content: "Layout fixture", timestamp: Date.now() });
    session.sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: Array.from({length: 32}, (_, i) => "### Section " + i + "\\n\\nParagraph of conversation text with **bold** and a [link](https://example.com).\\n\\n- First item\\n- Second item").join("\\n\\n") }], api: "openai-completions", provider: "desktop-test", model: "desktop-test", stopReason: "stop", timestamp: Date.now(), usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input:0,output:0,cacheRead:0,cacheWrite:0,total:0}} });
    session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
  };`,
    );
    try {
      await sdkAction(page, "resources.reload");
      await sdkAction(page, "sdk.run", { path: seed });
      await expect(page.locator(".assistant-reply")).toContainText(
        "Section 31",
      );
      await editor.fill("draft");
      await editor.focus();
      await page.locator(".transcript").evaluate((node) => {
        node.scrollTop = node.scrollHeight - node.clientHeight - 60;
      });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.evaluate(() => {
        const selectors = [
          ".transcript",
          ".transcript-inner",
          ".assistant-reply",
          ".composer",
          ".composer textarea",
        ];
        const elements = selectors.map((selector) =>
          document.querySelector<HTMLElement>(selector)!,
        );
        const initial = elements.map((node) => node.getBoundingClientRect());
        const transcript = elements[0];
        const scrollTop = transcript.scrollTop;
        const content = elements[2].querySelector(".message-body")!.innerHTML;
        const probe = {
          active: true,
          samples: [] as {
            shift: number;
            scroll: number;
            replaced: boolean;
            changed: boolean;
          }[],
        };
        (window as any).completionProbe = probe;
        const sample = () => {
          const shift = Math.max(
            ...elements.map((node, index) => {
              const current = node.getBoundingClientRect(),
                before = initial[index];
              return Math.max(
                Math.abs(current.x - before.x),
                Math.abs(current.y - before.y),
                Math.abs(current.width - before.width),
                Math.abs(current.height - before.height),
              );
            }),
          );
          probe.samples.push({
            shift,
            scroll: Math.abs(transcript.scrollTop - scrollTop),
            replaced: elements.some((node) => !node.isConnected),
            changed:
              elements[2].querySelector(".message-body")!.innerHTML !== content,
          });
          if (probe.active) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const list = page.locator(".desktop-completion");
      for (const query of ["/", "/skill:stable", "/", "/skill:stable"]) {
        await editor.fill(query);
        await expect(list).toBeVisible();
        await editor.press("ArrowDown");
        await page.screenshot({
          path: `.local/completion-stability/${query.includes("skill") ? "skill" : "command"}-${size.width}.png`,
        });
        await editor.press("Escape");
        await expect(list).toHaveCount(0);
      }
      await editor.fill("draft");
      for (const query of ["stable-completion", "new"]) {
        await page
          .getByRole("button", { name: "添加上下文", exact: true })
          .click();
        const menu = page.getByRole("dialog", {
          name: "添加上下文",
          exact: true,
        });
        await expect(menu).toBeVisible();
        await menu.getByRole("textbox", { name: "搜索技能与命令" }).fill(query);
        await page.screenshot({
          path: `.local/completion-stability/context-${query}-${size.width}.png`,
        });
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
      }
      const samples = await page.evaluate(() => {
        const probe = (window as any).completionProbe;
        probe.active = false;
        return probe.samples;
      });
      await writeFile(
        `.local/completion-stability/frames-${size.width}.json`,
        JSON.stringify(samples),
      );
      expect(samples.length).toBeGreaterThan(5);
      expect(Math.max(...samples.map((s: any) => s.shift))).toBeLessThanOrEqual(
        1,
      );
      expect(
        Math.max(...samples.map((s: any) => s.scroll)),
      ).toBeLessThanOrEqual(1);
      expect(samples.some((s: any) => s.replaced || s.changed)).toBe(false);
      // New conversation content must still follow normally after menu activity.
      await editor.fill("streaming-metrics-probe");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect(page.locator(".composer-usage .generation-status")).toContainText(
        "tok/s",
      );
      await expect
        .poll(async () =>
          page
            .locator(".transcript")
            .evaluate(
              (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
            ),
        )
        .toBeLessThanOrEqual(1);
      await expect
        .poll(
          async () =>
            (await sdkAction<DesktopSnapshot>(page, "snapshot")).running,
        )
        .toBe(false);
      await expect
        .poll(async () =>
          page
            .locator(".transcript")
            .evaluate(
              (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
            ),
        )
        .toBeLessThanOrEqual(1);
    } finally {
      await rm(skillDir, { recursive: true, force: true });
      await sdkAction(page, "resources.reload");
    }
  });

test("provider status hides internal credential metadata and icon help remains available", async ({
  page,
}) => {
  await mkdir(".local/completion-stability", { recursive: true });
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "设置", exact: true });
  await modal.getByRole("button", { name: "模型与账号", exact: true }).click();
  const provider = modal
    .locator(".provider-row:has(.provider-dot.connected)")
    .first();
  const status = provider.getByText("凭据已配置", { exact: true });
  await status.hover();
  await expect(status).not.toHaveAttribute("aria-describedby");
  await expect(status).not.toHaveAttribute("tabindex");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.screenshot({
    path: ".local/completion-stability/provider-status.png",
  });
  const logout = provider.getByRole("button", { name: /^退出 / });
  await logout.hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    (await logout.getAttribute("aria-label")) as string,
  );
});
