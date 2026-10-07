import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolveFileLink } from "../backend/files.ts";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { desktopExternalLink } from "../shared/links.ts";

test("file links preserve native Unicode, spaces and literal hash/percent paths", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    for (const path of [join(fixture.cwd, "中文 file #1%.txt"), fixture.root]) {
      const url = pathToFileURL(path);
      assert.equal(desktopExternalLink(url.href), url.href);
      assert.equal(resolveFileLink(url.href), path);
      assert.deepEqual(
        await host.action({
          action: "files.resolveLink",
          args: { url: url.href },
        }),
        { path },
      );
    }
    assert.throws(() => resolveFileLink("https://example.com/file"), /file:/);
    assert.throws(() => resolveFileLink("file:///C:/a%2Fb.txt"));
    assert.throws(() => resolveFileLink("file:///C:/bad%00.txt"), /无效字符/);
    assert.throws(() => resolveFileLink("file:///C:/bad\n.txt"), /无效字符/);
    const target = join(fixture.root, "存在 file #1%.txt");
    const args = { url: pathToFileURL(target).href, mustExist: true };
    await assert.rejects(
      host.action({ action: "files.resolveLink", args }),
      /文件或文件夹不存在/,
    );
    await writeFile(target, "File exists");
    assert.deepEqual(await host.action({ action: "files.resolveLink", args }), {
      path: target,
    });
    await rm(target);
    await assert.rejects(
      host.action({ action: "files.resolveLink", args }),
      /文件或文件夹不存在/,
    );
    assert.deepEqual(
      await host.action({
        action: "files.resolveLink",
        args: { url: pathToFileURL(fixture.root).href, mustExist: true },
      }),
      { path: fixture.root },
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
