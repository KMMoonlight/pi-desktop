import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const directory = process.argv[2] ?? "release-assets";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const repository = "KMMoonlight/pi-desktop";
const tag = process.env.GITHUB_REF_NAME ?? `v${version}`;
if (tag !== `v${version}`) throw new Error("Release tag must match package.json version");
const platforms = {};
for (const [target, filename] of [
  ["windows-x86_64", `Pi-Desktop_${version}_windows-x64-setup.exe`],
  ["darwin-aarch64", `Pi-Desktop_${version}_macos-arm64.app.tar.gz`],
]) {
  if (!statSync(join(directory, filename)).size) throw new Error(`Empty update: ${filename}`);
  const signature = readFileSync(join(directory, `${filename}.sig`), "utf8").trim();
  if (!signature) throw new Error(`Missing signature: ${filename}`);
  platforms[target] = {
    signature,
    url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`,
  };
}
writeFileSync(join(directory, "latest.json"), JSON.stringify({
  version,
  notes: readFileSync(`docs/releases/${tag}.md`, "utf8"),
  pub_date: new Date().toISOString(),
  platforms,
}, null, 2) + "\n");
writeFileSync(join(directory, "build-info.json"), JSON.stringify({
  version,
  commit: process.env.GITHUB_SHA ?? null,
  workflow: process.env.GITHUB_RUN_ID ? `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  updaterSignature: "Tauri minisign",
  platforms: Object.keys(platforms),
}, null, 2) + "\n");
const checksums = readdirSync(directory).filter(name => name !== "SHA256SUMS").sort().map(name =>
  `${createHash("sha256").update(readFileSync(join(directory, name))).digest("hex")}  ${name}`,
);
writeFileSync(join(directory, "SHA256SUMS"), checksums.join("\n") + "\n");
