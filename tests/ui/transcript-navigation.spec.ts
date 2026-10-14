import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

async function seed(page: Page, count: number, firstPrompt?: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(snapshot.agentDir, "desktop", "navigation-history.mjs");
  await writeFile(
    path,
    `export default ({session}) => {
    const usage = { input:1, output:1, cacheRead:0, cacheWrite:0, totalTokens:2, cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0} };
    for (let i = 0; i < ${count}; i++) {
      session.sessionManager.appendMessage({role:'user',content:i === 0 && ${JSON.stringify(firstPrompt ?? "")} ? ${JSON.stringify(firstPrompt ?? "")} : '第 '+i+' 轮：检查会话缩略导航和悬浮消息预览',timestamp:Date.now()});
      session.sessionManager.appendMessage({role:'assistant',content:[{type:'text',text:'回复 '+i+'：鼠标悬浮可以查看对应的会话内容。\\n\\n'+('这是一段用于检查历史定位与滚动的消息内容。\\n\\n'.repeat(12))}],api:'openai-completions',provider:'desktop-test',model:'desktop-test',stopReason:'stop',timestamp:Date.now(),usage});
    }
    session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
  };`,
  );
  await sdkAction(page, "sdk.run", { path });
  await expect(page.locator(".transcript-navigation-tick")).toHaveCount(count);
  return snapshot;
}

test("hover previews messages without moving the reader; clicking navigates and tracks the current turn", async ({
  page,
}) => {
  await seed(page, 8);
  const transcript = page.locator(".transcript");
  const ticks = page.locator(".transcript-navigation-tick");
  await expect(ticks.last()).toHaveAttribute("aria-current", "location");
  const top = await transcript.evaluate((element) => element.scrollTop);
  await ticks.nth(2).hover();
  const preview = page.getByRole("region", { name: "消息预览", exact: true });
  await expect(preview).toContainText("回复 2：");
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(top);
  await page.screenshot({
    path: ".local/transcript-navigation/hover.png",
    animations: "disabled",
  });
  await preview.hover();
  await page.mouse.wheel(0, 120);
  await expect(preview).toBeVisible();
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(top);
  await page.screenshot({
    path: ".local/transcript-navigation/preview-scroll.png",
  });
  await ticks.nth(2).click();
  await expect(ticks.nth(2)).toHaveAttribute("aria-current", "location");
  await expect(
    transcript.locator(".conversation-turn").nth(2),
  ).toBeInViewport();
  await expect(transcript).toHaveAttribute("data-follow-output", "false");
  await page.getByRole("button", { name: "回到最新消息", exact: true }).click();
  await expect(ticks.last()).toHaveAttribute("aria-current", "location");
  await expect(transcript).toHaveAttribute("data-follow-output", "true");
  await page.getByRole("textbox", { name: "消息", exact: true }).hover();
  await expect(preview).toHaveCount(0);
  await page.screenshot({ path: ".local/transcript-navigation/idle.png" });
});

test("the rail previews and opens unmounted history, supports keyboard navigation, and clears on session switch", async ({
  page,
}) => {
  const snapshot = await seed(page, 60);
  const ticks = page.locator(".transcript-navigation-tick");
  const target = page.locator(".conversation-turn").nth(20);
  await expect(target).toHaveAttribute("aria-busy", "true");
  await ticks.nth(20).hover();
  await expect(page.locator(".transcript-preview")).toContainText("回复 20：");
  await expect(target).toHaveAttribute("aria-busy", "true");
  await ticks.nth(20).click();
  await expect(target).toHaveAttribute("aria-busy", "false");
  await expect(target).toContainText("回复 20：");
  await expect
    .poll(() =>
      target.evaluate(
        (element) =>
          element.getBoundingClientRect().top -
          element.closest(".transcript")!.getBoundingClientRect().top,
      ),
    )
    .toBeGreaterThanOrEqual(0);
  await expect(ticks.nth(20)).toHaveAttribute("aria-current", "location");
  await ticks.nth(20).focus();
  await page.keyboard.press("ArrowUp");
  await expect(ticks.nth(19)).toBeFocused();
  await expect(page.locator(".transcript-preview")).toContainText("回复 19：");
  await page.keyboard.press("Enter");
  await expect(ticks.nth(19)).toHaveAttribute("aria-current", "location");
  await expect(target).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator(".transcript-preview")).toHaveCount(0);
  await sdkAction(page, "session.new");
  await expect(ticks).toHaveCount(0);
  await expect(page.locator(".transcript-preview")).toHaveCount(0);
  await sdkAction(page, "session.switch", { path: snapshot.sessionFile });
  await expect(ticks).toHaveCount(60);
  await expect(ticks.last()).toHaveAttribute("aria-current", "location");
  await expect(page.locator(".transcript")).toHaveAttribute(
    "data-follow-output",
    "true",
  );
});

test("previews fit light and dark compact windows and long questions remain readable", async ({
  page,
}) => {
  const question =
    "这是一条很长的提问，需要在消息预览里看到完整的内容，包括换行后的细节。\n" +
    "保留提问中的所有信息。".repeat(12);
  await seed(page, 3, question);
  await sdkAction(page, "theme.set", { theme: "dark" });
  await page.setViewportSize({ width: 760, height: 580 });
  const backdrop = page.getByRole("button", {
    name: "关闭侧边栏遮罩",
    exact: true,
  });
  if (await backdrop.isVisible())
    await backdrop.click({ position: { x: 755, y: 400 } });
  await page.locator(".transcript-navigation-tick").first().hover();
  const preview = page.locator(".transcript-preview");
  await expect(preview.locator(".transcript-preview-prompt")).toHaveText(
    question,
  );
  await expect(preview).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".transcript-navigation")).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({
    path: ".local/transcript-navigation/dark-compact.png",
  });
  await preview.locator(".transcript-preview-body").focus();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(
    page.locator(".transcript-navigation-tick").first(),
  ).toBeFocused();
});

test.beforeAll(async () => {
  await mkdir(".local/transcript-navigation", { recursive: true });
});
