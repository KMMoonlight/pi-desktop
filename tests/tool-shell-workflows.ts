import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyToolShell(page: Page, screenshot: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(initial.agentDir, "desktop", "tool-shell-control.mjs");
  await cp(new URL("./fixtures/tool-shell-control.mjs", import.meta.url), path);
  const run = (args: Record<string, unknown>) =>
    sdkAction(page, "sdk.run", { path, args });
  const command = (name: string) =>
    sdkAction(page, "prompt", { message: `/${name}` });
  const self = (id: string) =>
    page.locator(`.tool-self[data-tool-call-id="shell-${id}"]`);
  const openProcess = async () => {
    for (const summary of await page.locator(".process-group:not([open]) > summary").all())
      await summary.click();
  };
  try {
    const image = (await readFile("src-tauri/icons/128x128.png")).toString(
      "base64",
    );
    await run({ mode: "seed", image, expanded: false });
    await expect(page.locator(".process-group")).toHaveCount(1);
    await openProcess();
    await expect(page.locator(".tool-result:not(.tool-running)")).toHaveCount(
      1,
    );
    await expect(page.locator(".tool-self:not(.tool-running)")).toHaveCount(4);
    await expect(self("self_failure")).toContainText("4 more lines");
    await expect(self("self_missing")).not.toContainText("line 11");
    await expect(self("self_missing").locator("summary")).toHaveCount(0);
    await expect(
      self("self_missing").locator(".tool-output-image"),
    ).toHaveCount(1);
    const input = self("self_control").getByRole("textbox", {
      name: "Shell value",
      exact: true,
    });
    await expect(input).toHaveValue("Editable tool result");
    await input.fill("Desktop tool input");
    await input.press("Enter");
    await expect
      .poll(
        async () =>
          (
            (await run({
              mode: "state",
              ids: ["shell-self_control"],
            })) as Record<string, { submitted?: string }>
          )["shell-self_control"].submitted,
      )
      .toBe("Desktop tool input");
    await command("shell-recover");
    await expect(self("self_failure")).toContainText(
      "Shell result self_failure",
    );
    const states = (await run({
      mode: "state",
      ids: ["shell-default_failure", "shell-self_failure"],
    })) as Record<
      string,
      {
        callReceiver: boolean;
        resultReceiver: boolean;
        callLast: boolean;
        resultLast: boolean;
      }
    >;
    for (const state of Object.values(states)) {
      expect(state.callReceiver).toBe(true);
      expect(state.resultReceiver).toBe(true);
      expect(state.callLast).toBe(false);
      expect(state.resultLast).toBe(false);
    }
    await self("self_control").scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await run({ expanded: true });
    await expect(self("self_missing")).toContainText("line 14");
    await expect(self("self_failure")).toContainText("expanded=true");
    await command("shell-fail");
    await expect(self("self_failure")).toContainText("line 14");
    await run({ mode: "partial" });
    const partial = page.locator(
      '.tool-self.tool-running[data-tool-call-id="shell-partial"]',
    );
    await expect(partial).toContainText("Shell partial fallback");
    await expect(partial.locator("summary")).toHaveCount(0);
    await expect(partial.locator("[data-surface-id]")).toHaveCount(2);
    await expect(partial).toContainText("Partial argument");
    await expect(partial.locator(".tool-body > pre")).toHaveCount(0);
    await page.screenshot({
      path: screenshot.replace(/\.png$/, "-partial.png"),
      animations: "disabled",
    });
    await run({ mode: "clearPartial" });
    await page.reload();
    await self("self_control").waitFor({ state: "attached" });
    await openProcess();
    await expect(self("self_missing")).toContainText("line 14");
    await expect(
      self("self_control").getByRole("textbox", {
        name: "Shell value",
        exact: true,
      }),
    ).toHaveValue("Desktop tool input");
    const saved = await sdkAction<DesktopSnapshot>(page, "snapshot");
    await sdkAction(page, "resources.reload");
    await openProcess();
    await expect(self("self_failure")).toContainText("line 14");
    await expect(
      self("self_control").getByRole("textbox", {
        name: "Shell value",
        exact: true,
      }),
    ).toHaveValue("Editable tool result");
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.switch", { path: saved.sessionFile });
    await openProcess();
    await expect(self("self_missing")).toContainText("line 14");
    const overflow = await page
      .locator(".transcript")
      .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(overflow).toBe(false);
  } finally {
    if (!page.isClosed()) await run({ mode: "clearPartial", expanded: false });
  }
}
