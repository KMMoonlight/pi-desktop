import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { TerminalQueries } from "../backend/terminal-queries.ts";
import { TerminalIO } from "../src/terminal-io.ts";
import type { TerminalQuery } from "../shared/types.ts";

async function fixture() {
  const setup = await createFixture();
  const host = new DesktopHost(setup.agentDir);
  await host.initialize(setup.cwd);
  return {
    host,
    async close() {
      await host.dispose();
      await setup.close();
    },
  };
}

test("mapped color queries use renderer replies through the original Pi parser", async () => {
  const setup = await fixture();
  try {
    setup.host.on("event", (event) => {
      if (event.type === "terminal_query")
        void setup.host.action({
          action: "terminal.query.reply",
          args: {
            id: event.id,
            data: [
              "\x1b]10;rgb:1212/3434/5656\x1b\\",
              "\x1b]11;#abcdef\x07",
              "\x1b[?1;2c",
            ],
          },
        });
    });
    const result = await setup.host.session.extensionRunner
      .getUIContext()
      .custom(async (tui, _theme, _keys, done) => {
        done(await tui.queryTerminalColors({ timeoutMs: 100 }));
        return { render: () => [], invalidate() {} };
      });
    assert.deepEqual(result, {
      foreground: { r: 18, g: 52, b: 86 },
      background: { r: 171, g: 205, b: 239 },
      palette: undefined,
    });
  } finally {
    await setup.close();
  }
});

test("render-only fallback preserves Pi cursor markers with ANSI and wide text", async () => {
  const setup = await fixture();
  try {
    const marker = Reflect.get(await loadTuiApi(), "CURSOR_MARKER");
    setup.host.session.extensionRunner.getUIContext().setHeader((tui) => {
      tui.setShowHardwareCursor(true);
      return {
        render: () => ["first", `\x1b[31m\u754c\x1b[0mA${marker}tail`],
        invalidate() {},
      };
    });
    let surface;
    for (let attempt = 0; attempt < 100; attempt++) {
      surface = setup.host.desktopUI.surfaces.find((s) => s.slot === "header");
      if (surface) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(surface);
    assert.equal(surface.view.kind, "terminal");
    assert.deepEqual(Reflect.get(surface.view, "cursor"), { row: 1, col: 3 });
    assert.equal(Reflect.get(surface.view, "showCursor"), true);
    assert.ok(!Reflect.get(surface.view, "data").includes(marker));
  } finally {
    await setup.close();
  }
});

test("color probes retain original partial timeout and late-reply semantics", async () => {
  const requests: TerminalQuery[] = [];
  const queries = new TerminalQueries((event) => {
    if (event.type === "terminal_query") {
      requests.push(event);
      queries.reply(event.id, ["\x1b]10;rgb:80/40/20\x07"]);
    }
  });
  const late: unknown[] = [];
  const controller = new AbortController();
  try {
    const partial = await queries.colors(
      { timeoutMs: 20, onLateReply: (value) => late.push(value) },
      controller.signal,
    );
    assert.deepEqual(partial, {
      foreground: { r: 128, g: 64, b: 32 },
      background: undefined,
      palette: undefined,
    });
    assert.equal(queries.requests.length, 1);
    queries.reply(requests[0].id, ["\x1b]11;#010203\x07", "\x1b[?1;2c"]);
    assert.deepEqual(late, [{ ...partial, background: { r: 1, g: 2, b: 3 } }]);
    assert.equal(queries.requests.length, 0);
    assert.equal(queries.reply(requests[0].id, ["\x1b[?1;2c"]), false);
  } finally {
    controller.abort();
    queries.dispose();
  }
});

test("cursor mapping scans the visible viewport from bottom to top without mutating Pi lines", async () => {
  const setup = await fixture();
  try {
    const marker = Reflect.get(await loadTuiApi(), "CURSOR_MARKER");
    const lines = Array.from({ length: 304 }, (_, i) => String(i));
    lines[0] = `offscreen${marker}`;
    lines[302] = `earlier${marker}`;
    lines[303] = `\u754c${marker}last`;
    setup.host.session.extensionRunner.getUIContext().setHeader(() => ({
      render: () => lines,
      invalidate() {},
    }));
    let surface;
    for (let attempt = 0; attempt < 100; attempt++) {
      surface = setup.host.desktopUI.surfaces.find((s) => s.slot === "header");
      if (surface) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(surface);
    assert.equal(Reflect.get(surface.view, "rows"), 300);
    assert.deepEqual(Reflect.get(surface.view, "cursor"), { row: 299, col: 2 });
    assert.ok(!Reflect.get(surface.view, "data").includes(marker));
    assert.equal(lines[303], `\u754c${marker}last`);
  } finally {
    await setup.close();
  }
});

test("concurrent probes have independent original parsers and complete palettes", async () => {
  const requests: TerminalQuery[] = [];
  const queries = new TerminalQueries((event) => {
    if (event.type === "terminal_query") requests.push(event);
  });
  const controller = new AbortController();
  try {
    const first = queries.colors({ timeoutMs: 1000 }, controller.signal);
    const second = queries.colors({ timeoutMs: 1000 }, controller.signal);
    for (let attempt = 0; requests.length < 2 && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].data.match(/\x1b\]4;/g)?.length, 16);
    queries.reply(requests[1].id, [
      "\x1b]11;rgb:ffff/0000/8080\x07",
      "\x1b[?1;2c",
    ]);
    queries.reply(requests[0].id, [
      "\x1b]10;#bad-color\x07",
      ...Array.from(
        { length: 16 },
        (_, index) =>
          `\x1b]4;${index};rgb:${index.toString(16).padStart(2, "0")}/20/30\x07`,
      ),
      "\x1b[?1;2c",
    ]);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.foreground, undefined);
    assert.deepEqual(
      a.palette,
      Array.from({ length: 16 }, (_, r) => ({ r, g: 32, b: 48 })),
    );
    assert.deepEqual(b.background, { r: 255, g: 0, b: 128 });
    assert.equal(b.palette, undefined);
    assert.equal(queries.requests.length, 0);
  } finally {
    controller.abort();
    queries.dispose();
  }
});

