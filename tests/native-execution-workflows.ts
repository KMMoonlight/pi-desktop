import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const nativeExecutionModes = ["tools", "bash", "notices"] as const;
interface Probe {
  toolCount: number;
  toolShared: boolean;
  toolClass: string[];
  bashCount: number;
  bashSame: boolean;
  bashStatus: string[];
  bashOutput: string[];
  stoppedLoaders: boolean;
  noticeClasses: string[];
  noticeText: string[];
}
export async function verifyNativeExecution(
  page: Page,
  mode: (typeof nativeExecutionModes)[number],
  screenshot: string,
) {
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .waitFor({ state: "visible", timeout: 30000 });
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action = "inspect") =>
    sdkAction<Probe>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/native-execution-probe.mjs`,
      args: { action },
    });
  if (mode === "tools") {
    await probe("seed-tools");
    await expect.poll(async () => (await probe()).toolCount).toBe(5);
    const state = await probe();
    expect(state.toolShared).toBe(true);
    expect(
      state.toolClass.every((value) => value === "ToolExecutionComponent"),
    ).toBe(true);
    const row = page.locator('[data-tool-call-id="display-control"]');
    const input = row.getByRole("textbox", { name: "display_control input" });
    await input.fill("Native row input");
    await expect(input).toHaveValue("Native row input");
    await sdkAction(page, "transcript.tool", {
      sessionId: initial.sessionId,
      toolCallId: "display-control",
      expanded: true,
    });
    await expect(row).toHaveAttribute("data-tool-expanded", "true");
    await expect(input).toHaveValue("Native row input");
    await expect(row.locator(".desktop-terminal-fallback")).toHaveCount(0);
  }
  if (mode === "bash") {
    const live = await probe("bash-start");
    expect(live.bashCount).toBe(1);
    expect(live.bashStatus).toEqual(["running"]);
    expect(live.bashOutput).toEqual(["Native streamed output\n"]);
    expect(live.bashSame).toBe(true);
    const completed = await probe("bash-finish");
    expect(completed.bashStatus).toEqual(["complete"]);
    expect(completed.bashSame).toBe(true);
    expect(completed.stoppedLoaders).toBe(true);
    await expect(
      page.locator(".message").getByText("Native streamed output"),
    ).toBeVisible();
  }
  if (mode === "notices") {
    const before = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const state = await probe("notice");
    expect(state.noticeClasses).toContain("ThemedText");
    expect(
      state.noticeText.some((value) =>
        value.includes("Warning: Native original notice"),
      ),
    ).toBe(true);
    expect(
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).messages.length,
    ).toBe(before.messages.length);
    await expect(
      page.getByText("Native original notice", { exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await sdkAction(page, "session.new");
}
