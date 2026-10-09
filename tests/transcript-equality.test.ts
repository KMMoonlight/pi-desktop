import test from "node:test";
import assert from "node:assert/strict";
import {
  sameTranscriptValue,
  transcriptSurfaces,
  transcriptExtensionUI,
} from "../src/transcript-equality.ts";
import type { DesktopSurface } from "../shared/desktop-ui.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

test("unchanged transported transcript data is reusable but edits and callbacks invalidate it", () => {
  const before = {
    messages: [{ id: "one", content: [{ text: "Original" }] }],
    busy: false,
  };
  assert.ok(sameTranscriptValue(before, structuredClone(before)));
  const after = structuredClone(before);
  after.messages[0].content[0].text = "Streaming update";
  assert.equal(sameTranscriptValue(before, after), false);
  assert.equal(sameTranscriptValue(before, { ...before, busy: true }), false);
  assert.equal(sameTranscriptValue([1], { 0: 1 }), false);
  assert.equal(sameTranscriptValue({ a: undefined }, { b: undefined }), false);
  assert.equal(sameTranscriptValue({ run() {} }, { run() {} }), false);
});

test("editor updates are excluded while tool and message surfaces still invalidate transcript rendering", () => {
  const surface = (
    slot: DesktopSurface["slot"],
    text: string,
  ): DesktopSurface => ({
    id: slot,
    instanceId: slot,
    slot,
    view: { kind: "text", text },
  });
  const previous = [
    surface("editor", "draft"),
    surface("tool", "result"),
    surface("message", "reply"),
    surface("entry", "entry"),
  ];
  const next = structuredClone(previous);
  next[0].view = { kind: "text", text: "draft changed" };
  assert.ok(
    sameTranscriptValue(transcriptSurfaces(previous), transcriptSurfaces(next)),
  );
  for (const index of [1, 2, 3]) {
    const updated = structuredClone(next);
    updated[index].view = { kind: "text", text: "New content" };
    assert.equal(
      sameTranscriptValue(
        transcriptSurfaces(previous),
        transcriptSurfaces(updated),
      ),
      false,
    );
  }
});

test("transcript extension presentation includes working and thinking updates", () => {
  const ui = {
    workingVisible: true,
    workingMessage: "Working",
    hiddenThinkingLabel: "Thinking",
    textPresentation: { statuses: {} },
  } as DesktopSnapshot["extensionUI"];
  assert.ok(
    sameTranscriptValue(
      transcriptExtensionUI(ui),
      transcriptExtensionUI({ ...ui, inputListeners: 2 }),
    ),
  );
  for (const change of [
    { workingVisible: false },
    { workingMessage: "New status" },
    { hiddenThinkingLabel: "New label" },
  ]) {
    assert.equal(
      sameTranscriptValue(
        transcriptExtensionUI(ui),
        transcriptExtensionUI({ ...ui, ...change }),
      ),
      false,
    );
  }
});
