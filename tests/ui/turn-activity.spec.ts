import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import { selectField } from "../select-field.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const width of [1440, 390]) {
  test(`live tool activity and its elapsed footer remain visible at ${width}px`, async ({ page }) => {
    await mkdir(".local/turn-activity", { recursive: true });
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    const backdrop = page.getByRole("button", { name: "关闭侧边栏遮罩", exact: true });
    if (await backdrop.isVisible()) await backdrop.click({ position: { x: width - 5, y: 500 } });
    await sdkAction(page, "session.new");
    try {
      await sdkAction(page, "prompt", { message: "tool-timer-abort-probe" });
      await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).activeTools.length).toBe(1);
      const activity = page.locator(".assistant-reply .tool-execution:visible");
      const footer = page.locator(".run-indicator");
      await expect(activity).toHaveCount(1);
      for (const theme of ["light", "dark"]) {
        await sdkAction(page, "theme.set", { theme });
        await expect(footer.locator(".pi-loading")).toBeVisible();
        await expect(footer.locator(".generation-status")).toContainText("用时");
        await expect(footer).toBeInViewport();
        const activityBox = (await activity.boundingBox())!;
        expect((await footer.boundingBox())!.y).toBeGreaterThanOrEqual(activityBox.y + activityBox.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `.local/turn-activity/running-tool-${width}-${theme}.png` });
      }
    } finally {
      await sdkAction(page, "abort");
      await sdkAction(page, "theme.set", { theme: "light" });
    }
  });
}

test("reply elapsed time advances during silent commands and freezes on completion or abort", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  const elapsed = page.locator(".transcript .generation-status").last().locator(":scope > span").first();
  const seconds = async () => Number((await elapsed.textContent())?.match(/用时 ([\d.]+) 秒/)?.[1]);
  for (const mode of ["complete", "abort"]) {
    const previous = await page.locator(".assistant-reply .message-heading").allTextContents();
    await editor.fill(`tool-timer-${mode}-probe`);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).activeTools.some(tool => tool.name === "bash")).toBe(true);
    await expect(elapsed).toContainText(/用时 [\d.]+ 秒/);
    const started = await seconds();
    await expect(page.locator(".assistant-reply").last().locator(".message-heading")).toHaveCount(0);
    await expect(page.locator(".run-indicator .pi-loading")).toBeVisible();
    await expect(page.locator(".run-indicator .generation-status > span")).toHaveCount(1);
    const activityBox = await page.locator(".tool-execution:visible").last().boundingBox();
    const elapsedBox = await elapsed.boundingBox();
    expect(elapsedBox!.y).toBeGreaterThanOrEqual(activityBox!.y + activityBox!.height);
    await expect.poll(seconds, { intervals: [100] }).toBeGreaterThan(started + 0.4);
    const duringTool = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(duringTool.streaming).toBeUndefined();
    expect(duringTool.activeTools.some(tool => tool.name === "bash")).toBe(true);
    expect((await page.locator(".assistant-reply .message-heading").allTextContents()).slice(0, previous.length)).toEqual(previous);
    if (mode === "abort") {
      const beforeQueue = await seconds();
      await sdkAction(page, "prompt", {
        message: "queued message must not stop the current reply clock",
        files: ["test-note.txt"], mode: "followUp",
      });
      await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).queue.followUp.length).toBe(1);
      await expect.poll(seconds, { intervals: [100] }).toBeGreaterThan(beforeQueue + 0.4);
      await expect(page.locator(".assistant-reply").last().locator(".message-heading")).toHaveCount(0);
      await sdkAction(page, "queue.clear");
    }
    if (mode === "abort") await page.getByRole("button", { name: "停止任务", exact: true }).click();
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
    await expect(page.locator(".run-indicator")).toHaveCount(0);
    await expect(page.locator(".assistant-reply").last().locator(".message-heading")).toHaveCount(1);
    const stopped = await seconds();
    expect(stopped).toBeGreaterThanOrEqual(started + 0.4);
    const frozen = await elapsed.textContent();
    // Wait through several local timer ticks to ensure the completed metric stops.
    await page.waitForTimeout(400);
    await expect(elapsed).toHaveText(frozen!);
    await page.reload();
    await editor.waitFor();
    await expect(elapsed).toContainText(/用时 [\d.]+ 秒/);
    expect(Math.abs(await seconds() - stopped)).toBeLessThanOrEqual(0.3);
  }
});

