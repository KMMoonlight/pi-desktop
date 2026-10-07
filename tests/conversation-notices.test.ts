import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  InteractiveMode,
  type AgentSession,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import {
  loadComponentRuntime,
  type PiComponent,
} from "../backend/component-runtime.ts";
import { createFixture } from "./fixture.ts";
// @ts-expect-error The probe deliberately runs unchanged as an external JS SDK operation.
import * as noticeFixture from "./fixtures/conversation-notices-probe.mjs";
const {
  default: probe,
  assistant,
  usage,
  synchronize,
  complete,
} = noticeFixture;

async function fixture() {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  await host.initialize(files.cwd);
  const runtime = await loadComponentRuntime();
  const scope = host.desktopUI.terminalRuntime.capture();
  const notices = scope.application!.conversationNotices;
  const native = runtime.conversation.create(() => host.session);
  host.session.settingsManager.setShowCacheMissNotices(true);
  host.snapshot();
  return {
    files,
    host,
    runtime,
    scope,
    notices,
    native,
    async close() {
      await host.dispose();
      await files.close();
    },
  };
}
function original(session: AgentSession, method: string, value: unknown) {
  const components: PiComponent[] = [];
  const mode = Object.create(InteractiveMode.prototype);
  Object.defineProperties(mode, {
    session: { value: session },
    sessionManager: { value: session.sessionManager },
    settingsManager: { value: session.settingsManager },
    chatContainer: {
      value: {
        addChild(component: PiComponent) {
          components.push(component);
        },
      },
    },
  });
  Reflect.apply(Reflect.get(InteractiveMode.prototype, method), mode, [value]);
  return components;
}
const rendered = (components: PiComponent[], width = 79) =>
  components.map((component) => component.render(width)).flat();

for (const [name, miss] of [
  [
    "below both thresholds",
    { missedTokens: 19999, missedCost: 0.099, idleMs: 0, modelChanged: false },
  ],
  [
    "token boundary",
    { missedTokens: 20000, missedCost: 0, idleMs: 0, modelChanged: false },
  ],
  [
    "cost boundary",
    { missedTokens: 200, missedCost: 0.1, idleMs: 0, modelChanged: false },
  ],
  [
    "cost below suffix",
    { missedTokens: 25000, missedCost: 0.0099, idleMs: 0, modelChanged: false },
  ],
  [
    "cost suffix boundary",
    { missedTokens: 25000, missedCost: 0.01, idleMs: 0, modelChanged: false },
  ],
  [
    "idle below ttl",
    {
      missedTokens: 60000,
      missedCost: 0.123,
      idleMs: 299999,
      modelChanged: false,
    },
  ],
  [
    "idle ttl",
    {
      missedTokens: 60000,
      missedCost: 0.123,
      idleMs: 300000,
      modelChanged: false,
    },
  ],
  [
    "rounded idle",
    {
      missedTokens: 60000,
      missedCost: 0.123,
      idleMs: 389000,
      modelChanged: false,
    },
  ],
  [
    "model precedence",
    {
      missedTokens: 60000,
      missedCost: 0.123,
      idleMs: 600000,
      modelChanged: true,
    },
  ],
] as const)
  test(`conversation notice retains native cache policy: ${name}`, async () => {
    const f = await fixture();
    try {
      const actual = f.native.miss(miss),
        expected = original(f.host.session, "addCacheMissNotice", miss);
      assert.deepEqual(
        actual.map((value) => value.constructor),
        expected.map((value) => value.constructor),
      );
      for (const width of [18, 79, 140])
        assert.deepEqual(rendered(actual, width), rendered(expected, width));
    } finally {
      await f.close();
    }
  });
