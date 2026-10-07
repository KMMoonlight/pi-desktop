import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { TerminalInputPipeline } from "../backend/terminal-input.ts";
import { createDetachedTui } from "../backend/detached-tui.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import { callComponentMethod } from "../backend/component-runtime.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import { createFixture } from "./fixture.ts";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";

const debugKey = "\x1b[100;6u";
const releaseKey = "\x1b[120;1:3u";
test("direct TUI unsubscribe retains original remove-and-reregister semantics", async () => {
  for (const shared of [false, true]) {
    const tui = await createDetachedTui(() => {});
    Reflect.set(tui, "requestImmediateRender", () => {});
    const pipeline = new TerminalInputPipeline();
    pipeline.initialize(await loadTuiApi());
    if (shared) pipeline.capture().bind(tui);
    let hits = 0;
    const listener = () => {
      hits++;
      return undefined;
    };
    const off = tui.addInputListener(listener);
    tui.removeInputListener(listener);
    tui.addInputListener(listener);
    off();
    if (shared) pipeline.capture().run("x");
    else callComponentMethod(tui, "handleTerminalInput", "x");
    assert.equal(hits, 0);
  }
});
async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function nodes(node: DesktopNode): DesktopNode[] {
  return [node, ...("children" in node ? node.children : []).flatMap(nodes)];
}
async function fixture(componentLibrary = false) {
  const files = await createFixture({ componentLibrary });
  const host = new DesktopHost(files.agentDir);
  await host.initialize(files.cwd);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text");
  const send = (surfaceId: string, data: string, extra = {}) =>
    host.action({
      action: "desktop.input",
      args: { surfaceId, data, ...extra },
    });
  return {
    host,
    api,
    Text,
    send,
    async close() {
      await host.dispose();
      await files.close();
    },
  };
}

test("shared listener transformations, live Set mutation and debug match native TUI dispatch", async () => {
  const api = await loadTuiApi();
  const traces: string[][] = [];
  for (const shared of [false, true]) {
    const trace: string[] = [];
    traces.push(trace);
    const native = await createDetachedTui(() => {});
    Reflect.set(native, "requestImmediateRender", () => {});
    const pipeline = new TerminalInputPipeline();
    pipeline.initialize(api);
    if (shared) pipeline.capture().bind(native);
    const third = (data: string) => {
      trace.push(`third:${data}`);
      return undefined;
    };
    const duplicate = (data: string) => {
      trace.push(`duplicate:${data}`);
      return undefined;
    };
    const removed = (data: string) => {
      trace.push(`removed:${data}`);
      return undefined;
    };
    native.addInputListener((data) => {
      trace.push(`first:${data}`);
      native.removeInputListener(removed);
      native.addInputListener(third);
      if (data === "empty") return { data: "" };
      if (data === "consume") return { consume: true };
      return { data: data === "debug" ? debugKey : `${data}!` };
    });
    native.addInputListener(removed);
    native.addInputListener(duplicate);
    native.addInputListener(duplicate);
    native.onDebug = function (this: DesktopTui) {
      assert.equal(this, native);
      trace.push("debug");
    };
    native.setFocus({
      render: () => [],
      invalidate() {},
      wantsKeyRelease: true,
      handleInput: (data) => trace.push(`target:${data}`),
    });
    for (const data of ["key", releaseKey, "empty", "consume", "debug"]) {
      if (shared) {
        const result = pipeline.capture().run(data);
        if (!result.consume) trace.push(`target:${result.data}`);
      } else callComponentMethod(native, "handleTerminalInput", data);
    }
  }
  assert.deepEqual(traces[1], traces[0]);
  assert.equal(
    traces[0].filter((entry) => entry.startsWith("removed:")).length,
    0,
  );
  assert.equal(traces[0].filter((entry) => entry === "debug").length, 1);
});

