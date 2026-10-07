import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const execute = promisify(execFile);
for (const mode of [
  "automatic",
  "offline",
  "skip-version",
  "version-current",
  "version-invalid",
  "version-failure",
  "tmux-off",
  "tmux-xterm",
  "tmux-good",
  "tmux-timeout",
])
  test(
    `original background startup policies in isolated worker: ${mode}`,
    { timeout: 90000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "pi-startup-policy-sdk-"));
      try {
        await execute(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve("tests/fixtures/startup-policy-sdk.mjs"),
            mode,
          ],
          {
            windowsHide: true,
            timeout: 80000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, PI_CODING_AGENT_DIR: root },
          },
        );
      } finally {
        await rm(root, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      }
    },
  );
