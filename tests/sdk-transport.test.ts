import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { randomUUID, randomBytes } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import {
  sdkRejectionCases,
  sdkInvalidResultCases,
} from "./sdk-transport-cases.ts";
import type { DesktopEvent } from "../shared/types.ts";
import { awaitSdkDrainFile, prepareSdkDrain } from "./sdk-drain-workflows.ts";

type Packet = { data?: unknown; error?: string; status?: number };

for (const kind of ["stdio", "native", "http-sdk", "http-pty"] as const)
  test(
    `${kind} SDK rejection and result matrix preserves replies and stays available`,
    { timeout: 60000 },
    async () => {
      const fixture = await createFixture();
      const path = join(fixture.agentDir, "desktop", "transport.mjs");
      await mkdir(join(fixture.agentDir, "desktop"), { recursive: true });
      await cp(new URL("./fixtures/sdk-transport.mjs", import.meta.url), path);
      const callbackPath = join(
        fixture.agentDir,
        "desktop",
        "runtime-callbacks.mjs",
      );
      await cp(
        new URL("./fixtures/runtime-callbacks.mjs", import.meta.url),
        callbackPath,
      );
      const listener = createServer();
      await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
      const address = listener.address();
      assert.ok(address && typeof address !== "string");
      const token = randomBytes(16).toString("hex");
      const connected = new Promise<Socket>((done) =>
        listener.once("connection", done),
      );
      const isHttp = kind.startsWith("http");
      const child = spawn(
        process.env.PI_DESKTOP_TEST_NODE ?? process.execPath,
        [
          ...(process.env.PI_DESKTOP_TEST_SERVER
            ? [process.env.PI_DESKTOP_TEST_SERVER]
            : ["--import", "tsx", "backend/server.ts"]),
          ...(kind === "native"
            ? ["--desktop-channel"]
            : kind === "stdio"
              ? ["--stdio"]
              : kind === "http-sdk"
                ? ["--sdk-worker"]
                : []),
        ],
        {
          cwd: process.env.PI_DESKTOP_TEST_CWD ?? resolve("."),
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PI_DESKTOP_PORT: "0",
            PI_DESKTOP_AGENT_DIR: fixture.agentDir,
            PI_CODING_AGENT_DIR: fixture.agentDir,
            PI_DESKTOP_LEGACY_EXAMPLE_ADAPTERS: "0",
            PI_DESKTOP_CHANNEL_PORT: String(address.port),
            PI_DESKTOP_CHANNEL_TOKEN: token,
          },
        },
      );
      let stderr = "";
      child.stderr.on("data", (data) => (stderr += data));
      const exit = new Promise<number | null>((done) =>
        child.once("exit", done),
      );
      let channel: Socket | undefined;
      let lines: ReturnType<typeof createInterface> | undefined;
      let request: (
        action: string,
        args?: Record<string, unknown>,
      ) => Promise<Packet>;
      const pending = new Map<
        string,
        {
          resolve(packet: Packet): void;
          reject(error: Error): void;
          timer: ReturnType<typeof setTimeout>;
        }
      >();
      try {
        if (isHttp) {
          const deadline = Date.now() + 30000;
          while (!/Pi SDK backend: http:\/\/127\.0\.0\.1:\d+/.test(stderr)) {
            if (child.exitCode !== null || Date.now() > deadline)
              throw new Error(stderr || "HTTP startup timed out");
            await new Promise((done) => setTimeout(done, 20));
          }
          const url = stderr.match(/http:\/\/127\.0\.0\.1:\d+/)![0];
          const auth = (await (await fetch(url + "/api/token")).json()) as {
            token: string;
          };
          request = async (action, args = {}) => {
            try {
              const response = await fetch(url + "/api/action", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-desktop-token": auth.token,
                },
                body: JSON.stringify({ action, args }),
                signal: AbortSignal.timeout(
                  action === "initialize" ? 30000 : 10000,
                ),
              });
              return {
                status: response.status,
                ...((await response.json()) as Packet),
              };
            } catch (error) {
              throw new Error(`${kind} transport failed during ${action}`, {
                cause: error,
              });
            }
          };
        } else {
          if (kind === "native") {
            channel = await Promise.race([
              connected,
              exit.then(() => {
                throw new Error(stderr);
              }),
              new Promise<never>((_, reject) => {
                const timer = setTimeout(
                  () => reject(new Error("Native startup timed out")),
                  30000,
                );
                connected.then(() => clearTimeout(timer));
                exit.then(() => clearTimeout(timer));
              }),
            ]);
          }
          lines = createInterface({ input: channel ?? child.stdout });
          let authenticated = !channel;
          lines.on("line", (line) => {
            if (!authenticated) {
              assert.equal(line, token);
              authenticated = true;
              return;
            }
            const packet = JSON.parse(line);
            const operation = pending.get(packet.id);
            if (operation) {
              pending.delete(packet.id);
              clearTimeout(operation.timer);
              operation.resolve(packet);
            }
          });
          request = (action, args = {}) =>
            new Promise((resolve, reject) => {
              const id = randomUUID();
              const timer = setTimeout(
                () => {
                  pending.delete(id);
                  reject(new Error(`Transport timeout: ${action}\n${stderr}`));
                },
                action === "initialize" ? 30000 : 10000,
              );
              pending.set(id, { resolve, reject, timer });
              (channel ?? child.stdin).write(
                JSON.stringify({ id, action, args }) + "\n",
              );
            });
        }
        assert.equal(
          (await request("initialize", { cwd: fixture.cwd })).error,
          undefined,
        );
        const operation = (mode: string) =>
          request("sdk.run", { path, args: { mode } });
        for (const [mode, expected] of sdkRejectionCases) {
          const packet = await operation(mode);
          assert.equal(packet.error, expected, mode);
          assert.equal(Object.hasOwn(packet, "data"), false, mode);
          if (isHttp) assert.equal(packet.status, 400, mode);
        }
        for (const [mode, expected] of sdkInvalidResultCases) {
          const packet = await operation(mode);
          assert.match(packet.error!, expected, mode);
          if (isHttp) assert.equal(packet.status, 400, mode);
        }
        assert.equal((await operation("void")).data, null);
        assert.deepEqual((await operation("data")).data, {
          empty: "",
          zero: 0,
          bool: false,
          nullable: null,
          nested: [1, "two"],
        });
        const mixed = await Promise.all([
          operation("empty"),
          operation("data"),
          operation("null"),
          operation("ok"),
        ]);
        assert.equal(mixed[0].error, "");
        assert.equal(mixed[1].error, undefined);
        assert.equal(mixed[2].error, "null");
        assert.equal(mixed[3].data, "SDK transport alive");
        assert.ok((await request("snapshot")).data);
        const callbacks = await request("sdk.run", {
          path: callbackPath,
          args: { mode: "installed" },
        });
        assert.deepEqual(callbacks.data, {
          events: ["before", "rebind", "options"],
          disposed: 1,
          receivers: true,
          preserved: false,
          optionsText: "Callback draft",
          cancelled: false,
          replaced: true,
          hasUI: true,
          text: "Callback draft",
          hasEditor: true,
        });
        assert.doesNotMatch(
          stderr,
          /unhandled|TypeError: Cannot read properties/i,
        );
        const drain = await prepareSdkDrain(fixture.agentDir);
        const rejectedDrain = await prepareSdkDrain(fixture.agentDir);
        const draining = request("sdk.run", {
          path: drain.path,
          args: { directory: drain.directory },
        });
        const rejecting = request("sdk.run", {
          path: rejectedDrain.path,
          args: { directory: rejectedDrain.directory, reject: true },
        });
        void draining.catch(() => {});
        void rejecting.catch(() => {});
        try {
          await awaitSdkDrainFile(join(drain.directory, "sdk-drain-ready.txt"));
          await awaitSdkDrainFile(
            join(rejectedDrain.directory, "sdk-drain-ready.txt"),
          );
          const shutdown = request("shutdown");
          void shutdown.catch(() => {});
          await awaitSdkDrainFile(
            join(drain.directory, "sdk-drain-aborted.txt"),
          );
          await awaitSdkDrainFile(
            join(rejectedDrain.directory, "sdk-drain-aborted.txt"),
          );
          assert.equal(
            child.exitCode,
            null,
            "the transport stays alive until the running SDK callback finishes",
          );
          await writeFile(
            join(drain.directory, "sdk-drain-release.txt"),
            "release",
          );
          assert.deepEqual((await draining).data, {
            aborted: true,
            sessionAlive: true,
            version: "1.0.0",
          });
          assert.equal(
            child.exitCode,
            null,
            "the second SDK callback also owns the shutdown drain",
          );
          await writeFile(
            join(rejectedDrain.directory, "sdk-drain-release.txt"),
            "release",
          );
          assert.equal((await rejecting).error, "SDK drain caller failure");
          assert.equal((await shutdown).error, undefined);
        } finally {
          await writeFile(
            join(drain.directory, "sdk-drain-release.txt"),
            "release",
          );
          await writeFile(
            join(rejectedDrain.directory, "sdk-drain-release.txt"),
            "release",
          );
          await Promise.allSettled([draining, rejecting]);
        }
        assert.equal(await exit, 0, stderr);
      } finally {
        if (child.exitCode === null) child.kill();
        await exit;
        for (const operation of pending.values()) {
          clearTimeout(operation.timer);
          operation.reject(new Error("Transport fixture stopped"));
        }
        channel?.destroy();
        lines?.close();
        listener.close();
        await fixture.close();
      }
    },
  );