test("factory listeners affect other factories and the default editor once in registration order", async () => {
  const f = await fixture();
  const calls: string[] = [];
  let first!: DesktopTui, second!: DesktopTui;
  try {
    const ui = f.host.session.extensionRunner.getUIContext();
    const off = ui.onTerminalInput((data) => {
      calls.push(`context:${data}`);
      return undefined;
    });
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        first = tui;
        tui.addInputListener((data) => {
          calls.push(`header:${data}`);
          return { data: `${data}H` };
        });
        return new f.Text("Header listener");
      },
      "header",
      "header",
    );
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        second = tui;
        tui.addInputListener((data) => {
          calls.push(`footer:${data}`);
          return { data: `${data}F` };
        });
        return new f.Text("Footer listener");
      },
      "footer",
      "footer",
    );
    const input = new f.api.Input();
    await f.host.desktopUI.mount(() => input, "aboveEditor", "input");
    f.host.desktopUI.focus("input");
    await f.send("input", "a");
    assert.equal(input.getValue(), "aHF");
    assert.deepEqual(calls.splice(0), ["context:a", "header:a", "footer:aH"]);
    const result = (await f.send("editor", "b")) as {
      editor: { text: string };
    };
    assert.equal(result.editor.text, "bHF");
    assert.equal(f.host.desktopUI.getEditorRawText(), "bHF");
    assert.deepEqual(calls.splice(0), ["context:b", "header:b", "footer:bH"]);
    off();
    const removed = (data: string) => {
      calls.push(`remove:${data}`);
      return undefined;
    };
    first.addInputListener(removed);
    second.removeInputListener(removed);
    await f.send("input", "c");
    assert.deepEqual(calls, ["header:c", "footer:cH"]);
  } finally {
    await f.close();
  }
});

test("global registrations survive their creating factory until explicitly removed", async () => {
  const f = await fixture();
  let tui!: DesktopTui;
  let hits = 0;
  const listener = () => {
    hits++;
    return { consume: true };
  };
  try {
    await f.host.desktopUI.mount(
      (value: DesktopTui) => {
        tui = value;
        tui.addInputListener(listener);
        return new f.Text("Temporary header");
      },
      "header",
      "header",
    );
    f.host.desktopUI.close("header");
    assert.equal(
      ((await f.send("editor", "x")) as { consume: boolean }).consume,
      true,
    );
    assert.equal(hits, 1);
    tui.removeInputListener(listener);
    const typed = (await f.send("editor", "x")) as {
      consume: boolean;
      editor: { text: string };
    };
    assert.equal(typed.consume, true);
    assert.equal(typed.editor.text, "x");
    assert.equal(hits, 1);
  } finally {
    await f.close();
  }
});

test("debug is shared across factories, runs after listeners and precedes shortcuts", async () => {
  const f = await fixture();
  let first!: DesktopTui, second!: DesktopTui;
  const calls: string[] = [];
  try {
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        first = tui;
        tui.onDebug = () => calls.push("first");
        return new f.Text("First");
      },
      "header",
      "header",
    );
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        second = tui;
        return new f.Text("Second");
      },
      "footer",
      "footer",
    );
    assert.equal(first, second);
    second.onDebug = function (this: DesktopTui) {
      assert.equal(Object.getPrototypeOf(this), Object.getPrototypeOf(second));
      assert.notEqual(this, second);
      calls.push("second");
    };
    assert.equal(typeof first.onDebug, "function");
    const off = first.addInputListener((data) =>
      data === "debug" ? { data: debugKey } : undefined,
    );
    await f.send("editor", "debug");
    assert.deepEqual(calls, ["second"]);
    const empty = second.addInputListener(() => ({ data: "" }));
    await f.send("editor", "debug");
    assert.deepEqual(calls, ["second"]);
    empty();
    off();
    second.onDebug = undefined;
    assert.equal(first.onDebug, undefined);
  } finally {
    await f.close();
  }
});

