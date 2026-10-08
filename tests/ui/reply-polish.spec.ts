import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { sdkAction } from "../editor-workflows";
import type { DesktopSnapshot } from "../../shared/types";

test.beforeEach(async ({ page }) => {
  await mkdir(".local/reply-polish", { recursive: true });
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await expect
    .poll(
      async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).changing,
    )
    .toBe(false);
  await sdkAction(page, "session.new");
});

test("output rate is live-only while transcript keeps elapsed time and token usage", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(page.locator(".composer-usage .generation-status")).toHaveCount(0);
  await editor.fill("streaming-metrics-probe");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".composer-usage .generation-status")).toContainText(
    "tok/s",
  );
  await expect(page.locator(".header-tools .status-tag.running")).toHaveText(
    "执行中",
  );
  await expect(page.locator(".transcript")).not.toContainText("tok/s");
  await page.screenshot({ path: ".local/reply-polish/streaming.png" });
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  await expect(page.locator(".composer-usage .generation-status")).toHaveCount(0);
  await expect(page.locator(".header-tools .status-tag.running")).toHaveCount(0);
  const metrics = page.locator(".message-assistant .generation-status").last();
  await expect(metrics).toContainText(/用时 [\d.]+ 秒/);
  await expect(metrics).toContainText("12 tokens");
  await page.screenshot({ path: ".local/reply-polish/completed.png" });
  await editor.fill("streaming-metrics-probe");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".composer-usage .generation-status")).toContainText(
    "tok/s",
  );
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await expect(page.locator(".composer-usage .generation-status")).toHaveCount(0);
  await expect(
    page.locator(".message-assistant .generation-status").last(),
  ).toContainText("用时");
});

test("live output rate remains visible when the provider reports usage only on completion", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  for (const abort of [false, true]) {
    await editor.fill("streaming-final-usage-probe");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const rate = page.locator(".composer-usage .generation-status");
    await expect(rate).toContainText(/≈\s*[\d.]+ tok\/s/);
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(snapshot.streaming?.generation?.outputTokens).toBe(0);
    await expect(page.locator(".transcript")).not.toContainText("tok/s");
    if (abort) await page.getByRole("button", { name: "停止任务", exact: true }).click();
    else {
      await page.screenshot({ path: ".local/reply-polish/estimated-streaming.png" });
      await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
      await expect(page.locator(".message-assistant .generation-status").last()).toContainText("12 tokens");
    }
    await expect(rate).toHaveCount(0);
  }
});

test("pasted images enlarge before and after sending and close accessibly", async ({
  page,
}) => {
  const data = (await readFile("src-tauri/icons/icon.png")).toString("base64");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.evaluate((node, data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([bytes], "pasted-image.png", { type: "image/png" }),
    );
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, data);
  const thumbnail = page.getByRole("button", {
    name: "放大查看 pasted-image.png",
    exact: true,
  });
  await thumbnail.click();
  const preview = page.getByRole("dialog", { name: "图片预览", exact: true });
  await expect(preview.getByRole("img")).toHaveAttribute(
    "src",
    `data:image/png;base64,${data}`,
  );
  expect((await preview.getByRole("img").boundingBox())!.width).toBeGreaterThan(
    24,
  );
  await page.screenshot({
    path: ".local/reply-polish/image-draft-preview.png",
  });
  await sdkAction(page, "theme.set", { theme: "dark" });
  await page.setViewportSize({ width: 760, height: 580 });
  await expect(preview).toBeInViewport({ ratio: 1 });
  await expect(preview.getByRole("img")).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: ".local/reply-polish/image-preview-dark-small.png",
  });
  await sdkAction(page, "theme.set", { theme: "light" });
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  await editor.fill("Check this pasted image");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const sentImage = page.getByRole("button", {
    name: "放大查看 消息附件",
    exact: true,
  });
  await sentImage.click();
  await expect(preview.getByRole("img")).toHaveAttribute(
    "src",
    `data:image/png;base64,${data}`,
  );
  await page.screenshot({ path: ".local/reply-polish/image-sent-preview.png" });
  await preview
    .getByRole("button", { name: "关闭图片预览", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  await sentImage.click();
  await page
    .locator("[data-modal-backdrop]")
    .click({ position: { x: 2, y: 2 } });
  await expect(preview).toHaveCount(0);
});

test("the taller composer remains usable in desktop windows and after a reply", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  for (const size of [
    { width: 1440, height: 940 },
    { width: 760, height: 580 },
  ]) {
    await page.setViewportSize(size);
    expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(96);
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeInViewport();
  }
  await editor.fill("short reply");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(false);
  expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(96);
  await page.screenshot({ path: ".local/reply-polish/composer-height.png" });
});
