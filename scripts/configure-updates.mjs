import { readFileSync, writeFileSync } from "node:fs";

// CI injects the public key into the shipped config. Private keys remain in secrets.
const configPath = "src-tauri/tauri.conf.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
if (tag && (tag !== `v${version}` || config.version !== version)) {
  throw new Error("Release tag, package.json and tauri.conf.json versions must match");
}
const pubkey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();
const signed = Boolean(pubkey && process.env.TAURI_SIGNING_PRIVATE_KEY);
if (tag && !signed) throw new Error("Tagged releases require TAURI_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY");
if (signed) {
  config.plugins.updater.pubkey = pubkey;
  config.bundle.createUpdaterArtifacts = true;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
console.log(signed ? "Signed updater artifacts enabled" : "Unsigned development build; online updates disabled");