test("listeners on another factory mutate the selected mapped control after browser synchronization", async () => {
  const f = await fixture();
  const field = new f.api.Input();
  field.setValue("before");
  try {
    await f.host.desktopUI.mount(() => field, "aboveEditor", "input");
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        tui.addInputListener(() => {
          assert.equal(field.getValue(), "browser");
          field.setValue("authoritative");
          field.handleInput("\x05");
          return { consume: true };
        });
        return new f.Text("Mutating listener");
      },
      "header",
      "header",
    );
    const view = f.host.desktopUI.surfaces.find(
      (surface) => surface.id === "input",
    )!.view;
    const control = nodes(view).find(
      (node) => node.kind === "input",
    ) as Extract<DesktopNode, { kind: "input" | "textarea" }>;
    const result = (await f.send("input", "x", {
      controlAction: control.action,
      controlText: "browser",
      selection: { start: 0, end: 7 },
    })) as { editor: { text: string; selection: unknown } };
    assert.equal(result.editor.text, "authoritative");
    assert.deepEqual(result.editor.selection, { start: 13, end: 13 });
  } finally {
    await f.close();
  }
});

test("default editor reports listener mutations on press and release without accepting stale release context", async () => {
  const f = await fixture();
  let input = "";
  try {
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        tui.addInputListener((data) => {
          input = f.host.desktopUI.getEditorRawText()!;
          f.host.desktopUI.setEditorText("changed");
          return { consume: true };
        });
        return new f.Text("Default editor listener");
      },
      "header",
      "header",
    );
    const press = (await f.send("editor", "x", {
      editorText: "browser",
      selection: { start: 2, end: 2 },
    })) as { editor: { text: string } };
    assert.equal(input, "browser");
    assert.equal(press.editor.text, "changed");
    const release = (await f.send("editor", releaseKey, {
      editorText: "obsolete",
      selection: { start: 0, end: 8 },
    })) as { editor?: { text: string }; consume: boolean };
    assert.equal(input, "changed");
    assert.equal(release.consume, true);
    assert.equal(release.editor, undefined);
    assert.equal(f.host.desktopUI.getEditorRawText(), "changed");
  } finally {
    await f.close();
  }
});

test("native desktop dialogs use the same factory listeners before resolving their original answers", async () => {
  const f = await fixture();
  let hits = 0;
  try {
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        tui.addInputListener((data) => {
          hits++;
          return data === "answer" ? { data: "\r" } : { consume: true };
        });
        return new f.Text("Dialog listener");
      },
      "header",
      "header",
    );
    const answer = f.host.session.extensionRunner
      .getUIContext()
      .confirm("Shared dialog", "Question");
    const dialog = f.host.pendingDialogs.at(-1)!;
    await f.host.action({
      action: "desktop.input",
      args: {
        dialogId: dialog.id,
        dialogTarget: "option",
        dialogIndex: 0,
        data: "answer",
      },
    });
    assert.equal(await answer, true);
    assert.equal(hits, 1);
  } finally {
    await f.close();
  }
});

test("mapped overlays and raw xterm components dispatch global hooks once", async () => {
  const f = await fixture();
  let tui!: DesktopTui;
  let hooks = 0,
    raw = 0;
  try {
    await f.host.desktopUI.mount(
      (value: DesktopTui) => {
        tui = value;
        tui.addInputListener(() => {
          hooks++;
          return undefined;
        });
        return new f.Text("Overlay origin");
      },
      "header",
      "header",
    );
    tui.showOverlay({
      render: () => ["Opaque global input"],
      invalidate() {},
      handleInput() {
        raw++;
      },
    });
    await until(() =>
      f.host.desktopUI.surfaces.some((surface) => surface.overlay),
    );
    const overlay = f.host.desktopUI.surfaces.find(
      (surface) => surface.overlay,
    )!;
    await f.send(overlay.id, "x", { raw: true });
    assert.equal(hooks, 1);
    assert.equal(raw, 1);
  } finally {
    await f.close();
  }
});

test("reset retires captured input scopes and late factory registrations", async () => {
  const f = await fixture();
  let old!: DesktopTui;
  let hits = 0;
  try {
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        old = tui;
        tui.addInputListener(() => {
          hits++;
          return undefined;
        });
        tui.onDebug = () => hits++;
        return new f.Text("Old generation");
      },
      "header",
      "header",
    );
    f.host.desktopUI.clearSurfaces();
    old.addInputListener(() => {
      hits += 100;
      return undefined;
    });
    old.onDebug = () => (hits += 100);
    const input = new f.api.Input();
    await f.host.desktopUI.mount(() => input, "aboveEditor", "input");
    await f.send("input", "x");
    await f.send("input", debugKey);
    assert.equal(hits, 0);
    assert.equal(input.getValue(), "x");
  } finally {
    await f.close();
  }
});