test("one composer action switches between submit and stop, and running delivery is a saved setting", async ({
  page,
}) => {
  await mkdir(".local/turn-activity", { recursive: true });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  const action = page.locator("[data-composer-action]");
  await expect(action).toHaveCount(1);
  await expect(action).toHaveAttribute("aria-label", "发送消息");
  await expect(action).toBeDisabled();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "常规", exact: true }).click();
  await selectField(
    settings.getByRole("combobox", { name: "运行中发送消息", exact: true }),
    "followUp",
  );
  await page.screenshot({ path: ".local/turn-activity/settings.png" });
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.reload();
  await editor.waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    settings.getByRole("combobox", { name: "运行中发送消息", exact: true }),
  ).toContainText("排队");
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await editor.fill("application-status-gate");
  await action.click();
  await expect(action).toHaveAttribute("aria-label", "停止任务");
  await expect(action).toBeEnabled();
  await expect(
    page
      .locator(".composer")
      .getByRole("combobox", { name: "消息交付方式", exact: true }),
  ).toHaveCount(0);
  const box = await action.boundingBox();
  await editor.fill("补充要求");
  await expect(action).toHaveAttribute("aria-label", "发送消息");
  expect(await action.boundingBox()).toEqual(box);
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.postDataJSON()?.action === "prompt",
  );
  await action.click();
  expect((await submitted).postDataJSON().args.mode).toBe("followUp");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).queue.followUp,
    )
    .toEqual(["补充要求"]);
  await expect(action).toHaveAttribute("aria-label", "停止任务");
  await editor.fill(" ");
  await expect(action).toHaveAttribute("aria-label", "停止任务");
  await action.click();
  await expect
    .poll(
      async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).running,
    )
    .toBe(false);
  await expect(action).toHaveAttribute("aria-label", "发送消息");
});

