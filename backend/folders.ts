import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { DirectoryEntry, DirectoryListing } from "../shared/types.ts";

async function directories(
  path: string,
  showDot: boolean,
): Promise<DirectoryEntry[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const result = await Promise.all(
    entries
      .filter((entry) => showDot || !entry.name.startsWith("."))
      .map(async (entry) => {
        const target = join(path, entry.name);
        if (!entry.isDirectory() && !entry.isSymbolicLink()) return undefined;
        if (entry.isSymbolicLink()) {
          try {
            if (!(await stat(target)).isDirectory()) return undefined;
          } catch {
            return undefined;
          }
        }
        return { name: entry.name, path: target };
      }),
  );
  return result
    .filter((entry): entry is DirectoryEntry => !!entry)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
}
async function roots(): Promise<DirectoryEntry[]> {
  if (process.platform !== "win32") return [{ name: "/", path: "/" }];
  const drives = await Promise.all(
    Array.from({ length: 26 }, async (_, index) => {
      const path = `${String.fromCharCode(65 + index)}:\\`;
      try {
        return (await stat(path)).isDirectory()
          ? { name: path, path }
          : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return drives.filter((drive): drive is DirectoryEntry => !!drive);
}
/** Folder selection can leave cwd. File preview continues to use workspacePath. */
export async function browseDirectories(
  input: string,
  showDot = false,
): Promise<DirectoryListing> {
  const path = await realpath(resolve(input || homedir()));
  if (!(await stat(path)).isDirectory()) throw new Error("请选择文件夹");
  const parent = dirname(path) === path ? undefined : dirname(path);
  const ancestors: DirectoryEntry[] = [];
  let ancestor = path;
  while (true) {
    ancestors.unshift({
      name: basename(ancestor) || parse(ancestor).root,
      path: ancestor,
    });
    const next = dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
  const [children, siblings, drives] = await Promise.all([
    directories(path, showDot),
    parent ? directories(parent, showDot).catch(() => []) : Promise.resolve([]),
    roots(),
  ]);
  return {
    path,
    parent,
    home: homedir(),
    ancestors,
    directories: children,
    siblings,
    roots: drives,
  };
}
export async function createDirectory(
  parent: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    /[\\/\x00-\x1f]/.test(trimmed) ||
    isAbsolute(trimmed) ||
    (process.platform === "win32" &&
      (/[<>:"|?*]/.test(trimmed) ||
        /[. ]$/.test(trimmed) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(trimmed)))
  )
    throw new Error("文件夹名称无效");
  const directory = await realpath(parent);
  if (!(await stat(directory)).isDirectory())
    throw new Error("父目录不是文件夹");
  const target = join(directory, trimmed);
  // No recursive creation: collisions and invalid parents stay visible to the user.
  await mkdir(target);
  return target;
}
