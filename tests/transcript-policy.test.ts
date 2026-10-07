import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { loadComponentRuntime } from "../backend/component-runtime.ts";
import { componentText } from "../backend/component-text.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

function text(view: DesktopNode): string | undefined {
  if (view.kind === "region") return text(view.child);
  if (view.kind === "text") return view.text;
}

async function setup() {
  const fixture = await createFixture({ transcriptPolicy: true });
  const host = new DesktopHost(fixture.agentDir);
  await host.initialize(fixture.cwd);
  const directory = join(fixture.agentDir, "desktop");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "transcript-policy.mjs");
  await cp(new URL("./fixtures/transcript-policy.mjs", import.meta.url), path);
  const image = (await readFile("src-tauri/icons/128x128.png")).toString(
    "base64",
  );
  return {
    host,
    image,
    run: (args: Record<string, unknown>) =>
      host.action({ action: "sdk.run", args: { path, args } }),
    async close() {
      await host.dispose();
      await fixture.close();
    },
  };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Transcript policy did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("assistant completion notices match original Pi stop/tool-call policy and themes without changing SDK content", async () => {
  const { host, run, close } = await setup();
  try {
    await run({ mode: "notices" });
    const api = await loadComponentRuntime();
    const raw = structuredClone(host.session.messages);
    const persisted = await readFile(host.session.sessionFile!, "utf8");
    const snapshot = host.snapshot();
    assert.equal(
      snapshot.messages.filter((message) => message.completionNotice).length,
      6,
    );
    for (const [index, message] of snapshot.messages
      .filter((message) => message.role === "assistant")
      .entries()) {
      const original = new AssistantMessageComponent(
        raw[index] as ConstructorParameters<
          typeof AssistantMessageComponent
        >[0],
      );
      const lines = original
        .render(10000)
        .map((line) => componentText(line, api.text).text.trim())
        .filter(Boolean);
      if (message.completionNotice) {
        assert.equal(message.completionNotice.text, lines.at(-1));
        assert.ok(
          message.completionNotice.runs?.some((run) => run.style?.color),
        );
      } else assert.equal(lines.length, 1);
    }
    assert.deepEqual(host.session.messages, raw);
    assert.equal(await readFile(host.session.sessionFile!, "utf8"), persisted);
    assert.ok(!persisted.includes("completionNotice"));
  } finally {
    await close();
  }
});

test("tool image settings reach original call/result renderers, defaults, metadata, partial results and saved sessions", async () => {
  const { host, image, run, close } = await setup();
  try {
    await run({ mode: "images", image });
    const raw = structuredClone(host.session.messages);
    const api = await loadComponentRuntime();
    const expected = api.image.imageFallback(
      "image/png",
      api.image.getImageDimensions(image, "image/png") ?? undefined,
    );
    for (const visible of [false, true, false]) {
      await run({ visible, width: 9 });
      await until(() =>
        host
          .snapshot()
          .desktopSurfaces.some(
            (surface) =>
              text(surface.view) ===
              `Policy result images: ${visible}; partial: false`,
          ),
      );
      const snapshot = host.snapshot();
      assert.deepEqual(snapshot.toolImages, { visible, widthCells: 9 });
      assert.ok(
        snapshot.desktopSurfaces.some(
          (surface) => text(surface.view) === `Policy call images: ${visible}`,
        ),
      );
      for (const message of snapshot.messages.filter(
        (message) => message.role === "toolResult",
      ))
        assert.equal(message.content[1].imageFallback, expected);
      assert.deepEqual(host.session.messages, raw);
    }
    await run({ mode: "partial", image });
    await until(() =>
      host
        .snapshot()
        .desktopSurfaces.some(
          (surface) =>
            text(surface.view) === "Policy result images: false; partial: true",
        ),
    );
    assert.equal(
      host.snapshot().activeTools[0].output?.[1].imageFallback,
      expected,
    );
    await run({ visible: true });
    await until(() =>
      host
        .snapshot()
        .desktopSurfaces.some(
          (surface) =>
            text(surface.view) === "Policy result images: true; partial: true",
        ),
    );
    await run({ mode: "clearPartial" });
    const path = host.session.sessionFile;
    await host.action({ action: "session.new" });
    await host.action({ action: "session.switch", args: { path } });
    assert.deepEqual(host.snapshot().toolImages, {
      visible: true,
      widthCells: 9,
    });
    assert.deepEqual(host.session.messages, raw);
  } finally {
    await close();
  }
});
