import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFixture } from "./fixture.ts";

for (const channelKind of ["native", "stdio"])
  for (const mode of [
    "transport",
    "SDK context",
    "overlap",
    "repeated transport",
    "input closed",
    ...(channelKind === "native" ? ["connection reset"] : []),
  ])
    test(
      `${channelKind} desktop transport tolerates extension stdout and shuts down cleanly via ${mode}`,
      { timeout: 40000 },
      async () => {
        const fixture = await createFixture();
        const token = randomBytes(16).toString("hex");
        const listener = createServer();
        await new Promise<void>((resolve) =>
          listener.listen(0, "127.0.0.1", resolve),
        );
        const connected = new Promise<Socket>((resolve) =>
          listener.once("connection", resolve),
        );
        const address = listener.address();
        assert.ok(address && typeof address !== "string");
        const shutdownMarker = join(fixture.root, "shutdown-events.txt");
        await writeFile(
          join(fixture.agentDir, "extensions", "stdio-noise.js"),
          `import { appendFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
export default function(pi) {
    if (${channelKind === "native"}) {
    writeSync(1, "raw extension output\\n");
    spawnSync(process.execPath, ["-e", "process.stdout.write('inherited child output\\\\n')"], { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    writeSync(1, JSON.stringify({event:{type:"shutdown"}}) + "\\nunterminated output");
    }
    process.stdout.write("extension stdout noise\\n");
    console.log("extension log noise");
    pi.on("session_shutdown", async (_event, ctx) => {
      ${mode === "overlap" ? "ctx.shutdown();" : ""}
      await new Promise(resolve => setTimeout(resolve, 30));
      await appendFile(${JSON.stringify(shutdownMarker)}, "quit\\n");
    });
    pi.registerCommand("quit-probe", { handler: (_args, ctx) => {
      ctx.shutdown();
      ctx.shutdown();
    }});
  }`,
        );
        const child = spawn(
          process.env.PI_DESKTOP_TEST_NODE ?? process.execPath,
          process.env.PI_DESKTOP_TEST_SERVER
            ? [
                process.env.PI_DESKTOP_TEST_SERVER,
                channelKind === "native" ? "--desktop-channel" : "--stdio",
              ]
            : [
                "--import",
                "tsx",
                "backend/server.ts",
                channelKind === "native" ? "--desktop-channel" : "--stdio",
              ],
          {
            windowsHide: true,
            env: {
              ...process.env,
              PI_CODING_AGENT_DIR: fixture.agentDir,
              PI_DESKTOP_AGENT_DIR: fixture.agentDir,
              PI_DESKTOP_CHANNEL_PORT: String(address.port),
              PI_DESKTOP_CHANNEL_TOKEN: token,
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let stdout = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        const invalid: string[] = [];
        const events: string[] = [];
        let terminalOutput = "";
        const pending = new Map<string, (value: any) => void>();
        const channel = channelKind === "native" ? await connected : undefined;
        const lines = createInterface({ input: channel ?? child.stdout });
        let authenticated = !channel;
        lines.on("line", (line) => {
          if (!authenticated) {
            assert.equal(line, token);
            authenticated = true;
            return;
          }
          try {
            const value = JSON.parse(line);
            if (value.event) events.push(value.event.type);
            if (value.event?.type === "terminal_output")
              terminalOutput += value.event.data;
            if (value.id) {
              pending.get(value.id)?.(value);
              pending.delete(value.id);
            }
          } catch {
            invalid.push(line);
          }
        });
        const request = (id: string, action: string, args: unknown = {}) =>
          new Promise<any>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(new Error(`Transport timeout: ${action}\n${stderr}`)),
              15000,
            );
            pending.set(id, (value) => {
              clearTimeout(timer);
              resolve(value);
            });
            (channel ?? child.stdin).write(
              JSON.stringify({ id, action, args }) + "\n",
            );
          });
        try {
          const initialized = await request("initialize-call", "initialize", {
            cwd: fixture.cwd,
          });
          assert.equal(initialized.error, undefined, initialized.error);
          assert.equal(initialized.data.cwd, fixture.cwd);
          const output = channel ? terminalOutput : stderr;
          // ConPTY output is independently streamed and may trail the RPC reply.
          if (channel) await new Promise((resolve) => setTimeout(resolve, 150));
          assert.match(
            channel ? terminalOutput : output,
            /extension stdout noise/,
          );
          if (channel) {
            assert.match(terminalOutput, /raw extension output/);
            assert.match(terminalOutput, /inherited child output/);
            assert.equal(events.includes("shutdown"), false);
          }
          assert.match(
            channel ? terminalOutput : stderr,
            /extension log noise/,
          );
          const end = new Promise<number | null>((resolve) =>
            child.once("exit", resolve),
          );
          if (mode === "input closed") (channel ?? child.stdin).end();
          else if (mode === "connection reset") channel!.resetAndDestroy();
          else if (mode === "repeated transport") {
            const replies = await Promise.all(
              [1, 2, 3].map((id) => request(`shutdown-${id}`, "shutdown")),
            );
            for (const reply of replies) assert.equal(reply.error, undefined);
          } else {
            await request(
              "shutdown-call",
              mode === "SDK context" ? "prompt" : "shutdown",
              mode === "SDK context" ? { message: "/quit-probe" } : {},
            );
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const exitCode = await Promise.race([
              end,
              new Promise<string>((resolve) => {
                timer = setTimeout(
                  () => resolve("process still running"),
                  5000,
                );
              }),
            ]);
            if (mode === "connection reset")
              assert.ok(exitCode === 0 || exitCode === 1);
            else
              assert.equal(
                exitCode,
                0,
                JSON.stringify({
                  stderr,
                  events: events.slice(-10),
                  terminalOutput: terminalOutput.slice(-2000),
                }),
              );
          } finally {
            clearTimeout(timer);
          }
          assert.equal(await readFile(shutdownMarker, "utf8"), "quit\n");
          if (mode === "SDK context" || mode === "overlap")
            assert.equal(
              events.filter((type) => type === "shutdown").length,
              1,
            );
          assert.deepEqual(invalid, []);
        } finally {
          child.kill();
          channel?.destroy();
          listener.close();
          lines.close();
          await fixture.close();
        }
      },
    );
