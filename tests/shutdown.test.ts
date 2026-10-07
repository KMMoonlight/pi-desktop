import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

test("stale SDK contexts cannot shut down a replacement session", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  let shutdowns = 0;
  host.on("event", (event) => {
    if (event.type === "shutdown") shutdowns++;
  });
  try {
    await host.initialize(fixture.cwd);
    const previous = host.session.extensionRunner.createContext();
    await host.action({ action: "session.new" });
    assert.throws(() => previous.shutdown(), /stale/i);
    assert.ok(host.runtime);
    assert.equal(shutdowns, 0);
    const current = host.session.extensionRunner.createContext();
    current.shutdown();
    current.shutdown();
    await assert.rejects(host.action({ action: "session.new" }), /正在关闭/);
    const deadline = Date.now() + 5000;
    while (!shutdowns && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(shutdowns, 1);
    assert.equal(host.runtime, undefined);
    assert.deepEqual(host.desktopUI.surfaces, []);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("concurrent SDK and window shutdown share one original runtime disposal", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let direct: Promise<void> | undefined;
  let disposals = 0;
  try {
    await host.initialize(fixture.cwd);
    const original = host.runtime!.dispose.bind(host.runtime);
    host.runtime!.dispose = async () => {
      disposals++;
      entered();
      await barrier;
      await original();
    };
    host.session.extensionRunner.createContext().shutdown();
    await started;
    direct = host.dispose();
    assert.equal(host.dispose(), direct);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      disposals,
      1,
      "window cleanup must join the SDK shutdown already in progress",
    );
    release();
    await direct;
    assert.equal(host.runtime, undefined);
    await host.dispose();
    assert.equal(disposals, 1);
    await assert.rejects(host.initialize(fixture.cwd), /已关闭/);
  } finally {
    release();
    await direct;
    await host.dispose();
    await fixture.close();
  }
});

test("joined shutdown callers retain the original cleanup error without repeating hooks", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const failure = new Error("Original runtime cleanup failure");
  let calls = 0;
  try {
    await host.initialize(fixture.cwd);
    const original = host.runtime!.dispose.bind(host.runtime);
    host.runtime!.dispose = async () => {
      calls++;
      await original();
      throw failure;
    };
    const first = host.dispose(),
      second = host.dispose();
    const results = await Promise.allSettled([first, second]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.equal(result.reason, failure);
    }
    await assert.rejects(host.dispose(), (error) => error === failure);
    assert.equal(calls, 1);
  } finally {
    await host.dispose().catch(() => {});
    await fixture.close();
  }
});

test(
  "HTTP SDK shutdown flushes its event and completes the original shutdown hook",
  { timeout: 25000 },
  async () => {
    const fixture = await createFixture();
    const marker = join(fixture.root, "http-shutdown.txt");
    await writeFile(
      join(fixture.agentDir, "extensions", "shutdown.ts"),
      `
import { appendFile } from "node:fs/promises";
export default function(pi) {
  pi.on("session_shutdown", async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    await appendFile(${JSON.stringify(marker)}, "quit\\n");
  });
  pi.registerCommand("quit-probe", { handler: (_args, ctx) => {
    ctx.shutdown(); ctx.shutdown();
  }});
}`,
    );
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "backend/server.ts"],
      {
        windowsHide: true,
        env: {
          ...process.env,
          PI_DESKTOP_PORT: "0",
          PI_DESKTOP_AGENT_DIR: fixture.agentDir,
          PI_CODING_AGENT_DIR: fixture.agentDir,
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    const exit = new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );
    let output = "";
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const ready = new Promise<string>((resolve, reject) => {
      startupTimer = setTimeout(
        () => reject(new Error(`HTTP startup timeout: ${output}`)),
        10000,
      );
      child.stderr.on("data", (chunk) => {
        output += chunk;
        const match = /Pi SDK backend: (http:\/\/127\.0\.0\.1:\d+)/.exec(
          output,
        );
        if (match) {
          clearTimeout(startupTimer);
          resolve(match[1]);
        }
      });
      child.once("error", reject);
    });
    const controller = new AbortController();
    try {
      const url = await ready;
      const { token } = (await (await fetch(`${url}/api/token`)).json()) as {
        token: string;
      };
      const action = async (name: string, args: unknown = {}) => {
        const response = await fetch(`${url}/api/action`, {
          method: "POST",
          headers: {
            "x-desktop-token": token,
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: name, args }),
          signal: AbortSignal.timeout(10000),
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      await action("initialize", { cwd: fixture.cwd });
      const response = await fetch(`${url}/api/events?token=${token}`, {
        signal: controller.signal,
      });
      const stream = response.text();
      await action("prompt", { message: "/quit-probe" });
      const events = await stream;
      assert.equal(events.match(/"type":"shutdown"/g)?.length, 1);
      assert.equal(await exit, 0);
      assert.equal(await readFile(marker, "utf8"), "quit\n");
    } finally {
      clearTimeout(startupTimer);
      controller.abort();
      if (child.exitCode === null) {
        child.kill();
        await exit;
      }
      await fixture.close();
    }
  },
);
