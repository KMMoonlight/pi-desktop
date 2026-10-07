import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InteractiveMode, VERSION } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import {
  loadComponentRuntime,
  type PiComponent,
} from "../backend/component-runtime.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";

async function fixture(quiet: boolean | "header" = false) {
  const files = await createFixture();
  const settings = JSON.parse(
    await readFile(join(files.agentDir, "settings.json"), "utf8"),
  );
  await writeFile(
    join(files.agentDir, "settings.json"),
    JSON.stringify({ ...settings, quietStartup: quiet }),
  );
  const host = new DesktopHost(files.agentDir);
  await host.initialize(files.cwd);
  const runtime = await loadComponentRuntime();
  const scope = host.desktopUI.terminalRuntime.capture();
  const content = scope.application!.content;
  const api = await loadTuiApi();
  const Container = Reflect.get(api, "Container");
  const mode = Object.create(InteractiveMode.prototype);
  Object.defineProperties(mode, {
    session: { value: host.session },
    sessionManager: { value: host.session.sessionManager },
    settingsManager: { value: host.session.settingsManager },
  });
  Object.assign(mode, {
    options: {},
    toolOutputExpanded: false,
    compactionQueuedMessages: [],
    loadedResourcesContainer: new Container(),
    pendingMessagesContainer: new Container(),
    extensionWidgetsAbove: new Map(),
    extensionWidgetsBelow: new Map(),
    ui: { requestRender() {} },
    widgetContainerAbove: new Container(),
    widgetContainerBelow: new Container(),
  });
  const invoke = (name: string, ...args: unknown[]) =>
    Reflect.apply(Reflect.get(InteractiveMode.prototype, name), mode, args);
  const render = (entries: { component: PiComponent }[], width = 79) =>
    entries.flatMap((entry) => entry.component.render(width));
  return {
    files,
    host,
    runtime,
    scope,
    content,
    api,
    Container,
    mode,
    invoke,
    render,
    async close() {
      await host.dispose();
      await files.close();
    },
  };
}
async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < end, "Native content did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const quiet of [false, "header", true] as const)
  test(`original startup header construction with quietStartup ${quiet}`, async () => {
    const f = await fixture(quiet);
    try {
      const entries = f.content.headerEntries();
      assert.deepEqual(
        entries.map((entry) => entry.component.constructor.name),
        quiet === true ? ["Text"] : ["Spacer", "BuiltInHeader", "Spacer"],
      );
      const native = entries.find(
        (entry) => entry.component.constructor.name === "BuiltInHeader",
      )?.component;
      if (native) {
        assert.ok(f.render(entries).join("\n").includes("v1.0.0"));
        assert.ok(f.render(entries).join("\n").includes("full startup help"));
        f.content.headerEntries(undefined, true);
        assert.ok(f.render(entries).join("\n").includes("to queue follow-up"));
        assert.equal(
          f.content
            .headerEntries(undefined, true)
            .find((entry) => entry.component === native)!.component,
          native,
        );
      } else assert.equal(f.render(entries).join("").trim(), "");
      assert.equal(
        f.host.session.settingsManager.getLastChangelogVersion(),
        VERSION,
      );
      assert.equal(f.scope.tui.children.length, 7);
      assert.equal(Reflect.get(f.scope.tui, "inputListeners").size, 0);
    } finally {
      await f.close();
    }
  });
for (const quiet of [false, "header", true] as const)
  for (const force of [false, true])
    test(`native resource grouping and quiet diagnostics ${quiet}/force=${force}`, async () => {
      const f = await fixture(quiet);
      try {
        const options = { force, showDiagnosticsWhenQuiet: true };
        const actual = f.content.showResources(options);
        f.invoke("showLoadedResources", options);
        const expected = f.mode.loadedResourcesContainer
          .children as PiComponent[];
        assert.deepEqual(
          actual.map((entry) => entry.component.constructor),
          expected.map((component) => component.constructor),
        );
        for (const width of [18, 79, 140])
          assert.deepEqual(
            f.render(actual, width),
            expected.flatMap((component) => component.render(width)),
          );
        f.host.snapshot();
        assert.deepEqual(
          f.content.resourceEntries(false).map((entry) => entry.component),
          actual.map((entry) => entry.component),
        );
        if (force || quiet === false) {
          assert.ok(
            actual.some(
              (entry) => entry.component.constructor.name === "ExpandableText",
            ),
          );
          assert.ok(f.render(actual).join("\n").includes("[Extensions]"));
        }
      } finally {
        await f.close();
      }
    });

