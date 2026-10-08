import { chmod, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function prepareNative(directory) {
  if (process.platform !== "darwin") return;
  const require = createRequire(join(directory, "package.json"));
  const packageRoot = dirname(require.resolve("node-pty/package.json"));
  // node-pty 1.1.0 ships macOS prebuilt helpers without execute permissions.
  // Cover both prebuilt binaries and local node-gyp builds.
  for (const location of [
    `prebuilds/darwin-${process.arch}`,
    "build/Release",
    "build/Debug",
  ]) {
    const helper = join(packageRoot, location, "spawn-helper");
    let info;
    try {
      info = await stat(helper);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if ((info.mode & 0o111) !== 0o111) {
      await chmod(helper, (info.mode & 0o777) | 0o111);
      console.log(`Enabled executable permissions: ${helper}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await prepareNative(fileURLToPath(new URL("../", import.meta.url)));
