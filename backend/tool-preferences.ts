import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type ToolPreferences = Record<string, Record<string, boolean>>;

function readPreferences(agentDir: string): ToolPreferences {
  try {
    const value = JSON.parse(
      readFileSync(join(agentDir, "desktop", "tools.json"), "utf8"),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Keep explicit sidebar choices separate from tools activated by extensions or the model. */
export function saveToolPreferences(
  agentDir: string,
  cwd: string,
  session: AgentSession,
  names: string[],
) {
  const preferences = readPreferences(agentDir);
  const overrides = { ...preferences[cwd] };
  const previous = new Set(session.getActiveToolNames());
  const selected = new Set(names);
  for (const tool of session.getAllTools()) {
    if (
      tool.exposure !== "hidden" &&
      previous.has(tool.name) !== selected.has(tool.name)
    )
      overrides[tool.name] = selected.has(tool.name);
  }
  preferences[cwd] = overrides;
  const directory = join(agentDir, "desktop");
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `tools-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(preferences, null, 2));
    renameSync(temporary, join(directory, "tools.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function restoreToolPreferences(
  agentDir: string,
  cwd: string,
  session: AgentSession,
) {
  const overrides = readPreferences(agentDir)[cwd];
  if (!overrides || typeof overrides !== "object") return;
  const active = new Set(session.getActiveToolNames());
  const available = new Set(
    session
      .getAllTools()
      .filter((tool) => tool.exposure !== "hidden")
      .map((tool) => tool.name),
  );
  for (const [name, enabled] of Object.entries(overrides)) {
    if (!available.has(name)) continue;
    if (enabled === true) active.add(name);
    else if (enabled === false) active.delete(name);
  }
  session.setActiveToolsByName([...active]);
}
