import os from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

let writes = [];
let inputs = [];
let resizes = 0;
let terminal;
let progressTerminal;

export default async function ({ sdk, host, session }, { mode }) {
  if (mode === "setup") {
    writes = [];
    inputs = [];
    host.setClipboard({
      getText: async () => writes.at(-1) ?? null,
      getImage: async () => null,
      setText: async (text) => {
        writes.push(text);
      },
    });
  } else if (mode === "direct-title") {
    host.setWindowTitle("Direct SDK window title");
  } else if (mode === "raw-start" || mode === "raw-initialize") {
    const sdkRequire = createRequire(sdk.getPackageDir() + "/package.json");
    const { ProcessTerminal } = await import(
      pathToFileURL(sdkRequire.resolve("@earendil-works/pi-tui")).href
    );
    terminal = new ProcessTerminal();
    if (mode === "raw-initialize") {
      terminal.hideCursor();
      terminal.write("ConPTY initialization ready\r\n");
    } else {
      terminal.start(
        (data) => inputs.push(data),
        () => {
          resizes++;
        },
      );
      terminal.setTitle("Standalone terminal title");
      terminal.setProgress(true);
      terminal.write("Standalone terminal ready\r\n");
    }
  } else if (mode === "raw-stop") {
    terminal.setProgress(false);
    await terminal.drainInput(20, 1);
    terminal.stop();
    terminal.write("\x1b]2;Standalone OSC 2 title\x1b\\");
  } else if (mode === "copy") {
    const savedPlatform = os.platform;
    const names = [
      "DISPLAY",
      "WAYLAND_DISPLAY",
      "TERMUX_VERSION",
      "WSL_DISTRO_NAME",
      "WSL_INTEROP",
      "WT_SESSION",
    ];
    const saved = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    try {
      // Exercise Pi's original headless fallback without touching the OS clipboard.
      os.platform = () => "linux";
      syncBuiltinESMExports();
      for (const name of names) delete process.env[name];
      await sdk.copyToClipboard("OSC clipboard \u4e2d\u6587 \ud83d\ude00");
      await sdk.copyToClipboard("");
      await sdk.copyToClipboard("x".repeat(75000));
      let oversized;
      try {
        await sdk.copyToClipboard("x".repeat(75001));
      } catch (error) {
        oversized = error.message;
      }
      if (!oversized?.includes("OSC 52 size limit"))
        throw new Error("Missing original SDK clipboard size limit");
    } finally {
      os.platform = savedPlatform;
      syncBuiltinESMExports();
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  } else if (mode === "blocked-child") {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
      process.stdin.setRawMode(true);
      process.stdout.write("\\x1b]2;Blocked child title\\x07\\x1b]9;4;3\\x07\\x1b]52;c;" + Buffer.from("blocked child copy").toString("base64") + "\\x07BLOCKED_TERMINAL_READY\\r\\n");
      process.stdin.once("data", data => {
        process.stdout.write("\\x1b]9;4;0\\x07");
        process.exit(data.toString() === "q" ? 7 : 8);
      });
      process.stdin.resume();
    `,
      ],
      { stdio: "inherit", timeout: 15000, windowsHide: true },
    );
    if (result.status !== 7)
      throw new Error("Blocked child input failed: " + result.status);
  } else if (mode === "owner") {
    const sdkRequire = createRequire(sdk.getPackageDir() + "/package.json");
    const { Text } = await import(
      pathToFileURL(sdkRequire.resolve("@earendil-works/pi-tui")).href
    );
    session.extensionRunner
      .getUIContext()
      .setWidget("independent-terminal-progress", (tui) => {
        progressTerminal = tui.terminal;
        tui.terminal.setProgress(true);
        return new Text("Independent progress owner", 0, 0);
      });
  } else if (mode === "owner-clear") {
    session.extensionRunner
      .getUIContext()
      .setWidget("independent-terminal-progress", undefined);
  } else if (mode === "progress-clear") {
    progressTerminal?.setProgress(false);
  } else if (mode === "cleanup") {
    progressTerminal?.setProgress(false);
    terminal?.setProgress(false);
    terminal?.stop();
    host.setClipboard(undefined);
    host.setWindowTitle("Pi Desktop");
    session.extensionRunner
      .getUIContext()
      .setWidget("independent-terminal-progress", undefined);
  }
  return {
    writes: writes.map((text) => ({
      length: text.length,
      text: text.length < 100 ? text : undefined,
    })),
    inputs,
    resizes,
  };
}
