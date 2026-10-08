import { readdir } from "node:fs/promises";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/** Desktop sessions remain selectable even before the first message is sent. */
export function persistDesktopSession(manager: SessionManager) {
  const path = manager.getSessionFile();
  const header = manager.getHeader();
  if (!manager.isPersisted() || !path || !header || existsSync(path)) return;
  const leaf = manager.getLeafId();
  writeFileSync(
    path,
    [header, ...manager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
    { flag: "wx" },
  );
  // Reopen through Pi's public API so subsequent entries append to this file.
  // Merely writing it would leave Pi expecting to create the file on first send.
  manager.setSessionFile(path);
  if (leaf) manager.branch(leaf);
  else manager.resetLeaf();
}

type ActiveSessions = Record<string, { id: string; path: string }>;

function saveActiveSessions(agentDir: string, sessions: ActiveSessions) {
  const directory = join(agentDir, "desktop");
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `active-sessions-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(sessions, null, 2));
    renameSync(temporary, join(directory, "active-sessions.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}

function activeSessions(agentDir: string): ActiveSessions {
  try {
    const value = JSON.parse(
      readFileSync(join(agentDir, "desktop", "active-sessions.json"), "utf8"),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    )
      return {};
    throw error;
  }
}

/** Opening a workspace restores its last selection, even if another file is newer. */
export async function resumeDesktopSession(
  agentDir: string,
  cwd: string,
  sessionDir: string,
) {
  const saved = activeSessions(agentDir)[resolve(cwd)];
  if (
    saved &&
    typeof saved.path === "string" &&
    typeof saved.id === "string" &&
    existsSync(saved.path)
  ) {
    const manager = SessionManager.open(saved.path, sessionDir);
    if (
      manager.getSessionId() === saved.id &&
      resolve(manager.getCwd()) === resolve(cwd)
    )
      return manager;
  }
  // Also covers installations predating the last-opened record and deleted files.
  const recent = (await SessionManager.list(cwd, sessionDir))[0];
  return recent ? SessionManager.open(recent.path, sessionDir) : undefined;
}

/** Keep selection separate from transcript modification times and workspace preferences. */
export function rememberDesktopSession(
  agentDir: string,
  manager: SessionManager,
) {
  const path = manager.getSessionFile();
  if (!manager.isPersisted() || !path || !existsSync(path)) return;
  const sessions = activeSessions(agentDir);
  const cwd = resolve(manager.getCwd());
  const id = manager.getSessionId();
  if (sessions[cwd]?.id === id && sessions[cwd]?.path === path) return;
  sessions[cwd] = { id, path };
  saveActiveSessions(agentDir, sessions);
}

/** Deleted history must not remain the remembered selection of another workspace. */
export function forgetDesktopSession(agentDir: string, id: string, path: string) {
  const sessions = activeSessions(agentDir);
  let changed = false;
  for (const [cwd, selected] of Object.entries(sessions)) {
    if (selected?.id === id && selected?.path === path) {
      delete sessions[cwd];
      changed = true;
    }
  }
  if (changed) saveActiveSessions(agentDir, sessions);
}

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
