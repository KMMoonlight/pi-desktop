import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listFiles, previewFile } from "../backend/files.ts";

test("file navigation keeps workspace-relative paths through a directory alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-file-alias-"));
  try {
    const workspace = join(root, "workspace");
    const alias = join(root, "alias");
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "src", "中文.txt"), "desktop content");
    await symlink(
      workspace,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.deepEqual(
      (await listFiles(alias, "")).map((file) => file.path),
      ["src"],
    );
    const [file] = await listFiles(alias, "src");
    assert.equal(file.path, "src/中文.txt");
    assert.equal(
      (await previewFile(alias, file.path)).content,
      "desktop content",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
