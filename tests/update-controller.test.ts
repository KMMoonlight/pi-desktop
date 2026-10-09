import test from "node:test";
import assert from "node:assert/strict";
import { UpdateController, type PendingUpdate } from "../src/update-controller.ts";

function fixture(autoDownload = true) {
  const calls = { check: 0, download: 0, install: 0, restart: 0, close: 0 };
  const update: PendingUpdate = {
    version: "0.2.0",
    async download(progress) {
      calls.download++;
      progress({ event: "Started", data: { contentLength: 10 } });
      progress({ event: "Progress", data: { chunkLength: 10 } });
      progress({ event: "Finished" });
    },
    async install() { calls.install++; },
    async close() { calls.close++; },
  };
  const driver = {
    async check(): Promise<PendingUpdate | null> { calls.check++; return update; },
    async restart() { calls.restart++; },
    autoDownload: () => autoDownload,
  };
  return { calls, update, driver, controller: new UpdateController(driver) };
}

test("automatically downloads but never installs without an explicit action", async () => {
  const { controller, calls } = fixture();
  await controller.check();
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(controller.getSnapshot().downloaded, 10);
  assert.equal(calls.install, 0);
  await controller.check();
  assert.equal(calls.check, 1, "periodic checks preserve the downloaded update");
  await controller.install();
  assert.equal(calls.install, 1);
  assert.equal(calls.restart, 1);
});

test("disabled automatic downloads wait for manual download and release replaced resources", async () => {
  const { controller, calls } = fixture(false);
  await controller.check();
  assert.equal(controller.getSnapshot().phase, "available");
  assert.equal(calls.download, 0);
  await controller.check();
  assert.equal(calls.close, 1);
  await controller.download();
  assert.equal(controller.getSnapshot().phase, "ready");
});

test("concurrent checks cannot replace an in-flight update", async () => {
  const { controller, driver, update } = fixture();
  let resolve!: (update: PendingUpdate) => void;
  let checks = 0;
  driver.check = () => { checks++; return new Promise(done => { resolve = done; }); };
  const first = controller.check();
  await Promise.resolve();
  await controller.check();
  assert.equal(checks, 1);
  resolve(update);
  await first;
  assert.equal(controller.getSnapshot().phase, "ready");
});

test("signature failure after Finished never enables installation and can retry", async () => {
  const { controller, update, calls } = fixture();
  const download = update.download;
  update.download = async progress => { progress({ event: "Finished" }); throw new Error("Invalid signature"); };
  await controller.check();
  assert.equal(controller.getSnapshot().phase, "available");
  assert.match(controller.getSnapshot().error!, /Invalid signature/);
  await controller.install();
  assert.equal(calls.install, 0);
  update.download = download;
  await controller.download();
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(controller.getSnapshot().error, undefined);
});

test("network failure is recoverable and no-update results clear stale metadata", async () => {
  const { controller, driver } = fixture();
  driver.check = async () => { throw new Error("offline"); };
  await controller.check();
  assert.equal(controller.getSnapshot().phase, "error");
  driver.check = async () => null;
  await controller.check();
  assert.equal(controller.getSnapshot().phase, "latest");
  assert.equal(controller.getSnapshot().error, undefined);
  assert.equal(controller.getSnapshot().version, undefined);
});

test("install failure preserves retry; restart failure does not reinstall", async () => {
  const { controller, update, driver, calls } = fixture();
  await controller.check();
  const install = update.install;
  update.install = async () => { throw new Error("permission denied"); };
  await controller.install();
  assert.equal(controller.getSnapshot().phase, "ready");
  update.install = install;
  driver.restart = async () => { throw new Error("restart failed"); };
  await controller.install();
  assert.equal(controller.getSnapshot().phase, "installed");
  driver.restart = async () => { calls.restart++; };
  await controller.install();
  assert.equal(calls.install, 1);
  assert.equal(calls.restart, 1);
});

test("unknown content length still reports bytes and serializes download actions", async () => {
  const { controller, update, calls } = fixture(false);
  let finish!: () => void;
  update.download = progress => {
    calls.download++;
    progress({ event: "Started", data: {} });
    progress({ event: "Progress", data: { chunkLength: 42 } });
    return new Promise(resolve => { finish = resolve; });
  };
  await controller.check();
  const downloading = controller.download();
  await controller.download();
  await controller.check();
  assert.equal(calls.download, 1);
  assert.equal(calls.check, 1);
  assert.equal(controller.getSnapshot().total, undefined);
  assert.equal(controller.getSnapshot().downloaded, 42);
  finish();
  await downloading;
  assert.equal(controller.getSnapshot().phase, "ready");
});
