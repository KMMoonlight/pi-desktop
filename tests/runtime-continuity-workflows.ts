import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const continuityTransitions = [
  "reload",
  "new",
  "switch",
  "fork",
  "import",
] as const;
export const continuityModes = ["native", "terminal"] as const;
interface Probe {
  same: boolean;
  terminalSame: boolean;
  editorSame: boolean;
  footerSame: boolean;
  registrationCount: number;
  value: string;
  editorText: string;
  direct: number;
  context: number;
  debug: number;
  colors: string[];
  disposed: number;
  stale: boolean;
  path: string;
  entry: string;
}
export async function verifyRuntimeContinuity(
  page: Page,
  transition: (typeof continuityTransitions)[number],
  mode: (typeof continuityModes)[number],
  screenshot: string,
) {
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .waitFor({ state: "visible", timeout: 30000 });
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "Desktop continuity seed" });
  await sdkAction(page, "desktop.appearance", { appearance: "light" });
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action = "inspect") =>
    sdkAction<Probe>(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/runtime-continuity-probe.mjs`,
      args: { action, mode },
    });
  const seed = await probe("seed");
  try {
    const registration = page.locator('[data-surface-id="tui:registrations"]');
    const input =
      mode === "native"
        ? page.getByRole("textbox", { name: "持久注册输入", exact: true })
        : page
            .getByLabel("扩展终端组件", { exact: true })
            .locator(".xterm-helper-textarea");
    const focusInput = () =>
      mode === "native"
        ? input.click()
        : page
            .getByLabel("扩展终端组件", { exact: true })
            .click({ position: { x: 20, y: 10 } });
    await expect(input).toBeVisible();
    await focusInput();
    await input.press("x");
    await expect.poll(async () => (await probe()).value).toBe("y");
    const before = await probe();
    if (transition === "reload") await sdkAction(page, "resources.reload");
    if (transition === "new") await sdkAction(page, "session.new");
    if (transition === "switch")
      await sdkAction(page, "session.switch", { path: seed.path });
    if (transition === "fork")
      await sdkAction(page, "session.fork", { id: seed.entry });
    if (transition === "import")
      await sdkAction(page, "session.import", { path: seed.path });
    const after = await probe();
    expect(after.same).toBe(true);
    expect(after.terminalSame).toBe(true);
    expect(after.editorSame).toBe(true);
    expect(after.footerSame).toBe(true);
    expect(after.stale).toBe(true);
    expect(after.disposed).toBe(0);
    expect(after.registrationCount).toBe(1);
    expect(after.value).toBe("y");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await expect(editor).toBeVisible();
    await expect(input).toBeVisible();
    await focusInput();
    await input.press("q");
    await expect.poll(async () => (await probe()).value).toBe("yq");
    const typed = await probe();
    expect(typed.direct).toBeGreaterThan(before.direct);
    expect(typed.context).toBe(before.context);
    await sdkAction(page, "desktop.appearance", { appearance: "dark" });
    await expect.poll(async () => (await probe()).colors.at(-1)).toBe("dark");
    expect((await probe("debug")).debug).toBe(1);
    await probe("history");
    await expect(editor).toHaveValue("Persistent desktop history");
    await page.screenshot({ path: screenshot, fullPage: true });
    expect((await probe("cleanup")).disposed).toBe(1);
    await expect(input).toHaveCount(0);
    await expect(registration.getByRole("textbox")).toHaveCount(0);
  } finally {
    await probe("cleanup").catch(() => {});
    await sdkAction(page, "session.new");
  }
}
