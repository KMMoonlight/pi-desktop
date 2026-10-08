import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "src-tauri", "icons");
const generated = mkdtempSync(join(tmpdir(), "pi-desktop-icons-"));
const desktopIcons = [
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.ico",
  "icon.icns",
  "StoreLogo.png",
  ...[30, 44, 71, 89, 107, 142, 150, 284, 310].map(
    (size) => `Square${size}x${size}Logo.png`,
  ),
];

try {
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
      "icon",
      join(root, "src-tauri", "app-icon.svg"),
      "--output",
      generated,
    ],
    { cwd: root, stdio: "inherit" },
  );
  mkdirSync(output, { recursive: true });
  for (const name of desktopIcons)
    copyFileSync(join(generated, name), join(output, name));
  console.log(
    `Updated ${desktopIcons.length} desktop icons from src-tauri/app-icon.svg`,
  );
} finally {
  rmSync(generated, { recursive: true, force: true });
}
