import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { browseDirectories, createDirectory } from "../backend/folders.ts";

test("folder selection browses outside cwd and only creates a named child", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-folder-picker-"));
  try {
    await mkdir(join(root, "nested"));
    await mkdir(join(root, ".dot"));
    await writeFile(join(root, "file.txt"), "fixture");
    const listing = await browseDirectories(root);
    assert.deepEqual(
      listing.directories.map((entry) => entry.name),
      ["nested"],
    );
    assert.ok(listing.ancestors.at(-1)?.path === listing.path);
    assert.ok(
      (await browseDirectories(root, true)).directories.some(
        (entry) => entry.name === ".dot",
      ),
    );
    assert.equal(
      await createDirectory(root, "中文 项目"),
      join(listing.path, "中文 项目"),
    );
    await assert.rejects(createDirectory(root, "nested"), /EEXIST/);
    for (const invalid of [
      "../outside",
      "..",
      "bad/name",
      "C:\\outside",
      "CON",
      "bad.",
    ])
      await assert.rejects(createDirectory(root, invalid));
    await assert.rejects(browseDirectories(join(root, "file.txt")), /文件夹/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