test("default editor receives transformed releases before filtering without stale browser context", async () => {
  const f = await fixture();
  const seen: string[] = [];
  try {
    f.host.desktopUI.setEditorText("base");
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        tui.addInputListener((data) => {
          seen.push(data);
          return { data: f.api.isKeyRelease(data) ? "G" : releaseKey };
        });
        return new f.Text("Phase listener");
      },
      "header",
      "header",
    );
    const released = (await f.send("editor", releaseKey, {
      editorText: "obsolete",
      selection: { start: 0, end: 8 },
    })) as { editor: { text: string } };
    assert.equal(released.editor.text, "baseG");
    const pressed = await f.send("editor", "x");
    assert.deepEqual(pressed, { consume: true });
    assert.equal(f.host.desktopUI.getEditorRawText(), "baseG");
    assert.deepEqual(seen, [releaseKey, "x"]);
  } finally {
    await f.close();
  }
});

test("transformed shortcuts run after all shared listeners and consumption suppresses them", async () => {
  const f = await fixture(true);
  const calls: string[] = [];
  let consume = false;
  try {
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        tui.addInputListener((data) => {
          calls.push(`first:${data}`);
          return { data: "\x1b[107;7u" };
        });
        return new f.Text("Shortcut transform");
      },
      "header",
      "header",
    );
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        tui.addInputListener((data) => {
          calls.push(`second:${data}`);
          return consume ? { consume: true } : undefined;
        });
        return new f.Text("Shortcut observer");
      },
      "footer",
      "footer",
    );
    assert.equal(
      ((await f.send("editor", "x")) as { consume: boolean }).consume,
      true,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.host.snapshot().statuses["keyboard-phase-shortcut"], "1");
    consume = true;
    await f.send("editor", "x");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.host.snapshot().statuses["keyboard-phase-shortcut"], "1");
    assert.deepEqual(calls, [
      "first:x",
      "second:\x1b[107;7u",
      "first:x",
      "second:\x1b[107;7u",
    ]);
  } finally {
    await f.close();
  }
});

test("SDK resource reload retains direct TUI subscriptions and debug callbacks", async () => {
  const f = await fixture();
  let old!: DesktopTui;
  let hits = 0;
  try {
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        old = tui;
        tui.addInputListener(() => {
          hits++;
          return undefined;
        });
        tui.onDebug = () => hits++;
        return new f.Text("Before reload");
      },
      "header",
      "header",
    );
    await f.host.action({ action: "resources.reload" });
    assert.equal(f.host.desktopUI.terminalRuntime.capture().tui, old);
    await f.send("editor", "x");
    await f.send("editor", debugKey);
    assert.equal(hits, 3);
    old.addInputListener(() => {
      hits += 100;
      return undefined;
    });
    old.onDebug = () => (hits += 100);
    await f.send("editor", "x");
    await f.send("editor", debugKey);
    assert.equal(hits, 305);
  } finally {
    await f.close();
  }
});

