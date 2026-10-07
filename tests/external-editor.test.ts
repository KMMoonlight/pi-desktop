import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error("External editor did not reach its expected state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test(
  "external desktop editing quotes paths, preserves drafts, cancels on replacement and cleans temporary files",
  { timeout: 60000 },
  async () => {
    const fixture = await createFixture({ officialEditor: true });
    const host = new DesktopHost(fixture.agentDir);
    const directory = join(fixture.root, "Editor files with spaces");
    await mkdir(directory);
    const script = join(directory, "edit prompt.mjs"),
      ready = join(directory, "ready.json"),
      release = join(directory, "release.txt");
    await writeFile(
      script,
      `import {readFile, writeFile, rename} from "node:fs/promises";
const [ready, release, literal, path] = process.argv.slice(2);
await writeFile(ready + ".tmp", JSON.stringify({path, literal, initial: await readFile(path, "utf8")}));
await rename(ready + ".tmp", ready);
let result;
while (result === undefined) {
  try { result = await readFile(release, "utf8"); } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
}
if (result === "fail") { console.error("fixture failed"); process.exit(7); }
await writeFile(path, "\\uFEFF" + result + "\\r\\n");
`,
    );
    const settingsPath = join(fixture.agentDir, "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    settings.externalEditor = `"${process.execPath}" "${script}" "${ready}" "${release}" "literal $(text) & ;"`;
    await writeFile(settingsPath, JSON.stringify(settings));
    try {
      await host.initialize(fixture.cwd);
      await until(() =>
        host.desktopUI.surfaces.some((surface) => surface.slot === "editor"),
      );
      const ui = () => host.session.extensionRunner.getUIContext();
      let sequence = 0;
      const start = async () => {
        const id = `external-${++sequence}`;
        // Clear fixture coordination files without deleting any user files.
        const { rm } = await import("node:fs/promises");
        await rm(ready, { force: true });
        await rm(release, { force: true });
        const pending = host.action({
          action: "editor.external",
          args: { id },
        });
        await until(async () => {
          try {
            await access(ready);
            return true;
          } catch {
            return false;
          }
        });
        const captured = JSON.parse(await readFile(ready, "utf8"));
        assert.equal(captured.literal, "literal $(text) & ;");
        assert.deepEqual(
          await host.action({ action: "editor.external.status" }),
          { id, running: true },
        );
        return { id, pending, captured };
      };
      const cleaned = (path: string) => assert.rejects(access(dirname(path)));
      const releaseEditor = async (value: string) => {
        await writeFile(release + ".tmp", value);
        await rename(release + ".tmp", release);
      };
      ui().setEditorText("original draft");
      const success = await start();
      assert.equal(success.captured.initial, "original draft");
      await releaseEditor("edited \u4e2d\u6587");
      assert.deepEqual(await success.pending, {
        applied: true,
        cancelled: false,
      });
      assert.equal(ui().getEditorText(), "edited \u4e2d\u6587");
      await cleaned(success.captured.path);

      const conflict = await start();
      ui().setEditorText("new draft");
      ui().setEditorText("edited \u4e2d\u6587");
      await releaseEditor("conflicting result");
      assert.deepEqual(await conflict.pending, {
        applied: false,
        cancelled: false,
      });
      assert.equal(ui().getEditorText(), "edited \u4e2d\u6587");
      assert.deepEqual(
        await host.action({ action: "editor.external.result" }),
        {
          id: conflict.id,
          text: "conflicting result",
          sessionId: host.session.sessionId,
        },
      );
      await cleaned(conflict.captured.path);

      const cancelled = await start();
      await host.action({
        action: "editor.external.cancel",
        args: { id: "another-id" },
      });
      assert.equal(
        (
          (await host.action({ action: "editor.external.status" })) as {
            running: boolean;
          }
        ).running,
        true,
      );
      await host.action({
        action: "editor.external.cancel",
        args: { id: cancelled.id },
      });
      assert.deepEqual(await cancelled.pending, {
        applied: false,
        cancelled: true,
      });
      await cleaned(cancelled.captured.path);

      const replacement = await start();
      await host.action({ action: "session.new" });
      assert.deepEqual(await replacement.pending, {
        applied: false,
        cancelled: true,
      });
      await cleaned(replacement.captured.path);

      const failure = await start();
      const rejection = assert.rejects(failure.pending, /fixture failed/);
      await releaseEditor("fail");
      await rejection;
      await cleaned(failure.captured.path);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);
