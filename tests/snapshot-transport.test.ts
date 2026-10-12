import assert from "node:assert/strict";
import test from "node:test";
import {
  SnapshotEncoder,
  SnapshotDecoder,
  type DesktopWireEvent,
} from "../shared/snapshot-transport.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
const snapshot = (revision: number, extra: object = {}) =>
  ({
    backendId: "backend",
    sessionId: "session",
    revision,
    messages: [{ id: "m", content: "x".repeat(1_000_000) }],
    editor: { text: "", selection: { start: 0, end: 0 } },
    ...extra,
  }) as unknown as DesktopSnapshot;
const wire = (event: DesktopWireEvent) => JSON.parse(JSON.stringify(event));

test("typing sends only changed leaves and retains transcript identity", () => {
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  const first = decoder.decode(
    wire(encoder.encode({ type: "snapshot", data: snapshot(1) })),
  );
  assert.equal(first?.type, "snapshot");
  if (first?.type !== "snapshot") return;
  const patch = encoder.encode({
    type: "snapshot",
    data: snapshot(2, {
      editor: { text: "hello", selection: { start: 5, end: 5 } },
    }),
  });
  assert.equal(patch.type, "snapshot_patch");
  assert.ok(JSON.stringify(patch).length < 1000);
  const next = decoder.decode(wire(patch));
  assert.equal(next?.type, "snapshot");
  if (next?.type !== "snapshot") return;
  assert.deepEqual(
    next.data,
    snapshot(2, { editor: { text: "hello", selection: { start: 5, end: 5 } } }),
  );
  assert.equal(first.data.messages, next.data.messages);
  assert.equal(first.data.editor.text, "");
});
test("SDK mutation, removals, array replacement and new keys round trip without mutating prior events", () => {
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  const source = snapshot(1, {
    streaming: { text: "old" },
    desktopSurfaces: [{ id: "editor", view: { kind: "textarea", value: "" } }],
  });
  const first = decoder.decode(
    wire(encoder.encode({ type: "snapshot", data: source })),
  )!;
  const old = structuredClone(first);
  source.revision = 2;
  (source.desktopSurfaces[0].view as any).value = "updated";
  source.streaming = undefined;
  (source as any).newField = { nested: [1, 2, 3] };
  assert.deepEqual(
    decoder.decode(wire(encoder.encode({ type: "snapshot", data: source }))),
    wire({ type: "snapshot", data: source }),
  );
  assert.deepEqual(first, old);
  source.revision = 3;
  (source as any).newField.nested.pop();
  assert.deepEqual(
    decoder.decode(wire(encoder.encode({ type: "snapshot", data: source }))),
    wire({ type: "snapshot", data: source }),
  );
});
test("session changes, workspace close and encoder reset establish new baselines", () => {
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  for (const data of [
    snapshot(1),
    snapshot(2, { sessionId: "other" }),
    snapshot(1, { backendId: "restarted" }),
  ]) {
    const event = encoder.encode({ type: "snapshot", data });
    assert.equal(event.type, "snapshot");
    assert.deepEqual(decoder.decode(wire(event)), { type: "snapshot", data });
  }
  decoder.decode(encoder.encode({ type: "workspace_closed", workspaces: [] }));
  assert.equal(
    encoder.encode({ type: "snapshot", data: snapshot(3) }).type,
    "snapshot",
  );
  encoder.reset();
  assert.equal(
    encoder.encode({ type: "snapshot", data: snapshot(4) }).type,
    "snapshot",
  );
});
test("missing or skipped baselines require resync instead of silently applying a corrupt patch", () => {
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  const first = encoder.encode({ type: "snapshot", data: snapshot(1) });
  const second = encoder.encode({ type: "snapshot", data: snapshot(2) });
  const third = encoder.encode({ type: "snapshot", data: snapshot(3) });
  assert.equal(decoder.decode(wire(second)), undefined);
  decoder.decode(wire(first));
  assert.equal(decoder.decode(wire(third)), undefined);
  assert.equal(decoder.decode(wire(second))?.type, "snapshot");
  assert.equal(decoder.decode(wire(third))?.type, "snapshot");
});
