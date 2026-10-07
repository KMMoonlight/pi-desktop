import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createFixture } from "./fixture.ts";
import {
  getPowerShellConfig,
  getShellConfig,
} from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";

test(
  "PTY supplies TTY, resize and input to a synchronous inherited child independently of SDK RPC",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture({ terminalSupport: true });
    const child = spawn(
      process.env.PI_DESKTOP_TEST_NODE ?? process.execPath,
      process.env.PI_DESKTOP_TEST_SERVER
        ? [process.env.PI_DESKTOP_TEST_SERVER]
        : ["--import", "tsx", "backend/server.ts"],
      {
        env: {
          ...process.env,
          SHELL: (process.platform === "win32"
            ? getPowerShellConfig()
            : getShellConfig()
          ).shell,
          PI_DESKTOP_PORT: "0",
          PI_DESKTOP_AGENT_DIR: fixture.agentDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        cwd: process.env.PI_DESKTOP_TEST_CWD,
      },
    );
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const until = async <T>(
      probe: () => Promise<T>,
      predicate: (value: T) => boolean,
    ): Promise<T> => {
      const deadline = Date.now() + 15000;
      let last: T | undefined;
      while (Date.now() < deadline) {
        const value = await probe();
        last = value;
        if (predicate(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(
        "Terminal probe timed out: " +
          stderr +
          "\nLast value: " +
          JSON.stringify(last),
      );
    };
    try {
      await until(
        async () => stderr,
        (value) => /http:\/\/127.0.0.1:\d+/.test(value),
      );
      const base = stderr.match(/http:\/\/127.0.0.1:\d+/)![0];
      const { token } = (await (
        await fetch(base + "/api/token")
      ).json()) as any;
      const action = async (action: string, args = {}): Promise<any> => {
        const result = (await (
          await fetch(base + "/api/action", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-desktop-token": token,
            },
            body: JSON.stringify({ action, args }),
          })
        ).json()) as any;
        if (result.error) throw new Error(result.error);
        return result.data;
      };
      const output = async () =>
        stripVTControlCharacters(
          (await action("terminal.snapshot")).chunks
            .map((chunk: any) => chunk.data)
            .join(""),
        );
      await action("initialize", { cwd: fixture.cwd });
      await action("terminal.resize", { cols: 91, rows: 27 });
      await assert.rejects(
        action("terminal.resize", { cols: 0, rows: 27 }),
        /Invalid terminal size/,
      );
      const running = action("prompt", { message: "/terminal-probe" });
      const ready = await until(output, (value) =>
        value.includes("PTY_READY:"),
      );
      assert.match(ready, /"input":true/);
      assert.match(ready, /"output":true/);
      assert.match(ready, /"cols":91/);
      assert.match(ready, /"rows":27/);
      await until(output, (value) => value.includes("PTY_CWD:"));
      assert.ok((await output()).includes("PTY_CWD:" + fixture.cwd));
      // These actions must complete while spawnSync blocks the worker.
      await action("terminal.resize", { cols: 83, rows: 24 });
      await action("terminal.input", { data: "q" });
      await running;
      await until(output, (value) => value.includes("PTY_INPUT:71"));
      const state = await action("snapshot");
      assert.equal(state.statuses["pty-result"], "PTY_EXIT:7");
      const previous = (await output()).length;
      const cancelled = action("prompt", { message: "/terminal-probe" });
      await until(output, (value) =>
        value.slice(previous).includes("PTY_READY"),
      );
      await action("terminal.input", { data: "\x03" });
      await cancelled;
      assert.equal(
        (await action("snapshot")).statuses["pty-result"],
        "PTY_EXIT:130",
      );
      const raw = action("prompt", { message: "/raw-terminal-probe" });
      await until(output, (value) => value.includes("RAW_READY"));
      await action("terminal.input", { data: "z" });
      await raw;
      await until(
        () => action("snapshot"),
        (value) => value.statuses["raw-result"] === "RAW_OK",
      );
      const official = action("bash", {
        command:
          process.platform === "win32"
            ? "i [Console]::WriteLine('OFFICIAL_READY'); $answer=[Console]::ReadLine(); [Console]::WriteLine('OFFICIAL_INPUT:'+$answer); exit 9"
            : "i printf 'OFFICIAL_READY\\n'; read -r answer; printf 'OFFICIAL_INPUT:%s\\n' \"$answer\"; exit 9",
      });
      const dialogs = await until(
        () => action("dialog.list"),
        (value) => value.length > 0,
      );
      const answer = action("dialog.answer", {
        id: dialogs[0].id,
        value: true,
      });
      await until(output, (value) => value.includes("OFFICIAL_READY"));
      await action("terminal.input", { data: "original-extension\r" });
      const result = await official;
      await answer;
      assert.equal(result.exitCode, 9);
      await until(output, (value) =>
        value.includes("OFFICIAL_INPUT:original-extension"),
      );
      await action("terminal.input", { data: "\x03" });
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.ok(
        await action("snapshot"),
        "Idle Ctrl+C must not kill the SDK worker",
      );
      await action("shutdown");
    } finally {
      child.kill();
      await fixture.close();
    }
  },
);
