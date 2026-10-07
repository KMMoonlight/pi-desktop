import { cp, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { DesktopSnapshot } from "../shared/types.ts";
import { sdkAction } from "./editor-workflows.ts";
import { createPackageNetworkFixture } from "./package-network-fixture.ts";

export const sdkPackageEnvironmentModes = [
  "default-command",
  "legacy-update",
  "legacy-version",
] as const;

export async function verifySdkPackageEnvironment(page: Page) {
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await composer.waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(
    initial.agentDir,
    "desktop",
    `environment-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, "package-environment.mjs");
  await cp(
    new URL("./fixtures/sdk-package-environment.mjs", import.meta.url),
    path,
  );
  for (const mode of sdkPackageEnvironmentModes) {
    const fixture = await createPackageNetworkFixture();
    const cwd = join(directory, mode);
    await mkdir(cwd, { recursive: true });
    try {
      await sdkAction(page, "initialize", { cwd });
      expect(
        await sdkAction(page, "sdk.run", {
          path,
          args: { mode, network: fixture.config },
        }),
        mode,
      ).toEqual({ mode, complete: true });
      console.log(`SDK package environment workflow passed: ${mode}`);
    } finally {
      try {
        await sdkAction(page, "initialize", { cwd: initial.cwd });
      } finally {
        await fixture.close();
      }
    }
  }
  expect(
    await sdkAction(page, "sdk.run", { path, args: { mode: "recovery" } }),
  ).toEqual({ mode: "recovery", complete: true });
  await composer.fill("Package environment recovery draft");
  await expect(composer).toHaveValue("Package environment recovery draft");
  expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).cwd).toBe(
    initial.cwd,
  );
}
