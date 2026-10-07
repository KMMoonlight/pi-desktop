import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const conversationNoticeModes = [
  "cache",
  "compaction",
  "branch",
] as const;
interface Probe {
  notices: NonNullable<DesktopSnapshot["conversationNotices"]>;
  same: boolean;
  nativeClasses: string[];
  mutationSame: boolean;
  treeShared: boolean;
  sdkHash: string;
  sessionFile: string;
  messages: { id: string; role: string; text: string }[];
}
export async function verifyConversationNotices(
  page: Page,
  mode: (typeof conversationNoticeModes)[number],
  screenshot: string,
) {
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .waitFor({ state: "visible", timeout: 30000 });
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action = "inspect") =>
    sdkAction<Probe>(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/conversation-notices-probe.mjs`,
      args: { action, mode },
    });
  const initial = await probe("seed");
  try {
    const count = mode === "cache" ? 4 : 1;
    const notices = page.locator("[data-conversation-notice]");
    await expect(notices).toHaveCount(count);
    expect(
      initial.nativeClasses.every(
        (name) => name === "ThemedText" || name === "Spacer",
      ),
    ).toBe(true);
    expect(initial.treeShared).toBe(true);
    expect((await probe()).same).toBe(true);
    if (mode === "cache") {
      await expect(notices.nth(0)).toContainText(
        "Cache warmed (leading warm): $0.020",
      );
      await expect(notices.nth(1)).toContainText(
        "Cache warmed (mid-session warm): $0.020",
      );
      await expect(notices.nth(2)).toContainText(
        "Anthropic dropped 2 thinking blocks",
      );
      await expect(notices.nth(3)).toContainText(
        "Cache miss after 6m idle: 60k tokens re-billed (~$1.20)",
      );
      const positions = await page
        .locator(".transcript-wrap .transcript-inner")
        .evaluate((root) =>
          Array.from(root.children).map((child) => child.textContent),
        );
      expect(
        positions.findIndex((text) =>
          text?.includes("Previous cached response"),
        ),
      ).toBeLessThan(
        positions.findIndex((text) => text?.includes("mid-session warm")),
      );
      expect(
        positions.findIndex((text) =>
          text?.includes("Conversation notice response"),
        ),
      ).toBeLessThan(
        positions.findIndex((text) => text?.includes("Anthropic dropped")),
      );
    } else {
      await expect(notices).toContainText(
        mode === "compaction"
          ? "Compaction: 45k tokens billed (~$0.27)"
          : "Branch summary: 30k tokens billed (~$0.19)",
      );
      expect(initial.notices[0]!.afterMessageId).toBe(
        initial.messages.find(
          (message) =>
            message.role ===
            (mode === "compaction" ? "compactionSummary" : "branchSummary"),
        )!.id,
      );
      if (mode === "compaction")
        expect(initial.messages.at(-1)!.role).toBe("compactionSummary");
    }
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await notices
      .last()
      .evaluate((element) =>
        Reflect.set(window, "__conversationNoticeIdentity", element),
      );
    const changed = await probe("mutation");
    expect(changed.same && changed.mutationSame).toBe(true);
    expect(changed.sdkHash).toBe(initial.sdkHash);
    await expect(notices.last()).toContainText(
      "Direct native billing notice mutation",
    );
    expect(
      await notices
        .last()
        .evaluate(
          (element) =>
            element === Reflect.get(window, "__conversationNoticeIdentity"),
        ),
    ).toBe(true);
    await probe("hide");
    await expect(notices).toHaveCount(0);
    const reconstructed = await probe("show");
    await expect(notices).toHaveCount(mode === "cache" ? 3 : 1);
    expect(reconstructed.sdkHash).toBe(initial.sdkHash);
    expect(
      reconstructed.notices.every(
        (notice) => !notice.presentation.text.includes("Anthropic dropped"),
      ),
    ).toBe(true);
    await sdkAction(page, "resources.reload");
    await expect(notices).toHaveCount(mode === "cache" ? 3 : 1);
    await sdkAction(page, "session.new");
    await expect(notices).toHaveCount(0);
    await sdkAction(page, "session.switch", { path: initial.sessionFile });
    await expect(notices).toHaveCount(mode === "cache" ? 3 : 1);
  } finally {
    await sdkAction(page, "session.new");
  }
}