for (const kind of ["compaction", "branch_summary"] as const)
  for (const cost of [0, 0.0099, 0.01, 0.275])
    test(`native ${kind} billing formatting at cost ${cost}`, async () => {
      const f = await fixture();
      try {
        const entry = {
          type: kind,
          usage: usage({
            input: 25000,
            output: 270,
            cacheRead: 13000,
            cacheWrite: 2000,
            cost,
          }),
        } as Extract<SessionEntry, { type: typeof kind }>;
        const expected = original(f.host.session, "addCompactionCostNotice", {
          type: "compaction_cost",
          kind,
          usage: entry.usage,
        });
        assert.deepEqual(rendered(f.native.summary(entry)), rendered(expected));
        f.host.session.settingsManager.setShowCacheMissNotices(false);
        assert.deepEqual(f.native.summary(entry), []);
      } finally {
        await f.close();
      }
    });
test("native warming format, note, padding and settings gate", async () => {
  const f = await fixture();
  try {
    for (const cost of [0, 0.0099, 0.01, 0.023]) {
      const entry = f.host.session.sessionManager.appendUsage(
        "cache_warm",
        "desktop-test",
        "desktop-test",
        usage({ input: 3, output: 1, cacheRead: 59997, cost }),
        "fixture warming qualifier",
      );
      assert.deepEqual(
        rendered(f.native.warming(entry)),
        rendered(original(f.host.session, "addCacheWarmingUsage", entry)),
      );
    }
    f.host.session.settingsManager.setShowCacheMissNotices(false);
    const entry = f.host.session.sessionManager.getEntries().at(-1)! as Extract<
      SessionEntry,
      { type: "usage" }
    >;
    assert.deepEqual(f.native.warming(entry), []);
  } finally {
    await f.close();
  }
});
test("native thinking diagnostics count and previous branch policy", async () => {
  const f = await fixture();
  try {
    f.host.session.sessionManager.appendMessage(assistant({ dropped: 2 }));
    for (const dropped of [0, 1, 2, 3]) {
      const message = assistant({ dropped });
      assert.deepEqual(
        rendered(f.native.thinking(message)),
        rendered(
          original(f.host.session, "maybeShowThinkingDropNotice", message),
        ),
      );
    }
    const malformed = assistant({ dropped: 2 });
    malformed.diagnostics[0].details.transformations.push(
      null,
      {},
      "thinking_dropped",
      { type: "other" },
    );
    assert.deepEqual(
      rendered(f.native.thinking(malformed)),
      rendered(
        original(f.host.session, "maybeShowThinkingDropNotice", malformed),
      ),
    );
  } finally {
    await f.close();
  }
});
test("real message_end captures notices before persistence and adopts instances afterwards", async () => {
  const f = await fixture();
  try {
    f.host.session.sessionManager.appendMessage(
      assistant({ write: true, timestamp: Date.now() - 360000 }),
    );
    synchronize(f.host.session);
    const message = assistant({ dropped: 2 });
    let liveComponents: PiComponent[] = [],
      absent = false;
    const off = f.host.session.subscribe((event) => {
      if (event.type !== "message_end" || event.message !== message) return;
      absent = !f.host.session.sessionManager
        .getEntries()
        .some((entry) => entry.type === "message" && entry.message === message);
      const snapshot = f.host.snapshot();
      const id = snapshot.messages.at(-1)!.id;
      liveComponents = f.notices.entries(id).map((entry) => entry.component);
      assert.equal(snapshot.conversationNotices!.length, 2);
    });
    await complete(f.host.session, message);
    off();
    const snapshot = f.host.snapshot(),
      id = snapshot.messages.at(-1)!.id;
    assert.ok(absent);
    assert.equal(liveComponents.length, 4);
    assert.deepEqual(
      f.notices.entries(id).map((entry) => entry.component),
      liveComponents,
    );
    const entries = f.host.session.sessionManager.getEntries();
    assert.equal(entries.filter((entry) => entry.type === "message").length, 2);
    assert.ok(
      snapshot.conversationNotices!.some((value) =>
        value.presentation.text.includes("Anthropic dropped 2 thinking blocks"),
      ),
    );
    assert.ok(
      snapshot.conversationNotices!.some((value) =>
        value.presentation.text.includes("Cache miss after 6m idle"),
      ),
    );
  } finally {
    await f.close();
  }
});
for (const mode of ["cache", "compaction", "branch"] as const)
  test(`native conversation ${mode} placement, instance mutation, theme and nonpersistence`, async () => {
    const f = await fixture();
    try {
      const seeded = await probe(f.host.sdk, { action: "seed", mode });
      const expected = mode === "cache" ? 4 : 1;
      assert.equal(seeded.notices.length, expected);
      const snapshot = f.host.snapshot();
      const rows = snapshot.conversationNotices!;
      if (mode === "cache") {
        assert.equal(rows[0]!.afterMessageId, undefined);
        assert.equal(rows[1]!.afterMessageId, snapshot.messages[0]!.id);
        assert.ok(rows.at(-2)!.presentation.text.includes("Anthropic dropped"));
        assert.ok(rows.at(-1)!.presentation.text.includes("Cache miss"));
      } else {
        const summary = snapshot.messages.find(
          (value) =>
            value.role ===
            (mode === "compaction" ? "compactionSummary" : "branchSummary"),
        )!;
        assert.equal(rows[0]!.afterMessageId, summary.id);
        if (mode === "compaction")
          assert.equal(snapshot.messages.at(-1)!.id, summary.id);
      }
      const before = await readFile(f.host.session.sessionFile!, "utf8");
      const native = f.notices
        .entries(rows.at(-1)!.afterMessageId)
        .at(-1)!.component;
      assert.ok(native instanceof f.runtime.notice.ThemedText);
      Reflect.apply(Reflect.get(native, "setText"), native, [
        "Direct native billing notice mutation",
      ]);
      const changed = f.host.snapshot();
      assert.ok(
        changed
          .conversationNotices!.at(-1)!
          .presentation.text.includes("Direct native billing notice mutation"),
      );
      assert.equal(
        f.notices.entries(rows.at(-1)!.afterMessageId).at(-1)!.component,
        native,
      );
      f.host.session.extensionRunner.getUIContext().setTheme("light");
      const light = f.host.snapshot();
      assert.equal(
        f.notices.entries(rows.at(-1)!.afterMessageId).at(-1)!.component,
        native,
      );
      assert.equal(await readFile(f.host.session.sessionFile!, "utf8"), before);
      assert.ok(
        light.conversationNotices!.every(
          (value) => !value.presentation.text.includes("\x1b"),
        ),
      );
    } finally {
      await f.close();
    }
  });
