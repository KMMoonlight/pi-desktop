import { expect, type Page } from "@playwright/test";
import { mkdir, cp } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const runtimeCallbackModes = [
  "installed",
  "cleared",
  "rebind-failure",
  "before-failure",
] as const;

export async function verifyRuntimeCallbacks(
  page: Page,
  mode: (typeof runtimeCallbackModes)[number],
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await expect(
    page.getByRole("button", { name: "新建会话", exact: true }),
  ).toBeEnabled();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(
    snapshot.agentDir,
    "desktop",
    `runtime-callbacks-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, "callbacks.mjs");
  await cp(new URL("./fixtures/runtime-callbacks.mjs", import.meta.url), path);
  expect(await sdkAction(page, "sdk.run", { path, args: { mode } })).toEqual({
    events:
      mode === "installed"
        ? ["before", "rebind", "options"]
        : mode === "cleared"
          ? ["options"]
          : mode === "before-failure"
            ? ["before"]
            : ["before", "rebind"],
    disposed: 1,
    receivers: true,
    preserved: mode.endsWith("failure"),
    optionsText:
      mode === "installed" ? "Callback draft" : mode === "cleared" ? "" : null,
    cancelled: false,
    replaced: true,
    hasUI: true,
    text: mode === "installed" ? "Callback draft" : "",
    hasEditor: true,
  });
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toHaveValue(
    mode === "installed" ? "Callback draft" : "",
  );
  await sdkAction(page, "session.new");
  await expect(editor).toHaveValue("");
  await editor.fill("After callback reset");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).editor.text,
    )
    .toBe("After callback reset");
}
