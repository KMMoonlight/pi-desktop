import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgsStringToArgv } from "string-argv";

export async function runExternalEditor(
  command: string,
  initial: string,
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const args = parseArgsStringToArgv(command);
  if (!args[0]) throw new Error("外部编辑器命令为空");
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-editor-"));
  const path = join(directory, "prompt.md");
  try {
    await writeFile(path, initial, "utf8");
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(args[0], [...args.slice(1), path], {
        cwd,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let diagnostic = "";
      let forceKill: NodeJS.Timeout | undefined;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        diagnostic = (diagnostic + chunk).slice(-8192);
      });
      const abort = () => {
        child.kill();
        forceKill = setTimeout(() => child.kill("SIGKILL"), 2000);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(forceKill);
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else if (code !== 0)
          reject(
            new Error(
              `外部编辑器退出 (${code})${diagnostic ? ": " + diagnostic.trim() : ""}`,
            ),
          );
        else resolve();
      });
    });
    signal.throwIfAborted();
    return (await readFile(path, "utf8"))
      .replace(/^\uFEFF/, "")
      .replace(/\r?\n$/, "");
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}
