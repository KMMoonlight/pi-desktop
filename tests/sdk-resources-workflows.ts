import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const sdkResourcesModes = [
  "native-user",
  "native-project",
  "desktop-user",
  "desktop-project",
  "filters",
  "callbacks",
  "loader",
  "settings",
] as const;

export async function verifySdkResources(page: Page) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(
    initial.agentDir,
    "desktop",
    `resources-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, "resources.mjs");
  await cp(new URL("./fixtures/sdk-resources.mjs", import.meta.url), path);
  for (const mode of sdkResourcesModes) {
    expect(
      await sdkAction(page, "sdk.run", { path, args: { mode } }),
      mode,
    ).toEqual({ mode, complete: true });
  }
  expect(
    await sdkAction(page, "sdk.run", { path, args: { mode: "recovery" } }),
  ).toEqual({ mode: "recovery", complete: true });
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).cwd).toBe(
    initial.cwd,
  );
}
