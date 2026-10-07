import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const rendererModes = ["native", "terminal"] as const;
interface Probe {
  mode: string;
  stopped: boolean;
  switched: boolean;
  same: boolean;
  terminalSame: boolean;
  rootsSame: boolean;
  editorSame: boolean;
  footerSame: boolean;
  direct: number;
  context: number;
  debug: number;
  disposed: number;
  value: string;
  fullRedraws: number;
  screenRows?: number;
}
export async function verifyRendererModes(
  page: Page,
  mode: (typeof rendererModes)[number],
  screenshot: string,
) {
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor({ state: "visible", timeout: 30000 });
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action = "inspect", next = "fullscreen") =>
    sdkAction<Probe>(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/renderer-modes-probe.mjs`,
      args: { action, next, mode },
    });
  await probe("seed");
  try {
    const input =
      mode === "native"
        ? page.getByRole("textbox", { name: "模式切换输入", exact: true })
        : page
            .getByLabel("扩展终端组件", { exact: true })
            .locator(".xterm-helper-textarea");
    const focus = async () =>
      mode === "native"
        ? input.click()
        : page
            .getByLabel("扩展终端组件", { exact: true })
            .click({ position: { x: 25, y: 10 } });
    await expect(input).toBeVisible();
    await focus();
    await input.press("x");
    await expect.poll(async () => (await probe()).value).toBe("x");
    const initial = await probe();
    const surface = (
      await sdkAction<DesktopSnapshot>(page, "snapshot")
    ).desktopSurfaces.find((s) => s.id === "tui:registrations")!;
    for (const next of ["fullscreen", "regular", "fullscreen"]) {
      await probe("switch", next);
      // A returning regular renderer can restore an identical frame with zero
      // full redraws. Test force accounting explicitly against its real state.
      const switched = await probe("force");
      expect(switched.switched).toBe(true);
      expect(switched.mode).toBe(next);
      expect(
        switched.same &&
          switched.terminalSame &&
          switched.rootsSame &&
          switched.editorSame &&
          switched.footerSame,
      ).toBe(true);
      expect(switched.disposed).toBe(0);
      expect(switched.fullRedraws).toBeGreaterThan(0);
      if (next === "fullscreen") expect(switched.screenRows).toBeGreaterThan(0);
      await expect(editor).toBeVisible();
      await expect(input).toBeVisible();
      expect(
        (
          await sdkAction<DesktopSnapshot>(page, "snapshot")
        ).desktopSurfaces.find((s) => s.id === surface.id)?.instanceId,
      ).toBe(surface.instanceId);
      await focus();
      await input.press("y");
      await expect
        .poll(async () => (await probe()).context)
        .toBeGreaterThan(initial.context);
      expect((await probe()).direct).toBe(initial.direct);
    }
    const beforeForce = await probe();
    expect((await probe("force")).fullRedraws).toBeGreaterThan(
      beforeForce.fullRedraws,
    );
    const beforeHook = await probe();
    await probe("reregister");
    await focus();
    await input.press("z");
    await expect
      .poll(async () => (await probe()).direct)
      .toBeGreaterThan(beforeHook.direct);
    await probe("debug");
    expect((await probe()).debug).toBe(1);
    await probe("overlay");
    const overlay = page.getByRole("textbox", {
      name: "模式覆盖层",
      exact: true,
    });
    await expect(overlay).toBeVisible();
    expect((await probe("switch", "regular")).switched).toBe(false);
    await probe("hide-overlay");
    await expect(overlay).toBeHidden();
    expect((await probe("switch", "regular")).switched).toBe(false);
    await probe("remove-overlay");
    const beforeStop = await probe();
    await probe("stop");
    const collapseTerminal = page.getByRole("button", {
      name: "收起终端",
      exact: true,
    });
    await expect(collapseTerminal).toBeVisible();
    expect((await probe()).stopped).toBe(true);
    await sdkAction(page, "desktop.input", {
      surfaceId: surface.id,
      data: "q",
      raw: true,
    });
    expect((await probe()).value).toBe(beforeStop.value);
    await probe("start");
    await collapseTerminal.click();
    await expect(input).toBeVisible();
    await focus();
    await input.press("q");
    await expect
      .poll(async () => (await probe()).value)
      .toBe(beforeStop.value + "q");
    await probe("settings", "regular");
    expect((await probe()).mode).toBe("regular");
    await page.screenshot({ path: screenshot, fullPage: true });
    expect((await probe("cleanup")).disposed).toBe(1);
  } finally {
    await probe("cleanup").catch(() => {});
  }
}
