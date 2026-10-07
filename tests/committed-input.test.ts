import test from "node:test";
import assert from "node:assert/strict";
import { committedInputContext } from "../shared/committed-input.ts";

const confirmed = {
  context: { controlText: "abcdef", selection: { start: 2, end: 4 } },
  committedData: "xx",
  optimisticText: "abxxef",
  editor: {
    text: "SDK xx",
    selection: { start: 6, end: 6 },
    controlVersion: 2,
  },
};

test("queued insertion follows the original SDK caret after its selected-range edit is rebased", () => {
  const captured = {
    controlText: "abxxef",
    editorText: "abxxef",
    controlVersion: 1,
    selection: { start: 4, end: 4 },
  };
  const next = committedInputContext(captured, confirmed);
  assert.deepEqual(next, {
    controlText: "SDK xx",
    editorText: "SDK xx",
    controlVersion: 2,
    selection: { start: 6, end: 6 },
  });
  assert.equal(captured.controlText, "abxxef");
  assert.deepEqual(captured.selection, { start: 4, end: 4 });
});

test("a newer SDK state supersedes an older commit even when text coincides with optimistic text", () => {
  const current = {
    controlText: "abxxef",
    controlVersion: 3,
    selection: { start: 0, end: 0 },
  };
  assert.equal(committedInputContext(current, confirmed), current);
  assert.equal(current.controlText, "abxxef");
});

test("a consuming original handler retains its selected range for the next input", () => {
  const captured = {
    controlText: "abxxef",
    controlVersion: 1,
    selection: { start: 4, end: 4 },
  };
  const next = committedInputContext(captured, {
    ...confirmed,
    editor: {
      text: "abcdef",
      selection: { start: 2, end: 4 },
      controlVersion: 1,
    },
  });
  assert.deepEqual(next.selection, { start: 2, end: 4 });
  assert.equal(next.controlText, "abcdef");
});

test("an original caret-only mutation wins even when confirmed and optimistic text match", () => {
  const captured = {
    controlText: "abxxef",
    controlVersion: 1,
    selection: { start: 4, end: 4 },
  };
  const next = committedInputContext(captured, {
    ...confirmed,
    editor: {
      text: "abxxef",
      selection: { start: 0, end: 0 },
      controlVersion: 2,
    },
  });
  assert.deepEqual(next.selection, { start: 0, end: 0 });
  assert.equal(next.controlVersion, 2);
});

test("a deliberate later native range remains relative to the confirmed suffix", () => {
  const captured = {
    controlText: "abxxef",
    controlVersion: 1,
    selection: { start: 4, end: 6 },
  };
  const next = committedInputContext(captured, {
    ...confirmed,
    editor: {
      text: "ABXYZef",
      selection: { start: 5, end: 5 },
      controlVersion: 1,
    },
  });
  assert.deepEqual(next.selection, { start: 5, end: 7 });
});

test("unversioned contexts retain the previous text-relative selection contract", () => {
  const captured = { controlText: "abxxef", selection: { start: 4, end: 4 } };
  const next = committedInputContext(captured, {
    ...confirmed,
    editor: { text: "ABXYZef", selection: { start: 5, end: 5 } },
  });
  assert.deepEqual(next.selection, { start: 5, end: 5 });
});

test("an unrelated browser context cannot inherit a previous commit's text or version", () => {
  const captured = {
    controlText: "independent",
    controlVersion: 1,
    selection: { start: 3, end: 3 },
  };
  assert.equal(committedInputContext(captured, confirmed), captured);
  assert.equal(committedInputContext(captured), captured);
});