test("owner disposal settles pending probes and suppresses late extension callbacks", async () => {
  const queries = new TerminalQueries(() => {});
  const controller = new AbortController();
  let late = 0;
  const pending = queries.colors(
    { timeoutMs: 10000, onLateReply: () => late++ },
    controller.signal,
  );
  for (let attempt = 0; !queries.requests.length && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  const request = queries.requests[0];
  assert.ok(request);
  controller.abort();
  assert.deepEqual(await pending, {
    foreground: undefined,
    background: undefined,
    palette: undefined,
  });
  assert.equal(
    queries.reply(request.id, ["\x1b]10;#ffffff\x07", "\x1b[?1;2c"]),
    false,
  );
  assert.equal(late, 0);
  assert.equal(queries.requests.length, 0);
});

test("history replay suppresses device replies while live queries and keyboard input remain responsive", async () => {
  let receive!: (data: string) => void;
  let finish!: () => void;
  const inputs: string[] = [];
  const replies: string[][] = [];
  const io = new TerminalIO(
    {
      onData(listener) {
        receive = listener;
        return { dispose() {} };
      },
      write(_data, callback) {
        finish = callback!;
      },
    },
    (data) => inputs.push(data),
    (_id, data) => replies.push(data),
  );
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  try {
    io.replay("old device queries");
    io.write("live device query");
    io.query({ id: "probe", data: "pending color probe" });
    await tick();
    for (const reply of [
      "\x1b[?1;2c",
      "\x1b[>0;276;0c",
      "\x1b[12;30R",
      "\x1b]10;rgb:11/22/33\x07",
    ])
      receive(reply);
    receive("q");
    receive("\x1b[A");
    finish();
    await tick();
    receive("\x1b[?1;2c");
    finish();
    await tick();
    receive("\x1b]10;rgb:11/22/33\x07");
    receive("\x1b[?1;2c");
    finish();
    assert.deepEqual(inputs, ["q", "\x1b[A", "\x1b[?1;2c"]);
    assert.deepEqual(replies, [["\x1b]10;rgb:11/22/33\x07", "\x1b[?1;2c"]]);
  } finally {
    io.dispose();
  }
});

test("terminal I/O serializes probes with PTY replies and preserves keyboard input", async () => {
  let receive!: (data: string) => void;
  let finish!: () => void;
  const inputs: string[] = [];
  const replies: { id: string; data: string[] }[] = [];
  const frames: string[] = [];
  const io = new TerminalIO(
    {
      onData: (listener) => {
        receive = listener;
        return { dispose() {} };
      },
      write: (data, callback) => {
        assert.equal(typeof data, "string");
        frames.push(data as string);
        finish = callback!;
      },
    },
    (data) => inputs.push(data),
    (id, data) => replies.push({ id, data }),
  );
  try {
    io.write("PTY query");
    io.query({ id: "a", data: "desktop query" });
    io.query({ id: "a", data: "duplicate replay" });
    io.write("next PTY output");
    await new Promise((resolve) => setImmediate(resolve));
    receive("\x1b]10;rgb:11/22/33\x07");
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    receive("keyboard");
    receive("\x1b]10;rgb:44/55/66\x07");
    receive("\x1b[?1;2c");
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    receive("\x1b]11;rgb:77/88/99\x07");
    finish();
    assert.deepEqual(frames, ["PTY query", "desktop query", "next PTY output"]);
    assert.deepEqual(inputs, [
      "\x1b]10;rgb:11/22/33\x07",
      "keyboard",
      "\x1b]11;rgb:77/88/99\x07",
    ]);
    assert.deepEqual(replies, [
      { id: "a", data: ["\x1b]10;rgb:44/55/66\x07", "\x1b[?1;2c"] },
    ]);
  } finally {
    io.dispose();
  }
});