test("multiple reasoning records and tool results form one compact reply and survive history reload", async ({
  page,
}) => {
  await mkdir(".local/turn-activity", { recursive: true });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "display.tools", { expanded: false });
  await sdkAction(page, "display.thinking", { visible: true });
  await editor.fill("activity-loop-probe 检查项目文件");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.locator(".transcript").evaluate(node => {
    const transcript = node as HTMLElement;
    transcript.dataset.maxLiveActivities = "0";
    new MutationObserver(() => {
      if (!transcript.querySelector(".run-indicator")) return;
      const visible = [...transcript.querySelectorAll(".assistant-reply .thinking-block, .assistant-reply .tool-execution")]
        .filter(item => item.getBoundingClientRect().height > 0).length;
      transcript.dataset.maxLiveActivities = String(Math.max(visible, Number(transcript.dataset.maxLiveActivities)));
    }).observe(transcript, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "open", "class"] });
  });
  const reply = page.locator(".assistant-reply");
  await expect(reply).toHaveCount(1);
  const group = reply.locator(".process-group");
  await expect(group).toHaveAttribute("open", "");
  await expect(group.locator(":scope > summary")).toBeHidden();
  await expect(reply.locator(".thinking-block:visible")).toHaveCount(1);
  await expect(reply.locator(".thinking-block:visible > summary")).toHaveText("思考过程");
  await expect(reply.locator(".thinking-block:visible")).not.toHaveAttribute("open");
  await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).streaming?.content
    .find(block => block.type === "thinking")?.thinking ?? "").toContain("继续检查路径");
  await expect(reply.locator(".tool-execution:visible")).toHaveCount(0);
  await expect(page.locator(".run-indicator .generation-status")).toContainText("用时");
  await page.screenshot({ path: ".local/turn-activity/running-current-only.png" });
  await expect(reply).toContainText("已完成检查。");
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  await expect(page.locator(".transcript")).toHaveAttribute("data-max-live-activities", "1");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(
    snapshot.messages.filter((message) => message.role === "assistant"),
  ).toHaveLength(3);
  expect(
    snapshot.messages.filter((message) => message.role === "toolResult"),
  ).toHaveLength(3);
  await expect(reply.locator(".message-heading")).toHaveCount(1);
  await expect(reply.locator(".message-heading")).toContainText("用时");
  await expect(reply.locator(".message-heading")).toContainText("100 tokens");
  await expect(reply.locator(".message-meta")).toHaveCount(1);
  await expect(
    reply.getByRole("button", { name: "复制消息", exact: true }),
  ).toHaveCount(1);
  await expect(reply.locator(".process-group")).toHaveCount(1);
  await expect(reply.locator(".process-count")).toHaveText("3 次工具调用");
  await expect(group).not.toHaveAttribute("open");
  await page.screenshot({ path: ".local/turn-activity/completed-collapsed.png" });
  await group.locator(":scope > summary").click();
  await expect(group).toHaveAttribute("open", "");
  await expect(reply.locator(".tool-execution")).toHaveCount(3);
  await expect(reply.locator('.tool-execution[data-tool-expanded="true"]')).toHaveCount(0);
  await expect(reply.locator(".thinking-block")).toHaveCount(3);
  await expect(reply.locator(".thinking-block[open]")).toHaveCount(0);
  const failed = reply.locator('.tool-execution[data-tool-state="error"]');
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText("missing-note.txt");
  await expect(failed.locator(".tool-body")).toBeHidden();
  await expect(failed.locator(".tool-chevron")).toHaveCSS("transform", "matrix(0, -1, 1, 0, 0, 0)");
  await failed.getByRole("button", { name: "展开 read 输出", exact: true }).click();
  await expect(failed.locator(".tool-body")).toBeVisible();
  await expect(failed.locator(".tool-chevron")).toHaveCSS("transform", "none");
  await sdkAction(page, "snapshot");
  await expect(failed.locator(".tool-body")).toBeVisible();
  // The error uses the same subtle outline as the other output, without a side stripe.
  const borders = await failed.locator(".tool-body").evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.borderTopWidth, style.borderLeftWidth];
  });
  expect(borders[0]).toBe(borders[1]);
  const success = reply
    .locator('.tool-execution[data-tool-state="success"]')
    .first();
  await expect(success.locator(".tool-body")).toBeHidden();
  await success
    .getByRole("button", { name: "展开 read 输出", exact: true })
    .click();
  await expect(success.locator(".tool-body")).toBeVisible();
  await expect(success).toContainText("Real file attachment content.");
  await success
    .getByRole("button", { name: "收起 read 输出", exact: true })
    .click();
  await expect(success.locator(".tool-body")).toBeHidden();
  const left = await reply.locator(".process-group > summary, .tool-desktop-controls, .thinking-block > summary").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().left));
  expect(Math.max(...left) - Math.min(...left)).toBeLessThan(1);
  await expect(reply.getByRole("heading", { name: "已完成检查。", exact: true })).toBeVisible();
  expect(snapshot.messages.at(-1)?.content.find(block => block.type === "text")?.text).toContain("### 已完成检查。");
  const divider = reply.locator("hr");
  const dividerColor = await divider.evaluate(node => getComputedStyle(node).borderTopColor);
  expect(dividerColor).not.toBe("rgb(0, 0, 0)");
  expect(dividerColor).not.toBe("rgb(24, 24, 24)");
  await expect(divider).toHaveCSS("border-top-width", "1px");
  await page.locator(".transcript").evaluate(node => { node.scrollTop = 0; });
  await page.mouse.move(4, 4);
  await page.screenshot({ path: ".local/turn-activity/desktop-light.png" });
  await sdkAction(page, "theme.set", { theme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: ".local/turn-activity/desktop-dark.png" });
  await page.reload();
  await expect(reply).toHaveCount(1);
  await expect(reply.locator(".tool-execution")).toHaveCount(0);
  await expect(reply).toContainText("已完成检查。");
  await expect(reply.locator(".thinking-block[open]")).toHaveCount(0);
  await expect(reply.locator(".message-heading")).toContainText("用时");
  await expect(group).not.toHaveAttribute("open");
  await group.locator(":scope > summary").click();
  await expect(group).toHaveAttribute("open", "");
  await expect(reply.locator(".tool-execution")).toHaveCount(3);
  await expect(failed.locator(".tool-body")).toBeVisible();
  await group.locator(":scope > summary").click();
  await expect(group).not.toHaveAttribute("open");
  await expect(reply.locator(".message-body > .markdown")).toContainText(
    "已完成检查。",
  );
  await reply.getByRole("heading", { name: "已完成检查。", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".local/turn-activity/markdown-dark.png" });
  await sdkAction(page, "theme.set", { theme: "light" });
  await page.screenshot({ path: ".local/turn-activity/markdown-light.png" });
});
