import test from "node:test";
import assert from "node:assert/strict";
import { loadTuiApi } from "../backend/tui-api.ts";
import { encodeDesktopKey } from "../shared/keyboard.ts";

test("desktop function keys are recognized by the installed Pi parser", async () => {
  const api = await loadTuiApi();
  for (let number = 1; number <= 12; number++) {
    const key = `F${number}`;
    const data = encodeDesktopKey({ key });
    assert.ok(data);
    assert.equal(api.matchesKey(data, key.toLowerCase()), true, key);
    assert.equal(api.parseKey(data), key.toLowerCase());
  }
});
test("desktop shifted symbols retain Pi's logical and physical key matches", async () => {
  const api = await loadTuiApi();
  for (const phase of [undefined, "release"] as const) {
    const symbol = encodeDesktopKey({
      key: "+",
      ctrlKey: true,
      shiftKey: true,
      type: phase,
    });
    assert.ok(symbol);
    assert.equal(api.matchesKey(symbol, "ctrl++"), true);
    assert.equal(api.matchesKey(symbol, "ctrl+shift++"), true);
    assert.equal(api.matchesKey(symbol, "ctrl+x"), false);
  }
});
