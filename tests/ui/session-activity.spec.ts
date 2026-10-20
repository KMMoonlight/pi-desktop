import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const theme of ["light", "dark"]) {
  test(`session activity shows running then unread until the reply is viewed (${theme})`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.bringToFront();
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.name", { name: "会话状态提示" });
    await sdkAction(page, "theme.set", { theme });
    const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const row = page.locator(
      `.session-row[data-session-id="${initial.sessionId}"]`,
    );
    await sdkAction(page, "prompt", {
      message: "slow-response session activity",
    });
    await expect(
      row.getByRole("status", { name: "执行中", exact: true }),
    ).toBeVisible();
    await expect(row.locator(".session-activity > [aria-hidden='true']")).toHaveCSS(
      "display",
      "block",
    );
    await page.getByRole("button", { name: "文件与更改", exact: true }).click();
    await expect(
      row.getByRole("status", { name: "任务完成，未读", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("status", { name: "执行中", exact: true }),
    ).toHaveCount(0);
    await mkdir(".local/session-activity", { recursive: true });
    await row.screenshot({
      path: `.local/session-activity/unread-${theme}.png`,
    });
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.name", { name: "另一会话" });
    await page.reload();
    await page.bringToFront();
    await expect(
      row.getByRole("status", { name: "任务完成，未读", exact: true }),
    ).toBeVisible();
    await row.locator("button").first().click();
    await expect(row.getByRole("status")).toHaveCount(0);
    expect(
      await page.evaluate(
        (id) =>
          JSON.parse(
            localStorage.getItem("pi.unreadCompletedSessions") || "[]",
          ).includes(id),
        initial.sessionId,
      ),
    ).toBe(false);
    // If the reader is already watching the reply, completion is immediately read.
    await sdkAction(page, "prompt", {
      message: "slow-response already viewing",
    });
    await expect(
      row.getByRole("status", { name: "执行中", exact: true }),
    ).toBeVisible();
    await row.screenshot({
      path: `.local/session-activity/running-${theme}.png`,
    });
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).running,
      )
      .toBe(false);
    await expect(row.getByRole("status")).toHaveCount(0);
    await sdkAction(page, "theme.set", { theme: "light" });
  });
}

test("sidebar spinner keeps its circle centered throughout a full rotation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const row = page.locator(`.session-row[data-session-id="${snapshot.sessionId}"]`);
  const status = row.getByRole("status", { name: "执行中", exact: true });
  try {
    await sdkAction(page, "prompt", { message: "tool-timer-abort-probe" });
    await expect(status).toBeVisible();
    const spinner = status.locator(":scope > [aria-hidden='true']");
    const started = await spinner.evaluate(node => Number(node.getAnimations()[0]?.currentTime));
    await expect.poll(() => spinner.evaluate(node => Number(node.getAnimations()[0]?.currentTime)))
      .toBeGreaterThan(started + 200);

    for (const theme of ["light", "dark"]) {
      await sdkAction(page, "theme.set", { theme });
      const samples = await spinner.evaluate(async node => {
        const animation = node.getAnimations()[0]!;
        animation.pause();
        const duration = Number(animation.effect!.getTiming().duration);
        const samples = [];
        for (let step = 0; step < 16; step++) {
          animation.currentTime = duration * step / 16;
          await new Promise(requestAnimationFrame);
          const ring = node.getBoundingClientRect();
          const slot = node.parentElement!.getBoundingClientRect();
          samples.push({
            x: ring.x + ring.width / 2 - (slot.x + slot.width / 2),
            y: ring.y + ring.height / 2 - (slot.y + slot.height / 2),
          });
        }
        animation.play();
        return samples;
      });
      for (const sample of samples) {
        expect(Math.abs(sample.x), `${theme}: horizontal center`).toBeLessThan(0.1);
        expect(Math.abs(sample.y), `${theme}: vertical center`).toBeLessThan(0.1);
      }
    }
  } finally {
    await sdkAction(page, "abort");
    await sdkAction(page, "theme.set", { theme: "light" });
  }
});

test("completion stays unread while the document reports background focus", async ({
  page,
}) => {
  await page.goto("/");
  await page.bringToFront();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  await sdkAction(page, "session.name", { name: "后台完成提示" });
  const session = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const row = page.locator(
    `.session-row[data-session-id="${session.sessionId}"]`,
  );
  await sdkAction(page, "prompt", {
    message: "slow-response background completion",
  });
  await expect(
    row.getByRole("status", { name: "执行中", exact: true }),
  ).toBeVisible();
  // Headless Chromium keeps every tab focused; emulate the native window's
  // document focus contract while running the real completion lifecycle.
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    });
    window.dispatchEvent(new Event("blur"));
  });
  await expect(
    row.getByRole("status", { name: "任务完成，未读", exact: true }),
  ).toHaveCount(1);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hasFocus");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(row.getByRole("status")).toHaveCount(0);
});