test("settings rebuild drops live thinking but re-derives persisted usage and cache misses", async () => {
  const f = await fixture();
  try {
    await probe(f.host.sdk, { action: "seed", mode: "cache" });
    const old = f.notices
      .entries(f.host.snapshot().messages.at(-1)!.id)
      .at(-1)!.component;
    f.host.session.settingsManager.setShowCacheMissNotices(false);
    assert.deepEqual(f.host.snapshot().conversationNotices, []);
    f.host.session.settingsManager.setShowCacheMissNotices(true);
    const current = f.host.snapshot();
    assert.equal(current.conversationNotices!.length, 3);
    assert.ok(
      current.conversationNotices!.every(
        (value) => !value.presentation.text.includes("Anthropic dropped"),
      ),
    );
    assert.notEqual(
      f.notices.entries(current.messages.at(-1)!.id).at(-1)!.component,
      old,
    );
  } finally {
    await f.close();
  }
});
test("reload and resume reconstruct persisted notices with the shared application owner", async () => {
  const f = await fixture();
  try {
    await probe(f.host.sdk, { action: "seed", mode: "cache" });
    const path = f.host.session.sessionFile!;
    await f.host.session.reload();
    assert.equal(f.scope.application!.conversationNotices, f.notices);
    assert.equal(f.host.snapshot().conversationNotices!.length, 3);
    await f.host.action({ action: "session.new" });
    assert.deepEqual(f.host.snapshot().conversationNotices, []);
    await f.host.action({ action: "session.switch", args: { path } });
    assert.equal(f.host.snapshot().conversationNotices!.length, 3);
  } finally {
    await f.close();
  }
});
test("aborted/error completions omit diagnostic notices, and retired owners ignore late events", async () => {
  const f = await fixture();
  try {
    f.host.session.sessionManager.appendMessage(assistant({ write: true }));
    synchronize(f.host.session);
    for (const stopReason of ["aborted", "error"])
      await complete(f.host.session, assistant({ dropped: 3, stopReason }));
    assert.deepEqual(f.host.snapshot().conversationNotices, []);
    f.notices.dispose();
    const message = assistant({ dropped: 4 });
    f.notices.event({ type: "message_start", message });
    f.notices.event({ type: "message_end", message });
    f.host.snapshot();
    assert.deepEqual(f.notices.presentation(80), []);
  } finally {
    await f.close();
  }
});