test("resource expansion, theme invalidation and native text mutations preserve original instances", async () => {
  const f = await fixture();
  try {
    const entries = f.content.resourceEntries(false),
      native = entries.find(
        (entry) => entry.component.constructor.name === "ExpandableText",
      )!.component;
    const compact = f.render(entries).join("\n");
    f.content.resourceEntries(true);
    const expanded = f.render(entries).join("\n");
    assert.notEqual(compact, expanded);
    assert.ok(expanded.includes("user"));
    assert.equal(
      f.content
        .resourceEntries(true)
        .find((entry) => entry.component === native)!.component,
      native,
    );
    Reflect.apply(Reflect.get(native, "setText"), native, [
      "Direct original resource mutation",
    ]);
    assert.ok(
      f
        .render(f.content.resourceEntries(true))
        .join("\n")
        .includes("Direct original resource mutation"),
    );
    f.host.session.extensionRunner.getUIContext().setTheme("light");
    assert.equal(
      f.content
        .resourceEntries(true)
        .find((entry) => entry.component === native)!.component,
      native,
    );
    assert.ok(f.render(entries).join("\n").includes("[Extensions]"));
  } finally {
    await f.close();
  }
});

for (const count of [0, 3, 10, 13])
  test(`original string widget bounds and ANSI at ${count} lines`, async () => {
    const f = await fixture();
    try {
      const lines = Array.from(
        { length: count },
        (_, index) => `\x1b[31mNative widget ${index + 1}\x1b[0m`,
      );
      const ui = f.host.session.extensionRunner.getUIContext();
      ui.setWidget("native-count", lines);
      const snapshot = f.host.snapshot();
      f.invoke("setExtensionWidget", "native-count", lines);
      const actual = f.content.widgetEntries("aboveEditor").at(-1)!.component;
      const expected = f.mode.extensionWidgetsAbove.get(
        "native-count",
      ) as PiComponent;
      assert.deepEqual(actual.render(79), expected.render(79));
      const children = Reflect.get(actual, "children") as PiComponent[];
      assert.equal(children.length, Math.min(count, 10) + (count > 10 ? 1 : 0));
      const presented =
        snapshot.extensionUI.textPresentation!.widgets["native-count"]!;
      assert.ok(!presented.text.includes("\x1b"));
      if (count > 10) {
        assert.ok(presented.text.includes("widget truncated"));
        assert.ok(!presented.text.includes("Native widget 11"));
      }
      lines[0] = "Caller mutated source array";
      assert.ok(
        !f.host
          .snapshot()
          .extensionUI.textPresentation!.widgets["native-count"]!.text.includes(
            "Caller mutated",
          ),
      );
    } finally {
      await f.close();
    }
  });

test("mixed widgets retain insertion order, factory ownership, native mutations and replacement placement", async () => {
  const f = await fixture();
  try {
    const ui = f.host.session.extensionRunner.getUIContext();
    const input = new f.api.Input({ prompt: "Native mixed widget input" });
    let disposed = 0;
    Reflect.set(input, "dispose", () => disposed++);
    ui.setWidget("10", ["first numeric widget"]);
    ui.setWidget("factory", () => input);
    ui.setWidget("2", ["last numeric widget"]);
    await until(
      () => f.host.desktopUI.nativeComponent("widget:factory") === input,
    );
    f.host.snapshot();
    assert.deepEqual(f.content.widgetOrder(), ["10", "factory", "2"]);
    const entries = f.content.widgetEntries("aboveEditor");
    assert.equal(entries[0]!.component.constructor.name, "Spacer");
    assert.equal(entries[2]!.component, input);
    const original = entries[1]!.component;
    const text = (Reflect.get(original, "children") as PiComponent[])[0]!;
    Reflect.apply(Reflect.get(text, "setText"), text, [
      "Native widget mutation",
    ]);
    assert.ok(
      f.host
        .snapshot()
        .extensionUI.textPresentation!.widgets["10"]!.text.includes(
          "Native widget mutation",
        ),
    );
    assert.equal(
      f.content.widgetEntries("aboveEditor")[1]!.component,
      original,
    );
    ui.setWidget("10", ["moved numeric widget"], { placement: "belowEditor" });
    assert.deepEqual(f.content.widgetOrder(), ["factory", "2", "10"]);
    assert.equal(f.content.widgetEntries("aboveEditor")[1]!.component, input);
    assert.equal(f.content.widgetEntries("belowEditor").length, 1);
    assert.equal(disposed, 0);
    ui.setWidget("factory", undefined);
    assert.equal(disposed, 1);
    assert.equal(
      f.content.widgetEntries("aboveEditor")[1]!.component.constructor.name,
      "Container",
    );
  } finally {
    await f.close();
  }
});

