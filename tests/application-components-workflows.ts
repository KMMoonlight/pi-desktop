import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const applicationModes = ["messages", "footer", "status"] as const;
interface Probe {
  messages: string[];
  nativeAssistantPadding: number[];
  footerOriginal: boolean;
  footerClass: string;
  footerRestored: boolean;
  providersShared: boolean;
  providerCount: number;
  footerText: string;
  statuses: Record<string, string>;
  workingKind?: string;
  workingInEditor: boolean;
  workingInStatus: boolean;
  indicatorInterval?: number;
  originalDefaultEditor: boolean;
}

export async function verifyApplicationComponents(
  page: Page,
  mode: (typeof applicationModes)[number],
  screenshot: string,
) {
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action = "inspect") =>
    sdkAction<Probe>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/application-probe.mjs`,
      args: { action },
    });
  // The shared preview fixture installs a custom footer on session startup.
  // Restore Pi's builtin object before verifying its original tree.
  let state = await probe("restore-footer");
  expect(state.footerClass).toBe("FooterComponent");
  expect(state.footerOriginal).toBe(true);
  if (mode === "messages") {
    await composer.fill("Native application message");
    await composer.press("Enter");
    await expect
      .poll(async () => {
        const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
        // A native input acknowledgement can precede prompt admission. Observe
        // its completed assistant message as well as the eventual idle state.
        return (
          !snapshot.busy &&
          snapshot.messages.some((message) => message.role === "assistant")
        );
      })
      .toBe(true);
    state = await probe();
    expect(state.messages).toContain("UserMessageComponent");
    expect(state.messages).toContain("AssistantMessageComponent");
    const mutated = await probe("mutate");
    expect(mutated.nativeAssistantPadding).toContain(4);
    expect((await probe()).nativeAssistantPadding).toContain(4);
    const content = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(
      content.messages.some(
        (message) =>
          message.role === "user" &&
          message.content.some(
            (block) => block.text === "Native application message",
          ),
      ),
    ).toBe(true);
    await expect(composer).toBeVisible();
  }
  if (mode === "footer") {
    const previousProviders = state.providerCount;
    state = await probe("status");
    expect(state.statuses["native-application"]).toBe("Native footer status");
    expect(state.statuses.working).toBeUndefined();
    expect(state.footerText).toContain("Native footer status");
    for (let index = 1; index <= 2; index++) {
      state = await probe("custom-footer");
      expect(state.providersShared).toBe(true);
      expect(state.providerCount).toBe(previousProviders + index);
      expect(state.footerOriginal).toBe(false);
      const footer = page.locator('[data-surface-id="footer"]');
      await expect(footer).toContainText("Native footer status");
      await expect(footer.locator(".desktop-terminal-fallback")).toHaveCount(0);
    }
    state = await probe("restore-footer");
    expect(state.footerOriginal).toBe(true);
    expect(state.footerRestored).toBe(true);
    expect(state.providersShared).toBe(true);
  }
  if (mode === "status") {
    await probe("status");
    await composer.fill("application-status-gate");
    await composer.press("Enter");
    await expect
      .poll(
        async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
      )
      .toBe(true);
    state = await probe();
    expect(state.workingKind).toBe("working");
    expect(state.workingInEditor).toBe(true);
    expect(state.indicatorInterval).toBe(300);
    state = await probe("plain-editor");
    expect(state.workingInEditor).toBe(false);
    expect(state.workingInStatus).toBe(true);
    state = await probe("hide");
    expect(state.workingKind).toBeUndefined();
    state = await probe("show");
    expect(state.workingKind).toBe("working");
    state = await probe("restore-editor");
    expect(state.originalDefaultEditor).toBe(true);
    expect(state.workingInEditor).toBe(true);
    await sdkAction(page, "abort");
    await expect
      .poll(
        async () => !(await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
      )
      .toBe(true);
  }
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await sdkAction(page, "session.new");
}
