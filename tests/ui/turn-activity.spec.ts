import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import { selectField } from "../select-field.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

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
  const reply = page.locator(".assistant-reply");
  await expect(reply).toHaveCount(1);
  const group = reply.locator(".process-group");
  await expect(group).toHaveAttribute("open", "");
  const firstTool = reply.locator('.tool-execution[data-tool-state="success"]').first();
  await firstTool.getByRole("button", { name: "展开 read 输出", exact: true }).click();
  await expect(firstTool.locator(".tool-body")).toBeVisible();
  await expect(reply).toContainText("已完成检查。");
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
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
  await expect(reply.locator(".tool-execution")).toHaveCount(3);
  await expect(reply).toContainText("已完成检查。");
  await expect(reply.locator(".thinking-block[open]")).toHaveCount(0);
  await expect(reply.locator(".message-heading")).toContainText("用时");
  await expect(group).not.toHaveAttribute("open");
  await group.locator(":scope > summary").click();
  await expect(group).toHaveAttribute("open", "");
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
