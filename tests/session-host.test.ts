import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { SessionHost, type SessionWorker } from "../backend/session-host.ts";
import type { ActionRequest, DesktopEvent, DesktopSnapshot, DialogRequest } from "../shared/types.ts";

function fixture() {
  const workers: Worker[] = [];
  class Worker extends EventEmitter implements SessionWorker {
    state?: DesktopSnapshot;
    pendingDialogs: DialogRequest[] = [];
    disposed = false;
    calls: ActionRequest[] = [];
    delayed?: Promise<unknown>;
    constructor(readonly id: string) { super(); }
    snapshot() { return this.state; }
    update(changes: Partial<DesktopSnapshot>) {
      this.state = { ...this.state, ...changes } as DesktopSnapshot;
      this.emit("event", { type: "snapshot", data: this.state });
    }
    async action(request: ActionRequest): Promise<any> {
      this.calls.push(request);
      if (request.action === "initialize") {
        this.update({
          backendId: `worker-${this.id}`, revision: 1, sessionId: this.id,
          sessionFile: String(request.args?.sessionFile ?? `/sessions/${this.id}.jsonl`),
          cwd: String(request.args?.cwd), recentWorkspaces: [String(request.args?.cwd)],
          running: false, busy: false, changing: false,
        });
        return this.state;
      }
      if (request.action === "prompt") { this.update({ running: true, busy: true }); return { accepted: true }; }
      if (request.action === "abort") { this.update({ running: false, busy: false }); return null; }
      if (request.action === "delayed") return this.delayed;
      if (request.action === "sessions.list") return [{ id: "saved", path: "/saved.jsonl", cwd: "/other" }];
      if (request.action === "dialog.answer") {
        this.pendingDialogs = this.pendingDialogs.filter(dialog => dialog.id !== request.args?.id);
        this.emit("event", { type: "dialog_closed", id: request.args?.id });
      }
      return null;
    }
    async dispose() { this.disposed = true; }
  }
  const host = new SessionHost(() => {
    const worker = new Worker(String(workers.length));
    workers.push(worker);
    return worker;
  });
  return { host, workers };
}

test("running sessions survive selection and requests remain scoped to their original owner", async () => {
  const { host, workers } = fixture();
  try {
    await host.action({ action: "initialize", args: { cwd: "/project" } });
    await host.action({ action: "prompt" });
    await host.action({ action: "session.new" });
    await host.action({ action: "prompt" });
    assert.deepEqual(host.snapshot()?.sessionActivity?.map(s => s.running), [true, true]);
    await host.action({ action: "abort", args: { __sessionId: "0" } });
    assert.equal(host.snapshot()?.sessionId, "1");
    assert.deepEqual(host.snapshot()?.sessionActivity?.map(s => s.running), [false, true]);
    await host.action({ action: "session.switch", args: { path: "/sessions/0.jsonl" } });
    assert.equal(host.snapshot()?.sessionId, "0");
    assert.equal(workers.length, 2);
    assert.equal(host.snapshot()?.changing, false);
    await assert.rejects(host.action({ action: "prompt", args: { __sessionId: "missing" } }), /会话已关闭/);
  } finally { await host.dispose(); }
  assert.ok(workers.every(worker => worker.disposed));
});

test("late snapshots and background events cannot overwrite the selected conversation", async () => {
  const { host, workers } = fixture();
  try {
    await host.action({ action: "initialize", args: { cwd: "/project" } });
    let finish!: (snapshot: DesktopSnapshot) => void;
    workers[0].delayed = new Promise(resolve => { finish = resolve; });
    const pending = host.action({ action: "delayed", args: { __sessionId: "0" } });
    await host.action({ action: "session.new" });
    const events: DesktopEvent[] = [];
    host.on("event", event => events.push(event));
    workers[0].update({ running: true });
    workers[0].emit("event", { type: "editor", text: "background draft" });
    workers[0].emit("event", { type: "terminal_output", sequence: 1, data: "background output" });
    workers[0].update({ running: false });
    finish(workers[0].state!);
    assert.equal(await pending, null);
    assert.equal(host.snapshot()?.sessionId, "1");
    assert.equal(host.snapshot()?.sessionActivity?.[0].completed, 1);
    assert.ok(events.every(event => event.type === "snapshot" && event.data.sessionId === "1"));
  } finally { await host.dispose(); }
});

test("background dialogs are retained and replayed only on selecting their owner", async () => {
  const { host, workers } = fixture();
  try {
    await host.action({ action: "initialize", args: { cwd: "/project" } });
    await host.action({ action: "session.new" });
    const events: DesktopEvent[] = [];
    host.on("event", event => events.push(event));
    const dialog = { id: "question-A", title: "A question", kind: "confirm" } as DialogRequest;
    workers[0].pendingDialogs.push(dialog);
    workers[0].emit("event", { type: "dialog", data: dialog });
    assert.equal(host.snapshot()?.sessionActivity?.[0].needsAttention, true);
    assert.deepEqual(host.pendingDialogs, []);
    assert.equal(events.some(event => event.type === "dialog"), false);
    await host.action({ action: "session.switch", args: { path: "/sessions/0.jsonl" } });
    assert.deepEqual(host.pendingDialogs, [dialog]);
    assert.equal(events.some(event => event.type === "dialog"), true);
    await host.action({ action: "session.switch", args: { path: "/sessions/1.jsonl" } });
    await host.action({ action: "dialog.answer", args: { id: dialog.id, value: true } });
    assert.equal(workers[0].pendingDialogs.length, 0);
    assert.equal(host.snapshot()?.sessionId, "1");
  } finally { await host.dispose(); }
});

test("opening saved history uses its exact file without opening another running session first", async () => {
  const { host, workers } = fixture();
  try {
    await host.action({ action: "initialize", args: { cwd: "/project" } });
    await host.action({ action: "prompt" });
    await host.action({ action: "session.switch", args: { path: "/saved.jsonl" } });
    assert.deepEqual(workers[1].calls[0].args, { appearance: undefined, cwd: "/other", sessionFile: "/saved.jsonl" });
    assert.equal(workers[0].state?.running, true);
    assert.equal(host.snapshot()?.sessionFile, "/saved.jsonl");
  } finally { await host.dispose(); }
});

test("one worker failing cannot shut down the other running sessions", async () => {
  const { host, workers } = fixture();
  try {
    await host.action({ action: "initialize", args: { cwd: "/project" } });
    await host.action({ action: "session.new" });
    await host.action({ action: "prompt" });
    const events: DesktopEvent[] = [];
    host.on("event", event => events.push(event));
    workers[0].emit("event", { type: "shutdown", exitCode: 1 });
    assert.equal(events.some(event => event.type === "shutdown"), false);
    assert.equal(host.snapshot()?.running, true);
    assert.equal(host.snapshot()?.sessionActivity?.[0].needsAttention, true);
  } finally { await host.dispose(); }
});
