import { lstat, realpath, readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, extname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { FileItem, FilePreview } from "../shared/types.ts";

const exec = promisify(execFile);
export function resolveFileLink(value: string): string {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error("文件链接包含无效字符");
  const url = new URL(value);
  if (url.protocol !== "file:") throw new Error("需要 file: 文件链接");
  const path = fileURLToPath(url);
  if (path.includes("\0")) throw new Error("文件路径包含无效字符");
  return path;
}
export async function workspacePath(
  cwd: string,
  input: string,
): Promise<string> {
  const root = await realpath(cwd);
  const target = await realpath(resolve(cwd, input || "."));
  const difference = relative(root, target);
  if (
    difference === ".." ||
    difference.startsWith("..\\") ||
    difference.startsWith("../") ||
    isAbsolute(difference)
  ) {
    throw new Error("路径不在当前工作区内");
  }
  return target;
}
export async function listFiles(
  cwd: string,
  input: string,
  showExcluded = false,
): Promise<FileItem[]> {
  const root = await realpath(cwd);
  const target = await workspacePath(root, input);
  const entries = await readdir(target, { withFileTypes: true });
  const result = await Promise.all(
    entries
      .filter((e) => showExcluded || ![".git", "node_modules", "target"].includes(e.name))
      .map(async (e) => {
        const path = join(target, e.name);
        const info = await lstat(path);
        return {
          name: e.name,
          path: relative(root, path).replaceAll("\\", "/"),
          directory: e.isDirectory(),
          size: info.size,
        };
      }),
  );
  return result.sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
  );
}
export async function previewFile(
  cwd: string,
  input: string,
): Promise<FilePreview> {
  const path = await workspacePath(cwd, input);
  const info = await stat(path);
  if (!info.isFile()) throw new Error("请选择文件");
  if (info.size > 5 * 1024 * 1024) throw new Error("文件超过 5 MB，无法预览");
  const buffer = await readFile(path);
  const mime = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  }[extname(path).toLowerCase()];
  if (mime)
    return {
      path: input,
      content: "",
      image: `data:${mime};base64,${buffer.toString("base64")}`,
      size: info.size,
      truncated: false,
    };
  if (buffer.subarray(0, 8192).includes(0))
    throw new Error("该文件是二进制文件");
  return {
    path: input,
    content: buffer.toString("utf8").slice(0, 200_000),
    size: info.size,
    truncated: info.size > 200_000,
  };
}
export async function gitChanges(
  cwd: string,
): Promise<{ status: string; diff: string }> {
  const options = {
    cwd,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15_000,
  };
  const [status, unstaged, staged] = await Promise.all([
    exec("git", ["status", "--short"], options),
    exec("git", ["-c", "core.quotePath=false", "diff", "--no-ext-diff", "--"], options),
    exec("git", ["-c", "core.quotePath=false", "diff", "--cached", "--no-ext-diff", "--"], options),
  ]);
  return { status: status.stdout, diff: `${staged.stdout}${unstaged.stdout}` };
}
