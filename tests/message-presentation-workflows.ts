import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyThinkingLabel(page: Page) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  const previous = await sdkAction<DesktopSnapshot>(page, "snapshot");
  // The persisted SDK setting can override localStorage after another workflow.
  await sdkAction(page, "display.thinking", { visible: false });
  try {
    await sdkAction(page, "prompt", {
      message: "/text-surface-probe thinking",
    });
    await sdkAction(page, "prompt", { message: "thinking-label-probe" });
    const thinking = page.locator(".transcript .thinking-block");
    const summary = thinking.locator("summary");
    await expect(thinking).toHaveCount(1);
    await expect(summary).toHaveText("Private reasoning");
    await expect(
      summary.getByText("Private reasoning", { exact: true }),
    ).toHaveCSS("color", "rgb(80, 110, 140)");
    await expect(
      summary.getByText("Private reasoning", { exact: true }),
    ).toHaveCSS("font-style", "italic");
    await summary.click();
    await expect(thinking).toHaveAttribute("open", "");
    await expect(summary).toHaveText("思考过程");
    await expect(
      thinking.getByText("Reasoning fixture content.", { exact: true }),
    ).toBeVisible();
    await summary.click();
    await sdkAction(page, "prompt", {
      message: "/text-surface-probe thinking-empty",
    });
    await expect(summary).toHaveText("");
    await sdkAction(page, "prompt", {
      message: "/text-surface-probe thinking-reset",
    });
    await expect(summary).toHaveText("思考过程");
  } finally {
    await sdkAction(page, "display.thinking", {
      visible: previous.settings.hideThinkingBlock !== true,
    });
  }
}

export async function verifyWorkingIndicator(page: Page) {
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", {
    message: "/text-surface-probe indicator",
  });
  await editor.fill("slow-response");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const row = page.locator(".run-indicator");
  try {
    await expect(row.getByText("Working text", { exact: true })).toHaveCSS(
      "color",
      "rgb(31, 82, 133)",
    );
    await expect(row.getByText("Frame A", { exact: true })).toHaveCSS(
      "color",
      "rgb(19, 120, 70)",
    );
    await expect(row.getByText("Frame B", { exact: true })).toHaveCSS(
      "font-style",
      "italic",
    );
    await expect(row).not.toContainText("\x1b");
  } finally {
    await sdkAction(page, "abort");
  }
  await expect(row).toBeHidden();
}
