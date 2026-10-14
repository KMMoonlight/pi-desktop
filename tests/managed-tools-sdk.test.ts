import test from "node:test";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadManagedTools } from "../backend/managed-tools.ts";

// The native SDK captures getBinDir at import time. Each case needs a fresh
// process, isolated cache and PATH, before importing either SDK or desktop.
const execute = promisify(execFile);
let archiveFixture: Promise<{ root: string; assets: string }> | undefined;
async function archives() {
  return (archiveFixture ??= (async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-managed-assets-"));
    const assets = join(root, "assets");
    await mkdir(assets);
    const api = await loadManagedTools();
    for (const tool of ["fd", "rg"] as const) {
      const located = api.getToolPath(tool);
      if (!located)
        throw new Error(`Real ${tool} binary required for extraction fixture`);
      const binary =
        located.includes("\\") || located.includes("/")
          ? located
          : execFileSync(process.platform === "win32" ? "where.exe" : "which", [located], { encoding: "utf8" })
              .trim()
              .split(/\r?\n/)[0]!;
      const tree = join(root, tool, "nested");
      await mkdir(tree, { recursive: true });
      const name = tool + (process.platform === "win32" ? ".exe" : "");
      await cp(binary, join(tree, name));
      await cp(binary, join(assets, name));
      const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
      if (process.platform === "win32") execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath ${quote(join(root, tool, "nested"))} -DestinationPath ${quote(join(assets, `${tool}.zip`))}`,
        ],
        { windowsHide: true },
      );
      else execFileSync("tar", ["-czf", join(assets, `${tool}.tar.gz`), "-C", join(root, tool), "nested"]);
    }
    return { root, assets };
  })());
}
test.after(async () => {
  if (archiveFixture) {
    const { root } = await archiveFixture;
    await rm(root, { recursive: true, force: true });
  }
});
for (const mode of [
  "preinstalled",
  "offline",
  "download",
  "failure-retry",
  "retire",
]) {
  test(`unchanged Pi tool manager: ${mode}`, { timeout: 90000 }, async () => {
    const { assets } = await archives();
    const root = await mkdtemp(join(tmpdir(), "pi-managed-sdk-"));
    try {
      const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
      await execute(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("tests/fixtures/managed-tools-sdk.mjs"),
          mode,
        ],
        {
          timeout: 80000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            PI_CODING_AGENT_DIR: join(root, "agent"),
            PI_MANAGED_ASSETS: assets,
            PI_OFFLINE: mode === "offline" ? "true" : "0",
            PI_TELEMETRY: "0",
            PATH: process.platform === "win32" ? [
              join(systemRoot, "System32"),
              join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
            ].join(";") : "/usr/bin:/bin",
          },
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
