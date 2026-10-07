import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const execute = promisify(execFile);
for (const mode of [
  "fresh-default",
  "fresh-disabled",
  "env-disabled",
  "env-enabled",
  "offline",
  "upgrade",
  "initial-differential",
])
  test(`unchanged Pi startup policy: ${mode}`, { timeout: 60000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-startup-sdk-"));
    try {
      await execute(
        process.execPath,
        ["--import", "tsx", resolve("tests/fixtures/startup-sdk.mjs"), mode],
        {
          windowsHide: true,
          timeout: 50000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, PI_CODING_AGENT_DIR: root },
        },
      );
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });
