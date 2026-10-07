import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types";

export function verifyNativeProtocolLaunch(page: Page) {
  return verifyNativeAssociationLaunch(page, "protocol");
}

export function verifyNativeFileAssociationLaunch(page: Page) {
  return verifyNativeAssociationLaunch(page, "file");
}

/** Register only fresh disposable keys; never replace an existing association. */
async function verifyNativeAssociationLaunch(
  page: Page,
  kind: "protocol" | "file",
) {
  const file = kind === "file";
  if (process.platform !== "win32")
    throw new Error(
      "The disposable protocol fixture currently requires Windows",
    );
  const { cwd } = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const scheme = `pi-desktop-test-${randomUUID()}`;
  const script = join(cwd, "protocol-receipt.ps1");
  const receipt = join(cwd, "protocol-receipt.txt");
  await writeFile(
    script,
    `param([string]$Url)\n[IO.File]::WriteAllText('${receipt.replaceAll("'", "''")}', $Url)\n`,
  );
  const powershell = join(
    process.env.SystemRoot!,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const command = `"${powershell}" -NoProfile -NonInteractive -WindowStyle Hidden -File "${script}" "%1"`;
  const registry = `HKCU:\\Software\\Classes\\${scheme}`;
  const extensionRegistry = `HKCU:\\Software\\Classes\\.${scheme}`;
  const historyRegistry = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${scheme}`;
  let extensionOwned = false;
  async function run(script: string) {
    const child = spawn(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          PI_PROTOCOL_KEY: registry,
          PI_PROTOCOL_COMMAND: command,
          PI_FILE_EXTENSION_KEY: extensionRegistry,
          PI_FILE_CLASS: scheme,
          PI_FILE_HISTORY_KEY: historyRegistry,
        },
      },
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(output)),
      );
    });
  }
  // Ownership is established before adding values, so cleanup never touches a pre-existing key.
  await run(`$ErrorActionPreference='Stop'
if (Test-Path -LiteralPath $env:PI_PROTOCOL_KEY) { throw 'Protocol already exists' }
New-Item -Path $env:PI_PROTOCOL_KEY | Out-Null`);
  try {
    await run(`$ErrorActionPreference='Stop'
Set-Item -LiteralPath $env:PI_PROTOCOL_KEY -Value 'URL:Pi Desktop disposable test'
${file ? "" : "New-ItemProperty -LiteralPath $env:PI_PROTOCOL_KEY -Name 'URL Protocol' -Value '' | Out-Null"}
$commandKey = Join-Path $env:PI_PROTOCOL_KEY 'shell\\open\\command'
New-Item -Path $commandKey -Force | Out-Null
Set-Item -LiteralPath $commandKey -Value $env:PI_PROTOCOL_COMMAND`);
    const path = join(cwd, "..", `中文 file #1% & (test).${scheme}`);
    if (file) {
      await run(`$ErrorActionPreference='Stop'
if (Test-Path -LiteralPath $env:PI_FILE_EXTENSION_KEY) { throw 'Extension already exists' }
if (Test-Path -LiteralPath $env:PI_FILE_HISTORY_KEY) { throw 'Extension history already exists' }
New-Item -Path $env:PI_FILE_EXTENSION_KEY | Out-Null`);
      extensionOwned = true;
      await run(`$ErrorActionPreference='Stop'
Set-Item -LiteralPath $env:PI_FILE_EXTENSION_KEY -Value $env:PI_FILE_CLASS`);
      await writeFile(path, "Pi Desktop file association check");
    }
    const url = file
      ? `${pathToFileURL(path).href}?line=12#part`
      : `${scheme}:open?file=%E4%B8%AD%E6%96%87%20%231%25&line=12#part`;
    await sdkAction(page, "session.new");
    await sdkAction(page, "prompt", {
      message: `/${file ? "file-link-probe" : "link-probe"} ${url}`,
    });
    const dialog = page.getByRole("dialog");
    for (const component of ["Text", "Markdown"]) {
      await rm(receipt, { force: true });
      await dialog
        .getByRole("link", {
          name: `${component} ${file ? "file" : "custom"}`,
          exact: true,
        })
        .click();
      await expect
        .poll(() => readFile(receipt, "utf8").catch(() => ""), {
          timeout: 15000,
        })
        .toBe(file ? path : url);
    }
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog).toBeHidden();
    if (file) {
      await sdkAction(page, "message.custom", {
        customType: "file-association-check",
        content: `[Associated file](${url})`,
      });
      await rm(receipt, { force: true });
      await page
        .getByRole("link", { name: "Associated file", exact: true })
        .click();
      await expect
        .poll(() => readFile(receipt, "utf8").catch(() => ""), {
          timeout: 15000,
        })
        .toBe(path);
      await rm(path);
      const link = page.getByRole("link", {
        name: "Associated file",
        exact: true,
      });
      await link.click();
      await expect(page.getByRole("alert")).toHaveCount(1);
      await expect(page.getByRole("alert")).not.toHaveText("");
      await page.screenshot({
        path: ".local/screenshots/native-file-missing.png",
      });
      await writeFile(path, "Restored file for retry");
      await rm(receipt, { force: true });
      await link.click();
      await expect
        .poll(() => readFile(receipt, "utf8").catch(() => ""), {
          timeout: 15000,
        })
        .toBe(path);
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
  } finally {
    try {
      if (extensionOwned)
        await run(`$ErrorActionPreference='Stop'
Remove-Item -LiteralPath $env:PI_FILE_EXTENSION_KEY -Recurse -Force
if (Test-Path -LiteralPath $env:PI_FILE_EXTENSION_KEY) { throw 'Extension cleanup failed' }`);
    } finally {
      await run(`$ErrorActionPreference='Stop'
Remove-Item -LiteralPath $env:PI_PROTOCOL_KEY -Recurse -Force
if (Test-Path -LiteralPath $env:PI_PROTOCOL_KEY) { throw 'Protocol cleanup failed' }`);
    }
  }
}
