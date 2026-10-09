import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Accept the runtime inside a finished .app as well as the staging directory.
const runtime = resolve(process.argv[2] ?? join(root, "runtime"));
const node = join(runtime, process.platform === "win32" ? "node.exe" : "node");
const agentDir = await mkdtemp(join(tmpdir(), "pi-runtime-check-"));
const options = {
  cwd: runtime,
  encoding: "utf8",
  timeout: 30000,
  windowsHide: true,
  env: {
    ...process.env,
    PI_DESKTOP_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
  },
};

try {
  const probe = execFileSync(node, ["--input-type=module", "-e", `
    import { createAgentSession } from '@earendil-works/pi-coding-agent';
    import pty from 'node-pty';
    if (typeof createAgentSession !== 'function') throw new Error('SDK missing');
    const terminal = pty.spawn(process.execPath, ['-e', 'process.stdout.write("pi-pty-ok")'], {
      name: 'xterm-256color', cols: 80, rows: 24,
      cwd: process.cwd(), env: process.env,
    });
    let output = '';
    const timer = setTimeout(() => { terminal.kill(); process.exit(1); }, 10000);
    terminal.onData(data => { output += data; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode !== 0 || !output.includes('pi-pty-ok')) process.exit(1);
      console.log('pi-runtime-ok');
    });
  `], options);
  assert.match(probe, /pi-runtime-ok/);

  const response = execFileSync(node, ["server.mjs", "--stdio"], {
    ...options,
    input: JSON.stringify({ id: "packaging-shutdown", action: "shutdown" }) + "\n",
  });
  const messages = response.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  assert.ok(messages.some(message => message.id === "packaging-shutdown" && message.data === null && !message.error));
  console.log(`Verified bundled Node, Pi SDK, PTY and backend: ${runtime}`);
} finally {
  await rm(agentDir, { recursive: true, force: true });
}
