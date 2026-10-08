import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("reply details align without a side border, reveal footer timestamps on hover, auto-collapse completed thinking, and accumulate session tokens", async ({
  page,
}) => {
  await mkdir(".local/reply-details", { recursive: true });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "display.thinking", { visible: true });
  const totals = page.locator(".composer-usage .session-token-usage");
  await expect(totals).toHaveText("↑ 0↓ 0tokens");
  await editor.fill("reply-polish-probe 请调整界面");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const streamingThinking = page.locator(".message-assistant .thinking-block").last();
  await expect(streamingThinking).toHaveAttribute("open", "");
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  const assistant = page.locator(".message-assistant").last();
  const thinking = assistant.locator(".thinking-block");
  await expect(thinking).not.toHaveAttribute("open");
  await expect(assistant.locator(".message-heading")).toContainText("用时");
  await expect(
    assistant.locator(".message-meta .message-timestamp"),
  ).toHaveText(/\d{4}.*\d{2}:\d{2}:\d{2}/);
  await expect(
    assistant.locator(".message-heading .message-timestamp svg"),
  ).toHaveCount(0);
  await expect(
    assistant.locator(".message-heading .message-timestamp"),
  ).toHaveCount(0);
  await expect(
    assistant.locator(".message-body > .generation-status"),
  ).toHaveCount(0);
  await expect(totals).toHaveText("↑ 1.5k↓ 2.8ktokens");
  await expect(totals).toHaveAttribute(
    "aria-label",
    "累计输入 1500 tokens，输出 2800 tokens",
  );
  const first = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(first.stats.tokens.cacheRead).toBe(400);
  const user = page.locator(".message-user").last();
  for (const message of [user, assistant]) {
    const meta = message.locator(".message-meta");
    const time = meta.locator(".message-timestamp");
    const copy = meta.getByRole("button", { name: "复制消息", exact: true });
    await page.mouse.move(4, 4);
    await editor.blur();
    await expect(meta).toHaveCSS("opacity", "0");
    await message.locator(".message-body .markdown").hover();
    await expect(meta).toHaveCSS("opacity", "1");
    const timeBox = (await time.boundingBox())!;
    const copyBox = (await copy.boundingBox())!;
    expect(timeBox.x + timeBox.width).toBeLessThanOrEqual(copyBox.x);
    await copy.hover();
    await expect(meta).toHaveCSS("opacity", "1");
    await page.mouse.move(4, 4);
    await expect(meta).toHaveCSS("opacity", "0");
  }
  // A completed reply stays manually expandable across snapshot/layout updates.
  await thinking.locator("summary").click();
  await expect(thinking).toHaveAttribute("open", "");
  for (const size of [
    { width: 1440, height: 940 },
    { width: 1024, height: 768 },
    { width: 760, height: 760 },
  ]) {
    await page.setViewportSize(size);
    const close = page.getByRole("button", { name: "收起侧边栏", exact: true });
    if (size.width < 800 && (await close.isVisible())) await close.click();
    for (const theme of ["light", "dark"]) {
      await sdkAction(page, "theme.set", { theme });
      expect(
        await thinking.evaluate(
          (node) => getComputedStyle(node).borderLeftWidth,
        ),
      ).toBe("0px");
      const geometry = await assistant.evaluate((node) => {
        const inset = (element: Element) =>
          element.getBoundingClientRect().left +
          parseFloat(getComputedStyle(element).paddingLeft);
        const heading = node.querySelector(".message-heading")!;
        const summary = node.querySelector(".thinking-block summary")!;
        const thought = node.querySelector(
          ".thinking-block .transcript-markdown-body",
        )!;
        const reply = node.querySelector(".message-body > .markdown")!;
        const actions = node.querySelector(".message-meta")!;
        return {
          left: [heading, summary, thought, reply, actions].map(inset),
          headingBottom: heading.getBoundingClientRect().bottom,
          bodyTop: node.querySelector(".message-body")!.getBoundingClientRect()
            .top,
        };
      });
      expect(
        Math.max(...geometry.left) - Math.min(...geometry.left),
      ).toBeLessThan(1);
      expect(geometry.headingBottom).toBeLessThanOrEqual(geometry.bodyTop);
      await expect(totals).toBeInViewport();
      await page.mouse.move(4, 4);
      await expect(assistant.locator(".message-meta")).toHaveCSS("opacity", "0");
      await assistant.locator(".message-body > .markdown").hover();
      await expect(assistant.locator(".message-meta")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: `.local/reply-details/hover-${size.width}-${theme}.png` });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator(".transcript").evaluate(node => { node.scrollTop = 0; });
      await page.mouse.move(4, 4);
      await page.screenshot({
        path: `.local/reply-details/${size.width}-${theme}.png`,
      });
    }
  }
  await thinking.locator("summary").click();
  await expect(thinking).not.toHaveAttribute("open");
  await thinking.locator("summary").click();
  await expect(thinking).toHaveAttribute("open", "");
  const firstAssistant = page.locator(".message-assistant").first();
  await editor.fill("reply-polish-probe 继续");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(totals).toHaveText("↑ 3k↓ 5.6ktokens");
  await expect(page.locator(".message-assistant").last().locator(".thinking-block")).not.toHaveAttribute("open");
  await expect(firstAssistant.locator(".thinking-block")).toHaveAttribute("open", "");
  await sdkAction(page, "session.new");
  await expect(totals).toHaveText("↑ 0↓ 0tokens");
  await sdkAction(page, "session.switch", { path: first.sessionFile });
  await expect(totals).toHaveText("↑ 3k↓ 5.6ktokens");
  await page.reload();
  await expect(totals).toHaveText("↑ 3k↓ 5.6ktokens");
  await sdkAction(page, "theme.set", { theme: "light" });
});