test(
  "direct SDK rejection identity and asynchronous extension notices survive non-Error values",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const notices: DesktopEvent[] = [];
    host.on("event", (event) => {
      if (event.type === "notice") notices.push(event);
    });
    try {
      await host.initialize(fixture.cwd);
      for (const value of [
        null,
        undefined,
        false,
        0,
        "",
        42n,
        Symbol("error"),
        {},
        Object.create(null),
      ]) {
        let invoked = false;
        await host
          .withSdk(() => {
            invoked = true;
            throw value;
          })
          .then(
            () => assert.fail("Expected rejection"),
            (error) => assert.equal(error, value),
          );
        assert.ok(invoked);
      }
      const ui = host.session.extensionRunner.getUIContext();
      ui.setHeader(() => {
        throw null;
      });
      ui.setFooter(() => {
        throw undefined;
      });
      ui.setWidget("invalid", () => {
        throw false;
      });
      ui.setEditorComponent(() => {
        throw 0;
      });
      const deadline = Date.now() + 5000;
      while (notices.length < 4 && Date.now() < deadline)
        await new Promise((done) => setTimeout(done, 10));
      assert.deepEqual(
        notices.map((event) => event.type === "notice" && event.message).sort(),
        ["0", "false", "null", "undefined"].sort(),
      );
      ui.setEditorComponent(undefined);
      notices.length = 0;
      const unprintable = Object.create(null);
      host.desktopUI.registerAdapter({
        id: "transport-errors",
        matches: (source) => source === "transport-errors",
        create: () => ({
          view: () => {
            throw unprintable;
          },
          handleAction: () => {},
          invalidate: () => {
            throw unprintable;
          },
          dispose: () => {
            throw unprintable;
          },
        }),
      });
      const surfaceId = await host.desktopUI.mount(
        "transport-errors",
        "header",
      );
      assert.deepEqual(
        host.desktopUI.surfaces.find(({ id }) => id === surfaceId)?.view,
        { kind: "text", text: "Unknown error" },
      );
      host.desktopUI.invalidate();
      assert.doesNotThrow(() => host.snapshot());
      host.desktopUI.close(surfaceId);
      assert.equal(notices.length, 2);
      assert.ok(
        notices.every(
          (event) =>
            event.type === "notice" && event.message === "Unknown error",
        ),
      );
      assert.equal(await host.withSdk(() => "alive"), "alive");
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);
