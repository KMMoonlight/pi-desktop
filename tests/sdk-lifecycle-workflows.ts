import { expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const sdkLifecycleModes = [
  "cancel",
  "duplicate",
  "replacement",
  "native-api",
] as const;
export async function verifySdkLifecycle(
  page: Page,
  mode: (typeof sdkLifecycleModes)[number],
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await expect(
    page.getByRole("button", { name: "新建会话", exact: true }),
  ).toBeEnabled();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(
    snapshot.agentDir,
    "desktop",
    `SDK-lifecycle-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, "operation.mjs");
  if (mode === "native-api") {
    await writeFile(
      path,
      `export default async context => {
  const before = context.session.sessionId;
  const original = context.runtime;
  const result = await original.newSession({setup: async manager => {
    manager.appendCustomEntry("SDK-api-workflow", {callback:true});
  }});
  const reason = new Error("explicit caller cancellation");
  const controller = new AbortController(); controller.abort(reason);
  let invoked = false, preserved = false;
  try { await context.host.withSdk(() => {invoked = true;}, {}, controller.signal); }
  catch (error) { preserved = error === reason; }
  return { before, after:context.session.sessionId, cancelled:result.cancelled,
    sameRuntime:context.runtime === original, aborted:context.signal.aborted,
    preserved, invoked, version:await context.host.withSdk(({sdk}) => sdk.VERSION),
    callback:context.sessionManager.getEntries().some(entry => entry.customType === "SDK-api-workflow") };
}`,
    );
    const result = await sdkAction<Record<string, any>>(page, "sdk.run", {
      path,
    });
    expect(result.before).not.toBe(result.after);
    expect(result).toMatchObject({
      cancelled: false,
      sameRuntime: true,
      aborted: false,
      preserved: true,
      invoked: false,
      callback: true,
      version: snapshot.version,
    });
    expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(
      result.after,
    );
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveValue("");
    return;
  }
  const ready = join(directory, "ready.txt"),
    release = join(directory, "release.txt"),
    called = join(directory, "called.txt");
  await writeFile(
    path,
    `import {existsSync} from "node:fs";
import {writeFile} from "node:fs/promises";
await writeFile(${JSON.stringify(ready)}, "ready");
while (!existsSync(${JSON.stringify(release)})) await new Promise(done => setTimeout(done, 10));
export default async function() {
  await writeFile(${JSON.stringify(called)}, "called"); return "complete";
}`,
  );
  const id = randomUUID();
  const pending = sdkAction(page, "sdk.run", { path, id });
  void pending.catch(() => {});
  try {
    await expect
      .poll(() => readFile(ready, "utf8").catch(() => ""))
      .toBe("ready");
    if (mode === "cancel") await sdkAction(page, "sdk.cancel", { id });
    else if (mode === "duplicate")
      await expect(sdkAction(page, "sdk.run", { path, id })).rejects.toThrow(
        /already in use/,
      );
    else await sdkAction(page, "session.new");
    await writeFile(release, "release");
    if (mode === "duplicate") {
      expect(await pending).toBe("complete");
      expect(await sdkAction(page, "sdk.run", { path, id })).toBe("complete");
    } else {
      await expect(pending).rejects.toThrow(
        mode === "cancel" ? /aborted/i : /context changed/i,
      );
      await expect(readFile(called)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
  } finally {
    await writeFile(release, "release");
    await pending.catch(() => {});
  }
}
