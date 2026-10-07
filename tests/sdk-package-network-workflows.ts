import { cp, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { DesktopSnapshot } from "../shared/types.ts";
import { sdkAction } from "./editor-workflows.ts";
import { createPackageNetworkFixture } from "./package-network-fixture.ts";

export const sdkPackageNetworkModes = [
  "npm-user",
  "npm-project",
  "git-user",
  "git-project",
  "npm-policy",
  "git-policy",
  "failure",
] as const;

export async function verifySdkPackageNetwork(page: Page) {
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await composer.waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(
    initial.agentDir,
    "desktop",
    `network-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, "package-network.mjs");
  await cp(
    new URL("./fixtures/sdk-package-network.mjs", import.meta.url),
    path,
  );
  for (const mode of sdkPackageNetworkModes) {
    const fixture = await createPackageNetworkFixture();
    try {
      expect(
        await sdkAction(page, "sdk.run", {
          path,
          args: { mode, network: fixture.config },
        }),
        mode,
      ).toEqual({ mode, complete: true });
      console.log(`SDK package network workflow passed: ${mode}`);
    } finally {
      await fixture.close();
    }
  }
  expect(
    await sdkAction(page, "sdk.run", { path, args: { mode: "recovery" } }),
  ).toEqual({ mode: "recovery", complete: true });
  await expect(composer).toBeVisible();
  await composer.fill("Package network recovery draft");
  await expect(composer).toHaveValue("Package network recovery draft");
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).cwd).toBe(
    initial.cwd,
  );
}
