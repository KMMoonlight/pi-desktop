import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyTranscriptMarkdown(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(initial.agentDir, "desktop", "transcript-markdown");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "settings.mjs");
  await cp(
    new URL("./fixtures/transcript-settings.mjs", import.meta.url),
    path,
  );
  const settings = (mode: string) =>
    sdkAction(page, "sdk.run", { path, args: { mode } });
  const assistant = page.locator(".message-assistant").last();
  const diagram = assistant.locator(".desktop-markdown-preformatted");
  try {
    await settings("final");
    await sdkAction(page, "display.thinking", { visible: false });
    await sdkAction(page, "prompt", { message: "transcript-mermaid-probe" });
    await expect(
      assistant.getByRole("heading", {
        name: "Transformed transcript",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      assistant.locator('code[data-language="mermaid"]'),
    ).toBeVisible();
    await expect(diagram).toHaveCount(0);
    await expect(diagram).toHaveCount(1);
    await expect(
      assistant.getByText("Final tail.", { exact: true }),
    ).toBeVisible();
    await expect(
      assistant.getByText("Mermaid before extensions.", { exact: true }),
    ).toBeVisible();
    await expect(
      assistant.getByText("Transformed transcript", { exact: true }),
    ).toHaveCSS("color", "rgb(18, 130, 90)");
    await expect(diagram).toContainText("Alpha");
    await expect(diagram).toContainText("Beta");
    await expect(diagram).toHaveCSS("white-space", "pre");
    await expect(assistant).not.toContainText("\x1b");
    const rows = await diagram.evaluate((element) => ({
      text: element.textContent,
      family: getComputedStyle(element).fontFamily,
      colored: [...element.querySelectorAll("span")].some(
        (span) => !!span.style.color,
      ),
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(rows.text?.split("\n").length).toBeGreaterThan(2);
    expect(rows.family).toContain("monospace");
    expect(rows.colored).toBe(true);
    expect(rows.scrollWidth).toBeLessThanOrEqual(rows.width + 1);
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(
      snapshot.messages.at(-1)?.content.find((block) => block.type === "text")
        ?.text,
    ).toContain("transcript-fail");
    const thinking = assistant.locator(".thinking-block");
    await thinking.locator("summary").click();
    await expect(
      thinking.getByText("First reasoning.", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await page.reload();
    await expect(diagram).toHaveCount(1);
    await expect(thinking).toHaveAttribute("open", "");
    await expect(
      assistant.getByRole("button", { name: "复制消息", exact: true }),
    ).toHaveCount(1);
    await expect(
      page
        .locator(".message-user")
        .getByRole("button", { name: "从此处分支", exact: true }),
    ).toHaveCount(1);
    await settings("off");
    await expect(diagram).toHaveCount(0);
    await expect(
      assistant.locator('code[data-language="mermaid"]'),
    ).toBeVisible();
    await settings("streaming");
    await expect(diagram).toHaveCount(1);
    await sdkAction(page, "session.new");
    await sdkAction(page, "prompt", { message: "transcript-mermaid-probe" });
    await expect(diagram).toHaveCount(1);
    expect(
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).streaming,
    ).toBeDefined();
    await expect(
      assistant.getByText("Final tail.", { exact: true }),
    ).toBeVisible();
    const final = await sdkAction<DesktopSnapshot>(page, "snapshot");
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.switch", { path: final.sessionFile });
    await expect(diagram).toHaveCount(1);
    await settings("off");
    await sdkAction(page, "resources.reload");
    await expect(
      assistant.locator('code[data-language="mermaid"]'),
    ).toBeVisible();
    await settings("streaming");
    await expect(diagram).toHaveCount(1);
  } finally {
    await settings(String(initial.settings.mermaid ?? "streaming"));
    await sdkAction(page, "display.thinking", {
      visible: initial.settings.hideThinkingBlock !== true,
    });
  }
}
