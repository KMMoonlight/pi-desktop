import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/** Pi's explicit listAll directory is flat; desktop defaults group files by project. */
export async function desktopSessionHistory(
  agentDir: string,
  customSessionDir?: string,
) {
  if (customSessionDir) return SessionManager.listAll(customSessionDir);
  const root = join(agentDir, "sessions");
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const folders = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => join(root, entry.name));
  const results = await Promise.all(
    [root, ...folders].map((folder) => SessionManager.listAll(folder)),
  );
  return results
    .flat()
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
}
