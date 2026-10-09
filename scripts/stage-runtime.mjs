import { mkdir, cp, readFile, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prepareNative } from "./prepare-native.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "runtime");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        "@earendil-works/pi-coding-agent":
          manifest.dependencies["@earendil-works/pi-coding-agent"],
        "string-argv": manifest.dependencies["string-argv"],
        anser: manifest.dependencies.anser,
        "node-pty": manifest.dependencies["node-pty"],
      },
      overrides: manifest.overrides,
    },
    null,
    2,
  ),
);
// npm run supplies its actual CLI path. Standalone invocation also supports
// Windows' adjacent npm directory and Unix/nvm's lib/node_modules layout.
const npmCandidates = [
  process.env.npm_execpath,
  join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
].filter(Boolean);
let npmCli;
for (const candidate of npmCandidates) {
  try {
    await access(candidate);
    npmCli = candidate;
    break;
  } catch {
    // Try the next supported installation layout.
  }
}
if (!npmCli) throw new Error("Cannot find npm CLI; run npm run runtime:stage.");
const result = spawnSync(
  process.execPath,
  [npmCli, "install", "--omit=dev", "--ignore-scripts", "--prefix", directory],
  { stdio: "inherit", windowsHide: true },
);
if (result.status !== 0)
  throw new Error("Runtime dependency installation failed");
await prepareNative(directory);
await cp(
  join(root, "dist-backend", "server.mjs"),
  join(directory, "server.mjs"),
);
await cp(
  process.execPath,
  join(directory, process.platform === "win32" ? "node.exe" : "node"),
);
console.log("Pi SDK and Node runtime staged for the desktop bundle.");
