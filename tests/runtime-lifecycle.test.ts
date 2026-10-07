import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

async function until<T>(
  probe: () => Promise<T>,
  ready: (value: T) => boolean,
  timeout = 10000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (ready(value)) return value;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error("Lifecycle probe timed out");
}

async function startHttp(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  direct = false,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  const child = spawn(
    process.env.PI_DESKTOP_TEST_NODE ?? process.execPath,
    [
      ...(process.env.PI_DESKTOP_TEST_SERVER
        ? [process.env.PI_DESKTOP_TEST_SERVER]
        : ["--import", "tsx", "backend/server.ts"]),
      ...(direct ? ["--sdk-worker"] : []),
    ],
    {
      cwd: process.env.PI_DESKTOP_TEST_CWD ?? resolve("."),
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        PI_DESKTOP_PORT: "0",
        PI_DESKTOP_AGENT_DIR: fixture.agentDir,
        PI_CODING_AGENT_DIR: fixture.agentDir,
        ...extraEnv,
      },
    },
  );
  let stderr = "";
  child.stderr.on("data", (data) => (stderr += data));
  const exit = new Promise<number | null>((done) => child.once("exit", done));
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await exit;
  };
  try {
    const output = await until(
      async () => {
        if (child.exitCode !== null) throw new Error(stderr);
        return stderr;
      },
      (value) => /Pi SDK backend: http:\/\/127\.0\.0\.1:\d+/.test(value),
      30000,
    );
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)![0];
    const { token } = (await (await fetch(url + "/api/token")).json()) as {
      token: string;
    };
    const action = async (action: string, args: unknown = {}) => {
      const response = await fetch(url + "/api/action", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-desktop-token": token,
        },
        body: JSON.stringify({ action, args }),
        signal: AbortSignal.timeout(action === "initialize" ? 30000 : 10000),
      });
      return {
        status: response.status,
        ...((await response.json()) as { data?: any; error?: string }),
      };
    };
    const events = async () => {
      const response = await fetch(`${url}/api/events?token=${token}`, {
        signal: AbortSignal.timeout(15000),
      });
      const text = response.text();
      void text.catch(() => {});
      return { text };
    };
    return { child, exit, stop, url, action, events, stderr: () => stderr };
  } catch (error) {
    await stop();
    await fixture.close();
    throw error;
  }
}

async function installLifecycleProbe(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const marker = join(fixture.root, "shutdown.txt");
  const pidFile = join(fixture.root, "worker-pid.txt");
  const operation = join(fixture.agentDir, "desktop", "pending.mjs");
  const operationStarted = join(fixture.root, "pending-started.txt");
  await writeFile(
    join(fixture.agentDir, "extensions", "lifecycle.ts"),
    `import { appendFile, writeFile } from "node:fs/promises";
export default function(pi) {
  pi.on("session_start", () => writeFile(${JSON.stringify(pidFile)}, String(process.pid)));
  pi.on("session_shutdown", async () => {
    await new Promise(done => setTimeout(done, 100));
    await appendFile(${JSON.stringify(marker)}, "quit\\n");
  });
  pi.registerCommand("quit-probe", { handler: (_args, ctx) => ctx.shutdown() });
}`,
  );
  await writeFile(
    operation,
    `import { writeFile } from "node:fs/promises";
export default async function({ signal, emit }) {
  emit("pending-started");
  await writeFile(${JSON.stringify(operationStarted)}, "ready");
  if (!signal.aborted)
    await new Promise(done => signal.addEventListener("abort", done, {once:true}));
  emit("pending-cancelled");
  return "cancelled";
}`,
  );
  return { marker, pidFile, operation, operationStarted };
}

for (const direct of [true, false]) {
  const transport = direct ? "HTTP SDK" : "HTTP PTY";
  test(
    `${transport} repeated shutdown drains pending responses and waits for process exit`,
    { timeout: 60000 },
    async () => {
      const fixture = await createFixture();
      const { marker, pidFile, operation, operationStarted } =
        await installLifecycleProbe(fixture);
      const backend = await startHttp(fixture, direct);
      try {
        assert.equal(
          (await backend.action("initialize", { cwd: fixture.cwd })).status,
          200,
        );
        const stream = await backend.events();
        const pending = backend.action("sdk.run", {
          path: operation,
          id: "pending",
        });
        void pending.catch(() => {});
        await until(
          () => readFile(operationStarted, "utf8").catch(() => ""),
          (value) => value === "ready",
        );
        const replies = await Promise.all([
          backend.action("shutdown"),
          backend.action("shutdown"),
          backend.action("shutdown"),
        ]);
        for (const reply of replies)
          assert.deepEqual(reply, { status: 200, data: null });
        assert.equal((await pending).data, "cancelled");
        assert.equal(await backend.exit, 0, backend.stderr());
        assert.equal(await readFile(marker, "utf8"), "quit\n");
        const events = await stream.text;
        assert.match(events, /sdk:pending-cancelled/);
        if (!direct) {
          assert.match(events, /"type":"terminal_exit","exitCode":0/);
          const pid = Number(await readFile(pidFile, "utf8"));
          assert.throws(
            () => process.kill(pid, 0),
            "worker must exit before the supervisor",
          );
        }
        await assert.rejects(fetch(backend.url + "/api/token"));
      } finally {
        await backend.stop();
        await fixture.close();
      }
    },
  );

  test(
    `${transport} SDK-context cleanup failure drains its event and exits with an error`,
    { timeout: 60000 },
    async () => {
      const fixture = await createFixture();
      const { marker } = await installLifecycleProbe(fixture);
      const operation = join(fixture.agentDir, "desktop", "failed-cleanup.mjs");
      await writeFile(
        operation,
        `export default function({ runtime }) {
  const original = runtime.dispose.bind(runtime);
  runtime.dispose = async () => { await original(); throw new Error("cleanup fixture failure"); };
}`,
      );
      const backend = await startHttp(fixture, direct);
      try {
        assert.equal(
          (await backend.action("initialize", { cwd: fixture.cwd })).status,
          200,
        );
        assert.equal(
          (await backend.action("sdk.run", { path: operation })).status,
          200,
        );
        const stream = await backend.events();
        assert.equal(
          (await backend.action("prompt", { message: "/quit-probe" })).status,
          200,
        );
        assert.equal(await backend.exit, 1, backend.stderr());
        assert.equal(await readFile(marker, "utf8"), "quit\n");
        const events = await stream.text;
        assert.equal(events.match(/"type":"shutdown"/g)?.length, 1);
        assert.match(events, /"type":"shutdown","exitCode":1/);
        assert.match(events, /cleanup fixture failure/);
        assert.doesNotMatch(backend.stderr(), /UnhandledPromiseRejection/);
      } finally {
        await backend.stop();
        await fixture.close();
      }
    },
  );
}

