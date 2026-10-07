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
