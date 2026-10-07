import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const children = [
  spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "backend/server.ts"],
    { cwd: root, stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      process.env.PI_DESKTOP_UI_PORT ?? "1420",
      "--strictPort",
    ],
    { cwd: root, stdio: "inherit" },
  ),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach((child) => child.kill());
  process.exitCode = code;
}
children.forEach((child) => child.on("exit", (code) => close(code ?? 0)));
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
