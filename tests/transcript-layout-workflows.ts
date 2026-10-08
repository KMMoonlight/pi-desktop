import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

async function assertWidths(page: Page) {
  const paragraphs = page
    .locator(".transcript p")
    .filter({ hasText: /^Layout / });
  await expect(paragraphs).toHaveCount(3);
  await expect
    .poll(async () =>
      paragraphs.evaluateAll((elements) =>
        elements
          .map((element) => {
            const text = element.textContent!;
            const context = Number(/Layout [\w-]+: (\d+)/.exec(text)?.[1]);
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT,
            );
            let node: Node | null;
            while ((node = walker.nextNode())) {
              const index = node.textContent!.indexOf("0000000000");
              if (index < 0) continue;
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, index + 10);
              const cell = range.getBoundingClientRect().width / 10;
              const style = getComputedStyle(element);
              const width =
                element.getBoundingClientRect().width -
                parseFloat(style.paddingLeft) -
                parseFloat(style.paddingRight);
              return {
                role: /Layout ([\w-]+)/.exec(text)?.[1],
                context,
                actual: Math.max(1, Math.floor(width / cell)),
                width,
                cell,
              };
            }
            return { context, actual: -1 };
          })
          .filter((result) => result.context !== result.actual),
      ),
    )
    .toEqual([]);
  return paragraphs.allTextContents();
}

export async function verifyTranscriptLayout(page: Page, screenshot: string) {
  await page.addInitScript(() => {
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          if (
            !(window as unknown as { suspendTranscriptObservers?: boolean })
              .suspendTranscriptObservers
          )
            callback(entries, observer);
        });
      }
    };
  });
  await page.reload();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(initial.agentDir, "desktop", "transcript-layout");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "settings.mjs");
  await cp(
    new URL("./fixtures/transcript-settings.mjs", import.meta.url),
    path,
  );
  const settings = (padding: number) =>
    sdkAction(page, "sdk.run", { path, args: { padding, mode: "streaming" } });
  try {
    await settings(1);
    await sdkAction(page, "display.thinking", { visible: false });
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.fill("transcript-layout-probe");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const assistant = page.locator(".message-assistant").last();
    await expect(
      assistant.getByText("Completed layout.", { exact: true }),
    ).toBeVisible();
    await assistant.locator(".thinking-block summary").click();
    await assertWidths(page);
    await settings(0);
    const zero = await assertWidths(page);
    await settings(1);
    const one = await assertWidths(page);
    expect(zero).not.toEqual(one);
    await page.getByRole("button", { name: /^(收起|打开)检查器$/ }).click();
    // Overlay inspectors cover the transcript; measure it once uncovered.
    if (!(await page.getByRole("button", { name: "关闭检查器遮罩", exact: true }).isVisible()))
      await assertWidths(page);
    const closeInspector = page.getByRole("button", {
      name: "关闭检查器",
      exact: true,
    });
    if (await closeInspector.isVisible()) await closeInspector.click();
    await assertWidths(page);
    await page
      .locator(".chat-view")
      .evaluate((element) => ((element as HTMLElement).style.width = "340px"));
    await assertWidths(page);
    await expect(
      assistant.locator('code[data-language="mermaid"]'),
    ).toBeVisible();
    await page
      .locator(".chat-view")
      .evaluate((element) => ((element as HTMLElement).style.width = ""));
    await assertWidths(page);
    await page.reload();
    await assertWidths(page);
    await sdkAction(page, "session.new");
    await page.evaluate(() => {
      (
        window as unknown as { suspendTranscriptObservers: boolean }
      ).suspendTranscriptObservers = true;
      (document.querySelector(".chat-view") as HTMLElement).style.width =
        "340px";
    });
    await editor.fill("transcript-layout-probe");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(
      assistant.getByText("Completed layout.", { exact: true }),
    ).toBeVisible();
    await assistant.locator(".thinking-block summary").click();
    await assertWidths(page);
    await expect(
      assistant.locator('code[data-language="mermaid"]'),
    ).toBeVisible();
    await page.evaluate(
      () =>
        ((
          window as unknown as { suspendTranscriptObservers: boolean }
        ).suspendTranscriptObservers = false),
    );
    const font = await page.addStyleTag({
      content:
        ".chat-view .markdown {font-size: 17px} .chat-view .thinking-block {font-size: 15px}",
    });
    await assertWidths(page);
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await font.evaluate((element) => element.parentNode?.removeChild(element));
    await page
      .locator(".chat-view")
      .evaluate((element) => ((element as HTMLElement).style.width = ""));
    await assertWidths(page);
    const final = await sdkAction<DesktopSnapshot>(page, "snapshot");
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.switch", { path: final.sessionFile });
    await assistant.locator(".thinking-block summary").click();
    await assertWidths(page);
    expect(
      await sdkAction(page, "transcript.layout", {
        backendId: final.backendId,
        sessionId: "retired",
        widths: { text: 1, thinking: 1 },
      }),
    ).toEqual({ accepted: false });
    await assertWidths(page);
  } finally {
    if (!page.isClosed()) {
      await page.evaluate(
        () =>
          ((
            window as unknown as { suspendTranscriptObservers: boolean }
          ).suspendTranscriptObservers = false),
      );
      await settings(initial.settings.outputPad === 0 ? 0 : 1);
      await sdkAction(page, "display.thinking", {
        visible: initial.settings.hideThinkingBlock !== true,
      });
    }
  }
}
