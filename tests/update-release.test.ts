import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-update-release-"));
  mkdirSync(join(cwd, "src-tauri"));
  mkdirSync(join(cwd, "assets"));
  mkdirSync(join(cwd, "docs/releases"), { recursive: true });
  writeFileSync(join(cwd, "docs/releases/v0.2.0.md"), "Test release notes");
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version: "0.2.0" }));
  writeFileSync(join(cwd, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "0.2.0", bundle: {}, plugins: { updater: { pubkey: "" } } }));
  const run = (script: string, env: Record<string, string> = {}) => spawnSync(process.execPath, [resolve("scripts", script), "assets"], {
    cwd, encoding: "utf8", env: { ...process.env, GITHUB_REF_TYPE: "", GITHUB_REF_NAME: "v0.2.0", TAURI_UPDATER_PUBLIC_KEY: "", TAURI_SIGNING_PRIVATE_KEY: "", ...env },
  });
  return { cwd, run, close: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("tag builds fail without signing keys or when version mismatches", () => {
  const f = fixture();
  try {
    assert.notEqual(f.run("configure-updates.mjs", { GITHUB_REF_TYPE: "tag" }).status, 0);
    const mismatch = f.run("configure-updates.mjs", { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.3.0" });
    assert.match(mismatch.stderr, /versions must match/);
    assert.equal(f.run("configure-updates.mjs").status, 0, "unsigned development builds remain available");
    const signed = f.run("configure-updates.mjs", { GITHUB_REF_TYPE: "tag", TAURI_UPDATER_PUBLIC_KEY: "test-public-key", TAURI_SIGNING_PRIVATE_KEY: "test-private-key" });
    assert.equal(signed.status, 0, signed.stderr);
    const output = readFileSync(join(f.cwd, "src-tauri/tauri.conf.json"), "utf8");
    assert.equal(JSON.parse(output).bundle.createUpdaterArtifacts, true);
    assert.equal(JSON.parse(output).plugins.updater.pubkey, "test-public-key");
    assert(!output.includes("test-private-key"));
  } finally { f.close(); }
});

test("manifest requires both signed platforms and pins downloads to release tags", () => {
  const f = fixture();
  try {
    const windows = "Pi-Desktop_0.2.0_windows-x64-setup.exe";
    const mac = "Pi-Desktop_0.2.0_macos-arm64.app.tar.gz";
    writeFileSync(join(f.cwd, "assets", windows), "installer");
    writeFileSync(join(f.cwd, "assets", `${windows}.sig`), "windows-signature\n");
    assert.notEqual(f.run("update-manifest.mjs").status, 0, "partial releases cannot publish a manifest");
    writeFileSync(join(f.cwd, "assets", mac), "archive");
    writeFileSync(join(f.cwd, "assets", `${mac}.sig`), "");
    assert.notEqual(f.run("update-manifest.mjs").status, 0, "empty signatures are rejected");
    writeFileSync(join(f.cwd, "assets", `${mac}.sig`), "mac-signature\n");
    const result = f.run("update-manifest.mjs");
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(f.cwd, "assets/latest.json"), "utf8"));
    assert.equal(manifest.version, "0.2.0");
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ["darwin-aarch64", "windows-x86_64"]);
    assert.equal(manifest.platforms["darwin-aarch64"].signature, "mac-signature");
    assert.match(manifest.platforms["windows-x86_64"].url, /\/releases\/download\/v0\.2\.0\//);
  } finally { f.close(); }
});
