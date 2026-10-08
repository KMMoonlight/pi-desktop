import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
type RunCommand = (file: string, args: string[]) => Promise<string>;
const runCommand: RunCommand = async (file, args) => {
  const { stdout } = await exec(file, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
};

function families(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        // System Profiler can wrap names with bidi display controls. These are
        // presentation markers, not part of the CSS font family name.
        .map((value) =>
          value
            .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
            .trim(),
        )
        .filter(
          (value) =>
            value &&
            !value.startsWith(".") &&
            !value.startsWith("@") &&
            !/[\u0000-\u001f\u007f]/.test(value),
        ),
    ),
  ].sort((a, b) => a.localeCompare(b, "en"));
}

/** Read family names from the local OS, without guessing from font file names. */
export async function readSystemFonts(
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand,
): Promise<string[]> {
  if (platform === "darwin") {
    const report = JSON.parse(
      await run("/usr/sbin/system_profiler", ["SPFontsDataType", "-json"]),
    );
    if (!Array.isArray(report.SPFontsDataType))
      throw new Error("Invalid system font report");
    return families(
      report.SPFontsDataType.flatMap((file: Record<string, unknown>) =>
        file.enabled !== "no" &&
        file.valid !== "no" &&
        Array.isArray(file.typefaces)
          ? file.typefaces
              .filter((face) => face.enabled !== "no" && face.valid !== "no")
              .map((face) => face.family)
          : [],
      ),
    );
  }
  if (platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
      "Add-Type -AssemblyName PresentationCore",
      "ConvertTo-Json -Compress -InputObject @([System.Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source })",
    ].join("; ");
    const report: unknown = JSON.parse(
      (
        await run("powershell.exe", [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          script,
        ])
      ).replace(/^\uFEFF/, ""),
    );
    if (!Array.isArray(report)) throw new Error("Invalid system font report");
    return families(report);
  }
  if (platform === "linux") {
    // Request one canonical family per face; localized aliases may contain commas.
    const report = await run("fc-list", ["--format", "%{family[0]}\n"]);
    return families(report.split(/\r?\n/));
  }
  throw new Error("System font enumeration is unavailable on this platform");
}

let pending: Promise<string[]> | undefined;
let cached: string[] | undefined;
export function listSystemFonts(refresh = false): Promise<string[]> {
  if (!refresh && cached) return Promise.resolve(cached);
  // Keep reopening settings instant; explicit refresh re-reads installed fonts.
  return (pending ??= readSystemFonts()
    .then((result) => {
      cached = result;
      return result;
    })
    .finally(() => {
      pending = undefined;
    }));
}