test(
  "PTY startup exit rejects waiting requests promptly and disposal releases the supervisor",
  { timeout: 25000 },
  async () => {
    const fixture = await createFixture();
    const preload = join(fixture.root, "early-exit.mjs");
    await writeFile(
      preload,
      `if (process.env.PI_DESKTOP_PTY === "1") process.exit(23);`,
    );
    const backend = await startHttp(fixture, false, {
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import="${pathToFileURL(preload).href}"`,
    });
    try {
      const initialization = await backend.action("initialize", {
        cwd: fixture.cwd,
      });
      assert.equal(initialization.status, 400);
      assert.match(initialization.error!, /terminal exited \(23\)/);
      const shutdown = await backend.action("shutdown");
      assert.equal(shutdown.status, 400);
      assert.match(shutdown.error!, /terminal exited \(23\)/);
      assert.equal(await backend.exit, 1);
      assert.doesNotMatch(backend.stderr(), /UnhandledPromiseRejection/);
    } finally {
      await backend.stop();
      await fixture.close();
    }
  },
);

test(
  "PTY unexpected exit rejects a pending request and keeps terminal history accessible",
  { timeout: 25000 },
  async () => {
    const fixture = await createFixture();
    const operation = join(fixture.agentDir, "desktop", "exit.mjs");
    await writeFile(
      operation,
      `export default function() { process.exit(17); }`,
    );
    const backend = await startHttp(fixture);
    try {
      assert.equal(
        (await backend.action("initialize", { cwd: fixture.cwd })).status,
        200,
      );
      assert.equal(
        (await backend.action("sdk.run", { path: operation })).status,
        400,
      );
      const terminal = await until(
        async () => (await backend.action("terminal.snapshot")).data,
        (data) => data?.exitCode === 17,
      );
      assert.ok(Array.isArray(terminal.chunks));
      const repeated = await backend.action("snapshot");
      assert.match(repeated.error!, /terminal has exited/);
      assert.equal((await backend.action("shutdown")).status, 400);
      assert.equal(await backend.exit, 1);
    } finally {
      await backend.stop();
      await fixture.close();
    }
  },
);

for (const mode of [
  "initialize",
  "new session",
  "workspace replacement",
] as const)
  test(`shutdown joins ${mode} that is still constructing its SDK runtime`, async () => {
    const fixture = await createFixture();
    const { marker } = await installLifecycleProbe(fixture);
    let release!: () => void;
    const barrier = new Promise<void>((done) => (release = done));
    let entered!: () => void;
    const started = new Promise<void>((done) => (entered = done));
    let constructions = 0;
    const host = new DesktopHost(fixture.agentDir, {
      runtimeFactory: async (options, original) => {
        const runtime = await original(options);
        if (++constructions === (mode === "initialize" ? 1 : 2)) {
          entered();
          await barrier;
        }
        return runtime;
      },
    });
    let operation: Promise<unknown> | undefined;
    try {
      if (mode !== "initialize") await host.initialize(fixture.cwd);
      operation =
        mode === "new session"
          ? host.action({ action: "session.new" })
          : host.initialize(mode === "initialize" ? fixture.cwd : fixture.root);
      void operation.catch(() => {});
      await started;
      let disposed = false;
      const shutdown = host.dispose().then(() => (disposed = true));
      await new Promise((done) => setImmediate(done));
      assert.equal(
        disposed,
        false,
        "cleanup must join the pending runtime factory",
      );
      release();
      await Promise.allSettled([operation, shutdown]);
      await shutdown;
      assert.equal(host.runtime, undefined);
      assert.deepEqual(host.desktopUI.surfaces, []);
      const expected = mode === "initialize" ? "quit\n" : "quit\nquit\n";
      assert.equal(await readFile(marker, "utf8"), expected);
      await assert.rejects(host.initialize(fixture.cwd), /已关闭/);
    } finally {
      release();
      await operation?.catch(() => {});
      await host.dispose();
      await fixture.close();
    }
  });
