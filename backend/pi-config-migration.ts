import {
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const legacy = "azure-openai-responses";
const current = "azure";
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const modelKey = (key: string) =>
  key.startsWith(`${legacy}/`)
    ? `${current}/${key.slice(legacy.length + 1)}`
    : key;

function providerKey(value: Record<string, unknown>, merge = false) {
  if (!Object.hasOwn(value, legacy)) return;
  const previous = value[legacy];
  if (!Object.hasOwn(value, current)) value[current] = previous;
  else if (merge && record(previous) && record(value[current]))
    value[current] = { ...previous, ...value[current] };
  delete value[legacy];
}

function migrate(
  path: string,
  transform: (value: Record<string, unknown>) => void,
) {
  let original: string;
  try {
    original = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(original);
  } catch {
    return;
  } // Preserve malformed files for Pi's own diagnostics.
  if (!record(value)) return;
  const before = JSON.stringify(value);
  transform(value);
  if (JSON.stringify(value) === before) return;
  // Dotfile-managed configurations may be symlinks. Replace their target so
  // the user's configuration link remains intact.
  const target = realpathSync(path);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: statSync(target).mode & 0o777,
    });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function settings(value: Record<string, unknown>) {
  if (value.defaultProvider === legacy) value.defaultProvider = current;
  if (Array.isArray(value.enabledModels))
    value.enabledModels = value.enabledModels.map((key) =>
      typeof key === "string" ? modelKey(key) : key,
    );
  if (record(value.modelThinkingLevels)) {
    const levels = value.modelThinkingLevels;
    for (const key of Object.keys(levels)) {
      const next = modelKey(key);
      if (next === key) continue;
      if (!Object.hasOwn(levels, next)) levels[next] = levels[key];
      delete levels[key];
    }
  }
}

/** Run before Pi reads config; trusted project settings are migrated separately. */
export function migratePi120Config(agentDir: string) {
  migrate(join(agentDir, "auth.json"), (value) => providerKey(value));
  migrate(join(agentDir, "models.json"), (value) => {
    if (record(value.providers)) providerKey(value.providers, true);
  });
  migrate(join(agentDir, "settings.json"), settings);
}
export function migratePi120ProjectSettings(cwd: string) {
  migrate(join(cwd, ".pi", "settings.json"), settings);
}