test("retained context unsubscribe after reload matches original Pi subscription semantics", async () => {
  const f = await fixture();
  let hits = 0;
  let originalHits = 0;
  const native = await createDetachedTui(() => {});
  Reflect.set(native, "requestImmediateRender", () => {});
  const receiver = {
    ui: native,
    extensionTerminalInputSubscriptions: new Set(),
  };
  const add = Reflect.get(
    InteractiveMode.prototype,
    "addExtensionTerminalInputListener",
  );
  const clear = Reflect.get(
    InteractiveMode.prototype,
    "clearExtensionTerminalInputListeners",
  );
  const originalHandler = () => {
    originalHits++;
    return undefined;
  };
  const handler = () => {
    hits++;
    return undefined;
  };
  try {
    const off = f.host.session.extensionRunner
      .getUIContext()
      .onTerminalInput(handler);
    const originalOff = add.call(receiver, originalHandler);
    await f.host.action({ action: "resources.reload" });
    clear.call(receiver);
    const currentOff = f.host.session.extensionRunner
      .getUIContext()
      .onTerminalInput(handler);
    const originalCurrentOff = add.call(receiver, originalHandler);
    off();
    originalOff();
    assert.equal(f.host.snapshot().extensionUI.inputListeners, 1);
    assert.equal(receiver.extensionTerminalInputSubscriptions.size, 1);
    await f.send("editor", "x");
    callComponentMethod(native, "handleTerminalInput", "x");
    assert.equal(hits, originalHits);
    assert.equal(hits, 0);
    currentOff();
    originalCurrentOff();
    assert.equal(f.host.snapshot().extensionUI.inputListeners, 0);
  } finally {
    await f.close();
  }
});

test("host-owned dialogs join global input processing even outside the session dialog path", async () => {
  const f = await fixture();
  let hits = 0;
  try {
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        tui.addInputListener(() => {
          hits++;
          return { data: "\r" };
        });
        return new f.Text("Host dialog listener");
      },
      "header",
      "header",
    );
    const answer = f.host.ask(
      { kind: "confirm", title: "Host dialog", message: "Question" },
      undefined,
      new AbortController().signal,
    );
    const dialog = f.host.pendingDialogs.at(-1)!;
    await f.host.action({
      action: "desktop.input",
      args: {
        dialogId: dialog.id,
        dialogTarget: "option",
        dialogIndex: 0,
        data: "answer",
      },
    });
    assert.equal(await answer, true);
    assert.equal(hits, 1);
  } finally {
    await f.close();
  }
});

test("generic desktop adapters join the global pipeline once before their input handler", async () => {
  const f = await fixture();
  const source = {};
  const calls: string[] = [];
  try {
    f.host.desktopUI.registerAdapter({
      id: "test:global-input",
      matches: (value) => value === source,
      create: () => ({
        view: () => ({ kind: "text", text: "Desktop adapter" }),
        handleAction() {},
        handleInput(data) {
          calls.push(`adapter:${data}`);
          return { consume: true };
        },
      }),
    });
    await f.host.desktopUI.mount(
      (tui: DesktopTui) => {
        tui.addInputListener((data) => {
          calls.push(`hook:${data}`);
          return { data: "G" };
        });
        return new f.Text("Adapter hook");
      },
      "header",
      "header",
    );
    await f.host.desktopUI.mount(source, "aboveEditor", "adapter");
    await f.send("adapter", "x");
    assert.deepEqual(calls, ["hook:x", "adapter:G"]);
  } finally {
    await f.close();
  }
});

test("reset inside a listener consumes that event before subsequent listeners or interceptors", async () => {
  const api = await loadTuiApi();
  const pipeline = new TerminalInputPipeline();
  pipeline.initialize(api);
  const old = pipeline.capture();
  const calls: string[] = [];
  pipeline.setInterceptor(() => {
    calls.push("interceptor");
    return false;
  });
  old.add(() => {
    calls.push("reset");
    pipeline.reset();
    return undefined;
  });
  old.add(() => {
    calls.push("after");
    return undefined;
  });
  assert.deepEqual(old.run("x"), { consume: true });
  assert.deepEqual(calls, ["reset"]);
  assert.deepEqual(pipeline.capture().run("y"), { consume: false, data: "y" });
  assert.deepEqual(calls, ["reset", "interceptor"]);
});

test("listener exceptions preserve the original error and do not retire the input generation", async () => {
  const pipeline = new TerminalInputPipeline();
  const error = new Error("listener failed");
  const remove = pipeline.capture().add(() => {
    throw error;
  });
  assert.throws(
    () => pipeline.capture().run("x"),
    (caught) => caught === error,
  );
  remove();
  assert.deepEqual(pipeline.capture().run("y"), { consume: false, data: "y" });
});
