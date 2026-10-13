import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export function readToolsExpanded(agentDir: string): boolean {
  try {
    const value = JSON.parse(
      readFileSync(join(agentDir, "desktop", "display.json"), "utf8"),
    );
    return value?.toolsExpanded === true;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    )
      return false;
    throw error;
  }
}

export function saveToolsExpanded(agentDir: string, toolsExpanded: boolean) {
  const directory = join(agentDir, "desktop");
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `display-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify({ toolsExpanded }, null, 2));
    renameSync(temporary, join(directory, "display.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}
