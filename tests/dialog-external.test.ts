import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

test(
  "dialog external editing preserves results, retries failures and cancels its own child on closure",
  { timeout: 30000 },
  async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const script = join(
      fixture.agentDir,
      "desktop",
      "fixture external editor.mjs",
    );
    const ready = join(fixture.root, "external-ready.json");
    await writeFile(
      script,
      `import { readFile, writeFile } from "node:fs/promises";
const path = process.argv.at(-1);
const initial = await readFile(path, "utf8");
await writeFile(${JSON.stringify(ready)}, JSON.stringify({path, initial}));
if (initial === "wait") setInterval(() => {}, 1000);
else if (initial === "fail") { console.error("test editor failure"); process.exitCode = 7; }
else await writeFile(path, initial + "\\nEdited result");`,
    );
    try {
      await host.initialize(fixture.cwd);
      const open = () => {
        const result = host.session.extensionRunner
          .getUIContext()
          .editor("External", "draft");
        const id = host.pendingDialogs[0].id;
        return {
          id,
          result,
          edit: (text: string) =>
            host.action({ action: "dialog.external", args: { id, text } }),
        };
      };
      const first = open();
      assert.deepEqual(await first.edit("draft"), {
        text: "draft\nEdited result",
      });
      assert.equal(host.pendingDialogs.length, 1);
      await assert.rejects(first.edit("fail"), /test editor failure/);
      assert.deepEqual(await first.edit("retry"), {
        text: "retry\nEdited result",
      });
      host.answer(first.id, "accepted");
      assert.equal(await first.result, "accepted");
      const second = open();
      const running = second.edit("wait");
      let captured: { path: string; initial: string } | undefined;
      const deadline = Date.now() + 10000;
      while (captured?.initial !== "wait") {
        try {
          captured = JSON.parse(await readFile(ready, "utf8"));
        } catch {}
        if (Date.now() > deadline) throw new Error("Child did not start");
        if (captured?.initial !== "wait")
          await new Promise((resolve) => setTimeout(resolve, 20));
      }
      host.answer(second.id, undefined);
      assert.deepEqual(await running, { cancelled: true });
      assert.equal(await second.result, undefined);
      await assert.rejects(access(dirname(captured.path)));
      assert.deepEqual(await second.edit("stale"), { cancelled: true });
      for (const retire of ["reload", "dispose"]) {
        await rm(ready, { force: true });
        const next = open();
        const running = next.edit("wait");
        let path: string | undefined;
        const deadline = Date.now() + 10000;
        while (!path) {
          try {
            path = JSON.parse(await readFile(ready, "utf8")).path;
          } catch {}
          if (Date.now() > deadline) throw new Error("Child did not start");
          if (!path) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (retire === "reload")
          await host.action({ action: "resources.reload" });
        else await host.dispose();
        assert.deepEqual(await running, { cancelled: true });
        assert.equal(await next.result, undefined);
        assert.equal(host.pendingDialogs.length, 0);
        await assert.rejects(access(dirname(path)));
      }
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);
