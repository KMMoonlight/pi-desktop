import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { createInterface, type Interface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
async function until<T>(probe: () => Promise<T>, ready: (value: T) => boolean) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const value = await probe();
    if (ready(value)) return value;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error("Native crash boundary did not arrive");
}
for (const mode of ["sdk", "pty", "native-pty"]) {
  const direct = mode === "sdk",
    native = mode === "native-pty";
  test(
    `native uncaught crash persists and exits from ${native ? "native transport PTY" : direct ? "SDK" : "PTY"} server`,
    { timeout: 60000 },
    async () => {
      const files = await createFixture(),
        gate = join(files.root, "crash-now"),
        module = join(files.agentDir, "desktop", "uncaught.mjs");
      await writeFile(
        module,
        `import { existsSync } from "node:fs";
export default function({ session }) {
  const path = session.resourceLoader.getExtensions().extensions[0].resolvedPath;
  const timer = setInterval(() => { if (!existsSync(${JSON.stringify(gate)})) return; clearInterval(timer); const error = new Error("Native owned uncaught crash"); error.stack = "Error: Native owned uncaught crash\\n    at extension (" + path + ":1:1)"; throw error; }, 10);
  return { sessionFile: session.sessionFile, cwd: session.sessionManager.getCwd(), pid: process.pid };
}`,
      );
      const listener = native ? createServer() : undefined;
      const channelToken = randomBytes(16).toString("hex");
      if (listener)
        await new Promise<void>((done) =>
          listener.listen(0, "127.0.0.1", done),
        );
      const connected = listener
        ? new Promise<Socket>((done) => listener.once("connection", done))
        : undefined;
      const address = listener?.address();
      const child = spawn(
        process.env.PI_DESKTOP_TEST_NODE ?? process.execPath,
        [
          ...(process.env.PI_DESKTOP_TEST_SERVER
            ? [process.env.PI_DESKTOP_TEST_SERVER]
            : ["--import", "tsx", "backend/server.ts"]),
          ...(direct ? ["--sdk-worker"] : []),
          ...(native ? ["--desktop-channel"] : []),
        ],
        {
          windowsHide: true,
          cwd: process.env.PI_DESKTOP_TEST_CWD ?? resolve("."),
          stdio: ["ignore", "ignore", "pipe"],
          env: {
            ...process.env,
            PI_DESKTOP_PORT: "0",
            PI_DESKTOP_AGENT_DIR: files.agentDir,
            PI_CODING_AGENT_DIR: files.agentDir,
            PI_TELEMETRY: "0",
            ...(address && typeof address === "object"
              ? {
                  PI_DESKTOP_CHANNEL_PORT: String(address.port),
                  PI_DESKTOP_CHANNEL_TOKEN: channelToken,
                }
              : {}),
          },
        },
      );
      let output = "";
      child.stderr.on("data", (data) => {
        output += data;
      });
      const exited = new Promise<number | null>((done) =>
        child.once("exit", done),
      );
      let terminalProbe: (() => Promise<unknown>) | undefined;
      let socket: Socket | undefined, lines: Interface | undefined;
      let terminalOutput = "",
        events = "";
      const streamLife = new AbortController();
      let stream: Promise<string> | undefined;
      const observe = (event: {
        type: string;
        data?: string;
        exitCode?: number;
      }) => {
        events += JSON.stringify(event) + "\n";
        if (event.type === "terminal_output") terminalOutput += event.data;
      };
      try {
        let action: (name: string, args: unknown) => Promise<any>;
        if (native) {
          socket = await connected!;
          socket.on("error", () => {});
          lines = createInterface({ input: socket });
          let authenticated = false,
            sequence = 0;
          const pending = new Map<string, (value: any) => void>();
          lines.on("line", (line) => {
            if (!authenticated) {
              assert.equal(line, channelToken);
              authenticated = true;
              return;
            }
            const packet = JSON.parse(line);
            if (packet.event) observe(packet.event);
            if (packet.id) {
              pending.get(packet.id)?.(packet);
              pending.delete(packet.id);
            }
          });
          action = (name, args) =>
            new Promise((done, fail) => {
              const id = String(++sequence);
              const timer = setTimeout(() => {
                pending.delete(id);
                fail(new Error(`Crash transport timeout: ${name}\n${output}`));
              }, 30000);
              pending.set(id, (packet) => {
                clearTimeout(timer);
                packet.error
                  ? fail(new Error(packet.error))
                  : done(packet.data);
              });
              socket!.write(JSON.stringify({ id, action: name, args }) + "\n");
            });
        } else {
          await until(
            async () => {
              if (child.exitCode !== null) throw new Error(output);
              return output;
            },
            (value) => /Pi SDK backend: http:\/\/127\.0\.0\.1:\d+/.test(value),
          );
          const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)![0],
            { token } = (await (await fetch(`${url}/api/token`)).json()) as {
              token: string;
            };
          action = async (name: string, args: unknown) => {
            const response = await fetch(`${url}/api/action`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-desktop-token": token,
              },
              body: JSON.stringify({ action: name, args }),
              signal: AbortSignal.timeout(30000),
            });
            const body = (await response.json()) as {
              data: any;
              error?: string;
            };
            assert.equal(body.error, undefined, body.error);
            return body.data;
          };
          if (!direct) {
            const response = await fetch(`${url}/api/events`, {
              headers: { "x-desktop-token": token },
              signal: streamLife.signal,
            });
            stream = response.text();
            void stream.catch(() => {});
          }
        }
        terminalProbe = () => action("terminal.snapshot", {});
        await action("initialize", { cwd: files.cwd });
        const before = await action("sdk.run", { path: module });
        await writeFile(gate, "ready");
        await until(
          async () => child.exitCode,
          (value) => value !== null,
        );
        assert.equal(await exited, 1, output);
        if (stream) {
          for (const line of (await stream).split("\n"))
            if (line.startsWith("data: ")) observe(JSON.parse(line.slice(6)));
        }
        assert.match(output + terminalOutput, /uncaughtException/);
        assert.match(
          output + terminalOutput,
          /A stack frame came from loaded extension/,
        );
        assert.match(
          stripVTControlCharacters(output + terminalOutput).replace(
            /\s+/g,
            " ",
          ),
          /crash details are attached automatically/,
        );
        if (!direct)
          assert.match(events, /"type":"terminal_exit","exitCode":1/);
        assert.throws(
          () => process.kill(before.pid, 0),
          "SDK worker must exit before its supervisor",
        );
        const records = JSON.parse(
          await readFile(join(files.agentDir, "crashes.json"), "utf8"),
        );
        assert.equal(records.length, 1);
        assert.equal(records[0].kind, "uncaught_exception");
        assert.equal(records[0].message, "Native owned uncaught crash");
        assert.equal(records[0].cwd, before.cwd);
        assert.equal(records[0].sessionFile, before.sessionFile);
        const host = new DesktopHost(files.agentDir);
        try {
          await host.initialize(files.cwd);
          const content = host.desktopUI.terminalRuntime
            .capture()
            .application!.noticeEntries(0)
            .flatMap((entry) => entry.component.render(100))
            .join("\n");
          assert.match(content, /Native owned uncaught crash/);
          assert.match(
            stripVTControlCharacters(content).replace(/\s+/g, " "),
            /crash details are attached automatically/,
          );
          assert.equal(
            (await host.startupPolicies.readCrashes())[0].notified,
            true,
          );
        } finally {
          await host.dispose();
        }
      } catch (error) {
        const report = {
          direct,
          mode,
          pid: child.pid,
          exitCode: child.exitCode,
          output,
          events,
          terminalOutput,
          crash: await readFile(
            join(files.agentDir, "crashes.json"),
            "utf8",
          ).catch(String),
          terminal: await Promise.race([
            terminalProbe?.().catch(String),
            new Promise((done) =>
              setTimeout(() => done("terminal probe timed out"), 1000),
            ),
          ]),
        };
        await writeFile(
          resolve(`.local/startup-policy-crash-diagnostic-${mode}.json`),
          JSON.stringify(report, null, 2),
        );
        throw new Error(`${String(error)}\n${JSON.stringify(report)}`, {
          cause: error,
        });
      } finally {
        streamLife.abort();
        await stream?.catch(() => {});
        socket?.destroy();
        lines?.close();
        listener?.close();
        if (child.exitCode === null) child.kill();
        await exited;
        await files.close();
      }
    },
  );
}
