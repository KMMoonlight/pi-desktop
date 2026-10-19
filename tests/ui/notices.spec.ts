import { test, expect, type Page } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

// Headless Chromium hides scrollbars by default; visual QA must include them.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

for (const width of [1440, 390])
  test(`Pi notifications retain styled text and semantic links at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "prompt", { message: "/notice-probe" });
    const notice = page
      .locator(".notice")
      .filter({ hasText: "Notice probe" })
      .last();
    await expect(notice).toHaveText("Notice probe: Open reference");
    await expect(
      notice.getByRole("link", { name: "Open reference" }),
    ).toHaveAttribute("href", "https://example.invalid/notice");
    expect(
      await notice
        .getByText("Notice probe", { exact: true })
        .evaluate((element) => getComputedStyle(element).color),
    ).not.toBe(
      await notice.evaluate((element) => getComputedStyle(element).color),
    );
    const bounds = await notice.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(80);
    expect(bounds!.y).toBeLessThan(100);
    await expect
      .poll(async () => {
        const current = (await notice.boundingBox())!;
        return width - current.x - current.width;
      })
      .toBeGreaterThanOrEqual(16);
    expect(width - bounds!.x - bounds!.width).toBeLessThan(24);
    expect(bounds!.width).toBeLessThanOrEqual(400);
    expect(bounds!.x).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: `.local/screenshots/notices-${width}.png` });
    await notice.getByRole("button", { name: "关闭通知", exact: true }).click();
    await expect(notice).toHaveCount(0);
  });

for (const width of [1440, 390])
  for (const theme of ["light", "dark"])
    test(`retry notifications keep diagnostics behind details at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.emulateMedia({
        colorScheme: theme === "dark" ? "dark" : "light",
      });
      await page.goto("/");
      await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
      await sdkAction(page, "theme.set", { theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text: string) => {
              (window as unknown as { copiedNotice: string }).copiedNotice =
                text;
            },
          },
        });
      });
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      const emit = (event: Record<string, unknown>) =>
        sdkAction(page, "sdk.run", {
          path: `${snapshot.agentDir}/desktop/notice-events.mjs`,
          args: { event },
        });
      const errorMessage = `503 ${JSON.stringify({
        type: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/",
        title: "Error 1102: Worker exceeded resource limits",
        status: 503,
        detail:
          "A Worker script configured by the website owner exceeded its resource limits (CPU time or memory) and was terminated.",
        instance: "a4b666ad9a46766d",
        error_code: 1102,
        error_name: "worker_exceeded_resources",
        error_category: "worker",
        ray_id: "a4b666ad9a46766d",
        timestamp: "2026-10-16T10:33:44Z",
        zone: "api.example.invalid",
        retryable: false,
        owner_action_required: true,
      })}`;
      await emit({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 3000,
        errorMessage,
      });
      const notice = page.locator(".notice-warning");
      await expect(notice).toHaveCount(1);
      await expect(
        notice.getByText("服务暂时不可用", { exact: true }),
      ).toBeVisible();
      await expect(notice.getByText("HTTP 503", { exact: true })).toBeVisible();
      await expect(
        notice.getByText("正在自动重试（1/3）", { exact: true }),
      ).toBeVisible();
      const details = notice.locator(".notice-diagnostics");
      await expect(details).toBeHidden();
      const bounds = (await notice.boundingBox())!;
      expect(bounds.height).toBeLessThan(140);
      expect(bounds.width).toBeLessThanOrEqual(400);
      expect(bounds.x).toBeGreaterThanOrEqual(16);
      await page.screenshot({
        path: `.local/screenshots/retry-${theme}-${width}.png`,
        animations: "disabled",
      });
      await notice
        .getByRole("button", { name: "查看详情", exact: true })
        .click();
      await expect(details).toBeVisible();
      await expect(details).toHaveText(`重试 1/3：${errorMessage}`);
      expect((await details.boundingBox())!.height).toBeLessThanOrEqual(220);
      expect(
        await details.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await notice
        .getByRole("button", { name: "复制详情", exact: true })
        .click();
      await expect(
        notice.getByRole("button", { name: "已复制", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => (window as unknown as { copiedNotice: string }).copiedNotice,
        ),
      ).toBe(`重试 1/3：${errorMessage}`);
      await page.screenshot({
        path: `.local/screenshots/retry-details-${theme}-${width}.png`,
        animations: "disabled",
      });
      await emit({
        type: "auto_retry_start",
        attempt: 2,
        maxAttempts: 3,
        delayMs: 6000,
        errorMessage,
      });
      await expect(notice).toHaveCount(1);
      await expect(
        notice.getByText("正在自动重试（2/3）", { exact: true }),
      ).toBeVisible();
      await expect(details).toHaveText(`重试 2/3：${errorMessage}`);
      await expect(
        notice.getByRole("button", { name: "复制详情", exact: true }),
      ).toBeVisible();
      // Failed clipboard access keeps all diagnostics selectable, with inline feedback.
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {
              throw new Error("Clipboard denied");
            },
          },
        });
      });
      await notice
        .getByRole("button", { name: "复制详情", exact: true })
        .click();
      await expect(
        notice.getByText("复制失败，请选择详情中的文本手动复制。", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(details).toBeVisible();
      await sdkAction(page, "prompt", { message: "/notice-probe" });
      await emit({ type: "auto_retry_end", success: true, attempt: 2 });
      await expect(notice).toHaveCount(0);
      await expect(page.locator(".notice-info")).toContainText("Notice probe");
      await page
        .locator(".notice-info")
        .getByRole("button", { name: "关闭通知", exact: true })
        .click();
      await emit({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 3000,
        errorMessage,
      });
      await expect(notice).toHaveCount(1);
      await sdkAction(page, "session.new");
      await expect(notice).toHaveCount(0);
      // Cover ordinary provider warnings as well as errors, without retry metadata.
      const level = theme === "light" ? "warning" : "error";
      await sdkAction(page, "sdk.run", {
        path: `${snapshot.agentDir}/desktop/notice-events.mjs`,
        args: { notice: { message: errorMessage, level } },
      });
      const stack = page.locator(".notice-stack");
      const visible = stack.locator(".notice-layer:not([hidden]) .notice");
      await expect(visible.locator(".notice-diagnostics")).toBeHidden();
      const latestMessage = errorMessage
        .replaceAll("a4b666ad9a46766d", "a4b674fe9870705")
        .replace("2026-10-16T10:33:44Z", "2026-10-16T10:43:17Z");
      await sdkAction(page, "sdk.run", {
        path: `${snapshot.agentDir}/desktop/notice-events.mjs`,
        args: { notice: { message: latestMessage, level } },
      });
      await expect(stack.locator(".notice")).toHaveCount(2);
      await expect(visible).toHaveCount(1);
      await expect(stack.locator(".notice-stack-back")).toHaveCount(1);
      await expect(
        stack.getByRole("button", { name: "查看详情", exact: true }),
      ).toHaveCount(1);
      await expect(stack.getByText(/已出现.*次/)).toHaveCount(0);
      expect((await stack.boundingBox())!.height).toBeLessThan(180);
      await page.mouse.move(0, 0);
      await stack.screenshot({
        path: `.local/screenshots/notice-stack-${theme}-${width}.png`,
        animations: "disabled",
      });
      await visible
        .getByRole("button", { name: "查看详情", exact: true })
        .click();
      await expect(visible.locator(".notice-diagnostics")).toHaveText(
        latestMessage,
      );
      const detailsId = await visible
        .locator(".notice-diagnostics")
        .getAttribute("id");
      await stack
        .getByRole("button", { name: "展开通知", exact: true })
        .click();
      await expect(visible).toHaveCount(2);
      await expect(
        visible.first().locator(".notice-diagnostics"),
      ).toHaveAttribute("id", detailsId!);
      await expect(
        visible.first().locator(".notice-diagnostics"),
      ).toBeVisible();
      await visible
        .nth(1)
        .getByRole("button", { name: "查看详情", exact: true })
        .click();
      await expect(visible.nth(1).locator(".notice-diagnostics")).toHaveText(
        errorMessage,
      );
      const scroll = visible.first().locator(".notice-diagnostics");
      await scroll.hover();
      await page.mouse.wheel(0, 240);
      await expect
        .poll(() => scroll.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      const scrollbar = await scroll.evaluate((element) => {
        return {
          top: element.scrollTop,
          overflow: element.scrollWidth <= element.clientWidth,
          width: getComputedStyle(element, "::-webkit-scrollbar").width,
          radius: getComputedStyle(element, "::-webkit-scrollbar-thumb")
            .borderRadius,
          track: getComputedStyle(element, "::-webkit-scrollbar-track")
            .backgroundColor,
        };
      });
      expect(scrollbar.top).toBeGreaterThan(0);
      expect(scrollbar.overflow).toBe(true);
      expect(scrollbar.width).toBe("6px");
      expect(scrollbar.radius).toBe("999px");
      expect(scrollbar.track).toBe("rgba(0, 0, 0, 0)");
      await stack.screenshot({
        path: `.local/screenshots/notice-stack-details-${theme}-${width}.png`,
        animations: "disabled",
      });
      await stack
        .getByRole("button", { name: "收起通知", exact: true })
        .click();
      await expect(visible).toHaveCount(1);
      await visible
        .getByRole("button", { name: "关闭通知", exact: true })
        .click();
      await expect(visible).toHaveCount(1);
      await expect(visible.locator(".notice-diagnostics")).toHaveText(
        errorMessage,
      );
      await visible
        .getByRole("button", { name: "关闭通知", exact: true })
        .click();
      await expect(stack).toHaveCount(0);
    });

async function timedNotices(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await page.mouse.move(0, 0);
  const now = new Date("2026-10-16T12:00:00Z");
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const emit = (message: string) =>
    sdkAction(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/notice-events.mjs`,
      args: { notice: { message, level: "warning" } },
    });
  return {
    emit,
    stack: page.locator(".notice-stack"),
    composer: page.getByRole("textbox", { name: "消息", exact: true }),
  };
}

test("unviewed notices expire individually after eight seconds, including cards behind the front", async ({
  page,
}) => {
  const { emit, stack } = await timedNotices(page);
  await emit("Older notification");
  await expect(
    stack.getByText("Older notification", { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(4000);
  await emit("Newer notification");
  await expect(stack.locator(".notice")).toHaveCount(2);
  await expect(
    stack.getByText("Newer notification", { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(3999);
  await expect(stack.locator(".notice")).toHaveCount(2);
  await page.clock.runFor(2);
  await expect(stack.locator(".notice")).toHaveCount(1);
  await expect(
    stack.getByText("Older notification", { exact: true }),
  ).toHaveCount(0);
  await expect(
    stack.getByText("Newer notification", { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(4000);
  await expect(stack).toHaveCount(0);
});

test("hovering pauses dismissal and leaving resumes the remaining time", async ({
  page,
}) => {
  const { emit, stack } = await timedNotices(page);
  await emit("Hover to read");
  const notice = stack.locator(".notice");
  await expect(notice).toBeVisible();
  await page.clock.runFor(5000);
  await notice.hover();
  await page.clock.runFor(20000);
  await expect(notice).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(2999);
  await expect(notice).toBeVisible();
  await page.clock.runFor(2);
  await expect(stack).toHaveCount(0);
});

test("keyboard focus and open details keep notifications available while reading", async ({
  page,
}) => {
  const { emit, stack, composer } = await timedNotices(page);
  await emit("Keyboard notification");
  const close = stack.getByRole("button", { name: "关闭通知", exact: true });
  await close.focus();
  await expect(close).toBeFocused();
  await page.clock.runFor(20000);
  await expect(stack).toBeVisible();
  await composer.focus();
  await page.clock.runFor(8001);
  await expect(stack).toHaveCount(0);
  await emit(
    '503 {"status":503,"detail":"Details remain available while open"}',
  );
  await stack.getByRole("button", { name: "查看详情", exact: true }).click();
  await expect(stack.locator(".notice-diagnostics")).toBeVisible();
  await composer.focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(20000);
  await expect(stack.locator(".notice-diagnostics")).toBeVisible();
  await stack.getByRole("button", { name: "收起详情", exact: true }).click();
  await composer.focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(8001);
  await expect(stack).toHaveCount(0);
});

test("an expanded stack pauses expiry and every card remains individually accessible", async ({
  page,
}) => {
  const { emit, stack, composer } = await timedNotices(page);
  for (const message of [
    "First notification",
    "Second notification",
    "Third notification",
  ])
    await emit(message);
  await expect(stack.locator(".notice-stack-back")).toHaveCount(2);
  await expect(stack.locator(".notice-layer:not([hidden])")).toHaveCount(1);
  await stack.getByRole("button", { name: "展开通知", exact: true }).click();
  await composer.focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(20000);
  await expect(stack.locator(".notice-layer:not([hidden])")).toHaveCount(3);
  await expect(
    stack.getByText("First notification", { exact: true }),
  ).toBeVisible();
  await stack.getByRole("button", { name: "收起通知", exact: true }).click();
  await composer.focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(8001);
  await expect(stack).toHaveCount(0);
});