test("repeated warming notifications preserve one native pair per occurrence in the shared tree", async () => {
  const f = await fixture();
  try {
    await probe(f.host.sdk, { action: "seed", mode: "cache" });
    const initial = f.host.snapshot();
    const components = [
      ...new Set(
        initial.conversationNotices!.flatMap((notice) =>
          f.notices
            .entries(notice.afterMessageId)
            .map((entry) => entry.component),
        ),
      ),
    ];
    const warm = f.host.session.sessionManager
      .getEntries()
      .find((entry) => entry.type === "usage" && entry.kind === "cache_warm")!;
    for (let index = 0; index < 4; index++) {
      Reflect.apply(Reflect.get(f.host.session, "_emit"), f.host.session, [
        { type: "entry_appended", entry: warm },
      ]);
      assert.deepEqual(
        f.host.snapshot().conversationNotices,
        initial.conversationNotices,
      );
    }
    const messageRoot = (
      Reflect.get(f.scope.tui.children[0]!, "children") as object[]
    )[2]!;
    const chat = Reflect.get(messageRoot, "children") as PiComponent[];
    for (const component of components)
      assert.equal(chat.filter((child) => child === component).length, 1);
  } finally {
    await f.close();
  }
});

test("unrelated usage is omitted and a compaction boundary resets original cache history", async () => {
  const f = await fixture();
  try {
    const manager = f.host.session.sessionManager;
    const first = manager.appendMessage({
      role: "user",
      content: "Boundary retained user",
      timestamp: Date.now(),
    });
    manager.appendMessage(assistant({ write: true }));
    manager.appendUsage(
      "unrelated_usage",
      "desktop-test",
      "desktop-test",
      usage({ input: 60000, cost: 1 }),
    );
    manager.appendCompaction("No usage summary", first, 65000);
    synchronize(f.host.session);
    await complete(f.host.session, assistant());
    assert.deepEqual(f.host.snapshot().conversationNotices, []);
  } finally {
    await f.close();
  }
});

test("context omission removes assistant diagnostics while warming keeps its visible anchor", async () => {
  const f = await fixture();
  try {
    await probe(f.host.sdk, { action: "seed", mode: "cache" });
    const manager = f.host.session.sessionManager;
    const latest = manager
      .getEntries()
      .filter((entry) => entry.type === "message")
      .at(-1)!;
    manager.appendContextEdit(latest.id, null);
    synchronize(f.host.session);
    const snapshot = f.host.snapshot();
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.conversationNotices!.length, 2);
    assert.ok(
      snapshot.conversationNotices!.every((notice) =>
        notice.presentation.text.includes("Cache warmed"),
      ),
    );
    assert.equal(
      snapshot.conversationNotices!.at(-1)!.afterMessageId,
      snapshot.messages[0]!.id,
    );
  } finally {
    await f.close();
  }
});
