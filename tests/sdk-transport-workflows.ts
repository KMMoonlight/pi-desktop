import { expect, type Page } from "@playwright/test";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { sdkAction } from "./editor-workflows.ts";
import {
  sdkRejectionCases,
  sdkInvalidResultCases,
} from "./sdk-transport-cases.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifySdkTransport(page: Page) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await expect(
    page.getByRole("button", { name: "新建会话", exact: true }),
  ).toBeEnabled();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(
    snapshot.agentDir,
    "desktop",
    `transport-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, "operation.mjs");
  await cp(new URL("./fixtures/sdk-transport.mjs", import.meta.url), path);
  const client = await build({
    entryPoints: ["src/client.ts"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    globalName: "sdkTransportClient",
    footer: { js: "globalThis.sdkTransportClient = sdkTransportClient;" },
  });
  await page.evaluate(client.outputFiles[0].text);
  const run = (mode: string) =>
    page.evaluate(
      async ({ path, mode }) => {
        const { action } = Reflect.get(window, "sdkTransportClient");
        try {
          return {
            fulfilled: true,
            data: await action("sdk.run", { path, args: { mode } }),
          };
        } catch (error) {
          return {
            fulfilled: false,
            message: error instanceof Error ? error.message : String(error),
            isError: error instanceof Error,
          };
        }
      },
      { path, mode },
    );
  for (const [mode, message] of sdkRejectionCases) {
    expect(await run(mode), mode).toEqual({
      fulfilled: false,
      message,
      isError: true,
    });
  }
  for (const [mode, message] of sdkInvalidResultCases) {
    const result = await run(mode);
    expect(result.fulfilled, mode).toBe(false);
    expect(result.isError, mode).toBe(true);
    expect(result.message, mode).toMatch(message);
  }
  expect(await run("void")).toEqual({ fulfilled: true, data: null });
  expect(await run("data")).toEqual({
    fulfilled: true,
    data: {
      empty: "",
      zero: 0,
      bool: false,
      nullable: null,
      nested: [1, "two"],
    },
  });
  expect(await run("notice")).toEqual({
    fulfilled: true,
    data: "notice requested",
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "null" }),
  ).toBeVisible();
  expect(await run("ok")).toEqual({
    fulfilled: true,
    data: "SDK transport alive",
  });
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
}