test("native pending rows combine queues and compaction input with the original truncation and dequeue hint", async () => {
  const f = await fixture();
  try {
    await f.host.session.steer("First native pending direction");
    await f.host.session.followUp("First native pending follow-up");
    const extra = [
      { mode: "steer" as const, text: "Compaction pending direction" },
      { mode: "followUp" as const, text: "Compaction pending follow-up" },
    ];
    const actual = f.content.pendingEntries(extra);
    f.mode.compactionQueuedMessages = extra;
    f.invoke("updatePendingMessagesDisplay");
    const expected = f.mode.pendingMessagesContainer.children as PiComponent[];
    assert.deepEqual(
      actual.map((entry) => entry.component.constructor),
      expected.map((component) => component.constructor),
    );
    for (const width of [8, 30, 79])
      assert.deepEqual(
        f.render(actual, width),
        expected.flatMap((component) => component.render(width)),
      );
    assert.ok(
      f.render(actual).join("\n").includes("to edit all queued messages"),
    );
    assert.deepEqual(
      f.content.pendingEntries(extra).map((entry) => entry.component),
      actual.map((entry) => entry.component),
    );
    f.host.session.clearQueue();
    assert.deepEqual(f.content.pendingEntries(), []);
  } finally {
    await f.close();
  }
});

test("session reset preserves the builtin header and rebuilds resources/pending/widgets", async () => {
  const f = await fixture();
  try {
    const header = f.content.headerEntries().map((entry) => entry.component);
    const resources = f.content
      .resourceEntries(false)
      .map((entry) => entry.component);
    f.host.session.extensionRunner
      .getUIContext()
      .setWidget("reset-widget", ["Retired widget"]);
    await f.host.session.steer("Retired pending");
    f.host.snapshot();
    await f.host.action({ action: "session.new" });
    f.host.snapshot();
    assert.equal(f.scope.application!.content, f.content);
    assert.deepEqual(
      f.content.headerEntries().map((entry) => entry.component),
      header,
    );
    assert.deepEqual(f.content.widgetOrder(), []);
    assert.deepEqual(f.content.pendingEntries(), []);
    assert.ok(
      f.content
        .resourceEntries(false)
        .every((entry) => !resources.includes(entry.component)),
    );
    assert.equal(
      f.content.widgetEntries("aboveEditor")[0]!.component.constructor.name,
      "Spacer",
    );
    assert.deepEqual(f.content.widgetEntries("belowEditor"), []);
  } finally {
    await f.close();
  }
});

test("shared factory widget keys retain every native occurrence and unrelated direct children", async () => {
  const f = await fixture();
  try {
    const ui = f.host.session.extensionRunner.getUIContext();
    const shared = new f.api.Input({ prompt: "Shared original widget" });
    ui.setWidget("shared-a", () => shared);
    ui.setWidget("shared-b", () => shared);
    await until(
      () =>
        f.host.desktopUI.nativeComponent("widget:shared-a") === shared &&
        f.host.desktopUI.nativeComponent("widget:shared-b") === shared,
    );
    f.host.snapshot();
    const region = f.scope.tui.children[3]!;
    const children = Reflect.get(region, "children") as PiComponent[];
    const direct = new f.Container();
    children.push(direct);
    f.host.snapshot();
    assert.equal(children.filter((child) => child === shared).length, 2);
    assert.equal(children.filter((child) => child === direct).length, 1);
    ui.setWidget("shared-a", undefined);
    f.host.snapshot();
    assert.equal(children.filter((child) => child === shared).length, 1);
    assert.ok(children.includes(direct));
    ui.setWidget("shared-b", undefined);
    f.host.snapshot();
    assert.equal(children.filter((child) => child === shared).length, 0);
    assert.ok(children.includes(direct));
  } finally {
    await f.close();
  }
});

test("hard retirement clears all content even if a string widget cleanup throws", async () => {
  const f = await fixture();
  try {
    const ui = f.host.session.extensionRunner.getUIContext();
    ui.setWidget("throwing-native-string", ["Retired native row"]);
    ui.setWidget("other-native-string", ["Other native row"]);
    const first = f.content.widgetEntries("aboveEditor")[1]!.component;
    Reflect.set(first, "dispose", () => {
      throw new Error("native widget cleanup error");
    });
    assert.throws(() => f.content.dispose(), /native widget cleanup error/);
    assert.deepEqual(f.content.headerEntries(), []);
    assert.deepEqual(f.content.resourceEntries(false), []);
    assert.deepEqual(f.content.pendingEntries(), []);
    assert.deepEqual(f.content.widgetEntries("aboveEditor"), []);
    assert.deepEqual(f.content.widgetOrder(), []);
    assert.equal(
      f.content.widgetPresentation("throwing-native-string", 79),
      undefined,
    );
    f.content.dispose();
  } finally {
    await f.close();
  }
});

test("custom headers replace the original middle occurrence and restore native identity", async () => {
  const f = await fixture();
  try {
    const original = f.content.headerEntries().map((entry) => entry.component);
    const custom = new f.Container();
    const states: boolean[] = [];
    custom.setExpanded = (value: boolean) => states.push(value);
    assert.deepEqual(
      f.content.headerEntries(custom, true).map((entry) => entry.component),
      [original[0], custom, original[2]],
    );
    f.content.headerEntries(custom, true);
    assert.deepEqual(states, [true]);
    assert.deepEqual(
      f.content.headerEntries(undefined, false).map((entry) => entry.component),
      original,
    );
  } finally {
    await f.close();
  }
});
