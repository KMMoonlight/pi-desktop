import { expect, type Page } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function awaitSdkDrainFile(path: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await readFile(path, "utf8").catch(() => "");
    if (value) return value;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(`SDK execution marker did not appear: ${path}`);
}

export async function prepareSdkDrain(agentDir: string) {
  const directory = join(agentDir, "desktop", `sdk-drain-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "sdk-drain.mjs");
  await cp(new URL("./fixtures/sdk-drain.mjs", import.meta.url), path);
  return { path, directory };
}

export async function startSdkDrain(page: Page, reject = false) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = await prepareSdkDrain(snapshot.agentDir);
  const id = randomUUID();
  const pending = sdkAction(page, "sdk.run", {
    ...probe,
    id,
    args: { directory: probe.directory, reject },
  });
  void pending.catch(() => {});
  await awaitSdkDrainFile(join(probe.directory, "sdk-drain-ready.txt"));
  return { ...probe, id, pending, sessionId: snapshot.sessionId };
}

export async function verifySdkDrain(page: Page, reject: boolean) {
  const probe = await startSdkDrain(page, reject);
  try {
    await sdkAction(page, "sdk.cancel", { id: probe.id });
    await awaitSdkDrainFile(join(probe.directory, "sdk-drain-aborted.txt"));
    expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(
      probe.sessionId,
    );
    await writeFile(join(probe.directory, "sdk-drain-release.txt"), "release");
    if (reject)
      await expect(probe.pending).rejects.toThrow("SDK drain caller failure");
    else
      expect(await probe.pending).toEqual({
        aborted: true,
        sessionAlive: true,
        version: "1.0.0",
      });
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("After SDK callback completion");
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).editor.text,
      )
      .toBe("After SDK callback completion");
  } finally {
    await writeFile(join(probe.directory, "sdk-drain-release.txt"), "release");
    await probe.pending.catch(() => {});
  }
}
