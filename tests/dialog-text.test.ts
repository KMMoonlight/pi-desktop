import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

test("dialog presentation preserves raw provider options, descriptions and results", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const title = "\x1b[31mTitle\x1b[0m";
    const options = [
      {
        value: "original-id",
        label: "\x1b[1mLabel\x1b[0m",
        description: "\x1b[3mDescription\x1b[0m",
      },
      "\x1b]8;;https://example.com/dialog\x1b\\Read\x1b]8;;\x1b\\",
    ];
    const pending = host.ask({
      kind: "select",
      title,
      options,
      message: "\x1b[4mMessage\x1b[0m",
      placeholder: "\x1b[3mHint\x1b[0m",
    });
    const request = host.pendingDialogs[0];
    assert.equal(request.title, title);
    assert.deepEqual(request.options, options);
    const presentation = request.presentation!;
    assert.equal(presentation.title.text, "Title");
    assert.equal(
      presentation.message?.runs?.[0].style?.textDecorationLine,
      "underline",
    );
    assert.equal(presentation.placeholder?.text, "Hint");
    assert.equal(
      presentation.options?.[0].label.runs?.[0].style?.fontWeight,
      "bold",
    );
    assert.equal(
      presentation.options?.[0].description?.runs?.[0].style?.fontStyle,
      "italic",
    );
    assert.equal(
      presentation.options?.[1].label.runs?.[0].href,
      "https://example.com/dialog",
    );
    host.answer(request.id, "original-id");
    assert.equal(await pending, "original-id");
    assert.equal(host.pendingDialogs.length, 0);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
