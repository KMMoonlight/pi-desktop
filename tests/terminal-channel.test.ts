import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createFixture } from "./fixture.ts";

test(
  "PTY supervisor survives an SDK socket reset and rejects the pending operation",
  { timeout: 30000 },
  async () => {
    const fixture = await createFixture();
    const modulePath = join(fixture.agentDir, "desktop", "reset-channel.mjs");
    const marker = join(fixture.root, "channel-shutdown.txt");
    await writeFile(
      join(fixture.agentDir, "extensions", "shutdown-marker.ts"),
      `
import { appendFile } from "node:fs/promises";
export default function(pi) {
  pi.on("session_shutdown", async () => {
    await new Promise(done => setTimeout(done, 100));
    await appendFile(${JSON.stringify(marker)}, "quit\\n");
  });
}`,
    );
    await writeFile(
      modulePath,
      `
import { Socket } from "node:net";
export default async function () {
  const channel = process._getActiveHandles().find((handle) =>
    handle instanceof Socket && handle.remoteAddress === "127.0.0.1" && handle.remotePort);
  if (!channel) throw new Error("Fixture SDK channel missing");
  channel.resetAndDestroy();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return "reset";
}
`,
    );
    const child = spawn(
      process.env.PI_DESKTOP_TEST_NODE ?? process.execPath,
      process.env.PI_DESKTOP_TEST_SERVER
        ? [process.env.PI_DESKTOP_TEST_SERVER]
        : ["--import", "tsx", "backend/server.ts"],
      {
        cwd: process.env.PI_DESKTOP_TEST_CWD ?? resolve("."),
        env: {
          ...process.env,
          PI_DESKTOP_PORT: "0",
          PI_DESKTOP_AGENT_DIR: fixture.agentDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try {
      const deadline = Date.now() + 15000;
      while (!/http:\/\/127\.0\.0\.1:\d+/.test(stderr)) {
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error("Reset fixture failed to start: " + stderr);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const base = stderr.match(/http:\/\/127\.0\.0\.1:\d+/)![0];
      const { token } = (await (await fetch(base + "/api/token")).json()) as {
        token: string;
      };
      const action = async (action: string, args: unknown = {}) => {
        const response = await fetch(base + "/api/action", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-desktop-token": token,
          },
          body: JSON.stringify({ action, args }),
          signal: AbortSignal.timeout(15000),
        });
        return (await response.json()) as { data?: unknown; error?: string };
      };
      assert.equal(
        (await action("initialize", { cwd: fixture.cwd })).error,
        undefined,
      );
      const reset = await action("sdk.run", { path: modulePath });
      assert.match(
        reset.error ?? "",
        /connection closed|ECONNRESET|socket|destroyed/i,
      );
      assert.equal(child.exitCode, null, stderr);
      assert.equal((await fetch(base + "/api/token")).status, 200);
      assert.ok((await action("terminal.snapshot")).data);
      const late = await action("snapshot");
      assert.match(late.error ?? "", /connection closed|terminal has exited/i);
      const shutdown = await action("shutdown");
      assert.equal(shutdown.error, undefined);
      await exited;
      assert.equal(child.exitCode, 0, stderr);
      assert.equal(await readFile(marker, "utf8"), "quit\n");
      assert.doesNotMatch(
        stderr,
        /Unhandled 'error'|Emitted 'error' event on Interface/,
      );
    } finally {
      if (child.exitCode === null) child.kill();
      await exited;
      await fixture.close();
    }
  },
);
