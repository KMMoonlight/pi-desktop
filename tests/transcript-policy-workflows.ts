import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyTranscriptPolicy(page: Page, screenshot: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(initial.agentDir, "desktop");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "transcript-policy.mjs");
  await cp(new URL("./fixtures/transcript-policy.mjs", import.meta.url), path);
  const image = (await readFile("src-tauri/icons/128x128.png")).toString(
    "base64",
  );
  const run = (args: Record<string, unknown>) =>
    sdkAction(page, "sdk.run", { path, args });
  try {
    await run({ mode: "notices" });
    const alerts = page.locator(".transcript").getByRole("alert");
    await expect(alerts).toHaveCount(6);
    await expect(
      page.getByText("Response was truncated before completion.", {
        exact: true,
      }),
    ).toHaveCount(2);
    await expect(alerts.filter({ hasText: "Operation aborted" })).toBeVisible();
    await expect(
      page.getByText("Policy custom abort", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Error: Unknown error", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Error: Policy custom error", { exact: true }),
    ).toBeVisible();
    await expect(alerts.filter({ hasText: "Tool owns" })).toHaveCount(0);
    await page.reload();
    await expect(alerts).toHaveCount(6);
    await sdkAction(page, "session.new");
    await run({
      mode: "images",
      image,
      visible: true,
      width: 9,
      expanded: true,
    });
    const completed = page.locator(".tool-result:not(.tool-running)");
    const images = completed.locator(".tool-output-image");
    await expect(completed).toHaveCount(2);
    await expect(images).toHaveCount(2);
    await expect(
      page.getByText("Policy result images: true; partial: false", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Policy call images: true", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        images.evaluateAll((elements) =>
          elements.every(
            (element) =>
              (element as HTMLImageElement).naturalWidth === 128 &&
              element.getBoundingClientRect().width <= 72,
          ),
        ),
      )
      .toBe(true);
    const userImage = page.locator(".message-user .message-image");
    await expect(userImage).toHaveCount(1);
    await run({ visible: false });
    await expect(images).toHaveCount(0);
    const completedFallback = completed.locator(
      '[data-surface-id="render:result:policy-policy_default"] .desktop-text',
    );
    await expect(completedFallback).toHaveCount(1);
    await expect(completedFallback).toContainText("image/png");
    await expect(
      page.getByText("Policy result images: false; partial: false", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Policy call images: false", { exact: true }),
    ).toBeVisible();
    await expect(userImage).toHaveCount(1);
    await run({ mode: "partial", image });
    const running = page.locator(".tool-running");
    await expect(running).toHaveCount(2);
    await expect(running.locator(".tool-output-image")).toHaveCount(0);
    const partialFallback = running.locator(
      '[data-surface-id="render:result:partial-policy_default"] .desktop-text',
    );
    await expect(partialFallback).toHaveCount(1);
    await expect(partialFallback).toContainText("image/png");
    await expect(
      page.getByText("Policy result images: false; partial: true", {
        exact: true,
      }),
    ).toBeVisible();
    await run({ visible: true, width: 12 });
    await expect(images).toHaveCount(2);
    await expect(running.locator(".tool-output-image")).toHaveCount(2);
    await expect(
      page.getByText("Policy result images: true; partial: true", {
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        running
          .locator(".tool-output-image")
          .evaluateAll((elements) =>
            elements.every(
              (element) =>
                (element as HTMLImageElement).naturalWidth === 128 &&
                element.getBoundingClientRect().width <= 96,
            ),
          ),
      )
      .toBe(true);
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await run({ mode: "clearPartial", visible: false });
    await expect(running).toHaveCount(0);
    await page.reload();
    await expect(images).toHaveCount(0);
    await expect(
      page.getByText("Policy result images: false; partial: false", {
        exact: true,
      }),
    ).toBeVisible();
    const saved = await sdkAction<DesktopSnapshot>(page, "snapshot");
    await sdkAction(page, "resources.reload");
    await expect(images).toHaveCount(0);
    await run({ visible: true });
    await expect(images).toHaveCount(2);
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.switch", { path: saved.sessionFile });
    await expect(images).toHaveCount(2);
    await expect(userImage).toHaveCount(1);
  } finally {
    if (!page.isClosed()) {
      await run({
        mode: "clearPartial",
        visible: initial.toolImages?.visible ?? true,
        width: initial.toolImages?.widthCells ?? 60,
        expanded: false,
      });
    }
  }
}
