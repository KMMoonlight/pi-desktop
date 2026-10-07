import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ManagedTools,
  loadManagedTools,
  type ManagedToolApi,
  type ManagedToolStatus,
} from "../backend/managed-tools.ts";
import { DesktopHost } from "../backend/host.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { createFixture } from "./fixture.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
test("tool preparation joins concurrent consumers, preserves native paths and refreshes explicitly", async () => {
  const controller = new AbortController(),
    gate = deferred<string | undefined>();
  const calls: string[] = [],
    events: ManagedToolStatus[] = [];
  const api: ManagedToolApi = {
    getToolPath: (tool) => `${tool}-located`,
    ensureTool(tool, status) {
      calls.push(tool);
      status?.({ type: "info", message: `Native ${tool} progress` });
      return tool === "fd" ? gate.promise : Promise.resolve("rg-native");
    },
  };
  const tools = new ManagedTools(
    controller.signal,
    (status) => events.push(status),
    async () => api,
  );
  const first = tools.prepare(),
    second = tools.prepare({ refresh: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["fd", "rg"]);
  assert.equal(tools.snapshot().state, "preparing");
  gate.resolve("fd-native");
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.deepEqual(a, { fd: "fd-native", rg: "rg-native" });
  assert.equal(await tools.prepare(), a);
  assert.equal(calls.length, 2);
  assert.equal(tools.fdPath, "fd-native");
  assert.equal(await tools.path("fd"), "fd-located");
  assert.equal(events.length, 2);
  const snapshot = tools.snapshot();
  snapshot.statuses[0]!.message = "Caller altered snapshot";
  assert.equal(tools.snapshot().statuses[0]!.message, "Native fd progress");
  await tools.prepare({ refresh: true });
  assert.equal(calls.length, 4);
});
test("retirement settles waiting consumers promptly and suppresses late original progress and paths", async () => {
  const controller = new AbortController(),
    gate = deferred<string | undefined>();
  const callbacks: ((status: Omit<ManagedToolStatus, "tool">) => void)[] = [],
    events: ManagedToolStatus[] = [];
  const tools = new ManagedTools(
    controller.signal,
    (event) => events.push(event),
    async () => ({
      getToolPath: () => null,
      ensureTool(_tool, status) {
        callbacks.push(status!);
        return gate.promise;
      },
    }),
  );
  const first = tools.prepare(),
    second = tools.prepare();
  const rejects = Promise.all([
    assert.rejects(first, { name: "AbortError" }),
    assert.rejects(second, { name: "AbortError" }),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await rejects;
  for (const callback of callbacks)
    callback({ type: "warning", message: "Late original download" });
  gate.resolve("Retired native binary");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);
  assert.equal(tools.fdPath, undefined);
  assert.equal(tools.snapshot().state, "closed");
  await assert.rejects(tools.prepare(), { name: "AbortError" });
  await assert.rejects(tools.path("fd"), { name: "AbortError" });
});
test("unavailable tools remain original undefined results and a failed preparation can be retried", async () => {
  const controller = new AbortController(),
    events: ManagedToolStatus[] = [];
  let fail = true;
  const tools = new ManagedTools(
    controller.signal,
    (event) => events.push(event),
    async () => {
      if (fail) throw new Error("Original loader failure");
      return {
        getToolPath: () => null,
        ensureTool: async (tool) => {
          return undefined;
        },
      };
    },
  );
  await assert.rejects(tools.prepare(), /Original loader failure/);
  assert.equal(tools.snapshot().state, "failed");
  assert.equal(tools.snapshot().error, "Original loader failure");
  fail = false;
  assert.deepEqual(await tools.prepare(), { fd: undefined, rg: undefined });
  assert.equal(tools.snapshot().state, "settled");
  assert.equal(tools.snapshot().error, undefined);
  assert.deepEqual(events, []);
});
test("unexpected parallel failure waits for its sibling before retrying", async () => {
  const controller = new AbortController(),
    gate = deferred<string | undefined>();
  const calls: string[] = [];
  let fail = true;
  const tools = new ManagedTools(
    controller.signal,
    () => {},
    async () => ({
      getToolPath: () => null,
      ensureTool: async (tool) => {
        calls.push(tool);
        if (tool === "fd" && fail)
          throw new Error("Unexpected original failure");
        return tool === "rg" && fail ? gate.promise : `${tool}-native`;
      },
    }),
  );
  const first = tools.prepare();
  const rejected = assert.rejects(first, /Unexpected original failure/);
  await new Promise((resolve) => setImmediate(resolve));
  const joined = tools.prepare({ refresh: true });
  const rejectedJoined = assert.rejects(joined, /Unexpected original failure/);
  assert.deepEqual(calls, ["fd", "rg"]);
  gate.resolve("Original sibling finished");
  await Promise.all([rejected, rejectedJoined]);
  fail = false;
  await tools.prepare({ refresh: true });
  assert.deepEqual(calls, ["fd", "rg", "fd", "rg"]);
});
test("retirement also releases native-path consumers waiting on module loading", async () => {
  const controller = new AbortController(),
    gate = deferred<ManagedToolApi>();
  const tools = new ManagedTools(
    controller.signal,
    () => {},
    () => gate.promise,
  );
  const path = tools.path("fd");
  const rejected = assert.rejects(path, { name: "AbortError" });
  controller.abort();
  await rejected;
  gate.resolve({
    getToolPath: () => "late-native-path",
    ensureTool: async () => undefined,
  });
});
test("managed tool operations are available before any workspace is initialized", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  try {
    assert.equal(
      (
        (await host.action({ action: "managed-tools.inspect" })) as {
          state: string;
        }
      ).state,
      "idle",
    );
    assert.equal(host.runtime, undefined);
    const native = await loadManagedTools();
    assert.equal(
      await host.action({ action: "managed-tools.path", args: { tool: "rg" } }),
      native.getToolPath("rg"),
    );
    const paths = await host.action({ action: "managed-tools.prepare" });
    assert.deepEqual(paths, {
      fd: native.getToolPath("fd") ?? undefined,
      rg: native.getToolPath("rg") ?? undefined,
    });
    assert.equal(host.runtime, undefined);
    await host.initialize(files.cwd);
    assert.equal(
      Reflect.get(host.autocompleteProvider!, "fdPath"),
      host.managedTools.fdPath,
    );
  } finally {
    await host.dispose();
    await files.close();
  }
});
test("tool reprepare preserves original extension wrapper rebuilding and merged triggers", async () => {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  try {
    await mkdir(join(files.cwd, "nested"), { recursive: true });
    await writeFile(
      join(files.cwd, "nested", "needle-wrapper.txt"),
      "Original wrapped fd completion",
    );
    await host.initialize(files.cwd);
    const api = await loadTuiApi(),
      calls: string[] = [],
      nativeCalls: string[] = [];
    const wrap =
      (name: string, trigger: string, record: string[]) =>
      (previous: NonNullable<typeof host.autocompleteProvider>) => {
        record.push(name);
        return {
          triggerCharacters: [trigger],
          getSuggestions: previous.getSuggestions.bind(previous),
          applyCompletion: previous.applyCompletion.bind(previous),
        };
      };
    const editor = { setAutocompleteProvider(_provider: unknown) {} };
    const original = Object.create(InteractiveMode.prototype);
    Object.assign(original, {
      createBaseAutocompleteProvider: () =>
        new api.CombinedAutocompleteProvider(
          [],
          files.cwd,
          host.managedTools.fdPath,
        ),
      autocompleteProviderWrappers: [],
      defaultEditor: editor,
      editor,
    });
    const setup = () =>
      Reflect.apply(
        Reflect.get(InteractiveMode.prototype, "setupAutocompleteProvider"),
        original,
        [],
      );
    const ui = host.session.extensionRunner.getUIContext();
    for (const [name, trigger] of [
      ["first", "~"],
      ["second", "%"],
    ]) {
      ui.addAutocompleteProvider(wrap(name!, trigger!, calls));
      original.autocompleteProviderWrappers.push(
        wrap(name!, trigger!, nativeCalls),
      );
      setup();
    }
    assert.deepEqual(calls, nativeCalls);
    assert.deepEqual(
      host.autocompleteProvider!.triggerCharacters,
      original.autocompleteProvider.triggerCharacters,
    );
    const before = host.autocompleteProvider;
    await host.action({
      action: "managed-tools.prepare",
      args: { refresh: true },
    });
    setup();
    assert.notEqual(host.autocompleteProvider, before);
    assert.deepEqual(calls, nativeCalls);
    const query = "@needle",
      options = { signal: new AbortController().signal };
    assert.deepEqual(
      await host.autocompleteProvider!.getSuggestions(
        [query],
        0,
        query.length,
        options,
      ),
      await original.autocompleteProvider.getSuggestions(
        [query],
        0,
        query.length,
        options,
      ),
    );
    assert.equal(
      Reflect.get(
        host.desktopUI.nativeComponent("editor")!,
        "autocompleteProvider",
      ),
      host.autocompleteProvider,
    );
    await host.action({ action: "resources.reload" });
    assert.equal(host.autocompleteProvider!.triggerCharacters, undefined);
    ui.addAutocompleteProvider(wrap("new", "&", calls));
    await host.action({ action: "session.new" });
    assert.equal(host.autocompleteProvider!.triggerCharacters, undefined);
  } finally {
    await host.dispose();
    await files.close();
  }
});
for (const quiet of [false, "header", true] as const)
  test(`native managed-tool status rows preserve original ordering and quiet behavior ${quiet}`, async () => {
    const files = await createFixture();
    const host = new DesktopHost(files.agentDir);
    try {
      await host.initialize(files.cwd);
      host.session.settingsManager.setQuietStartup(quiet);
      const scope = host.desktopUI.terminalRuntime.capture(),
        app = scope.application!;
      const api = await loadTuiApi(),
        Container = Reflect.get(api, "Container");
      const mode = Object.create(InteractiveMode.prototype);
      Object.assign(mode, {
        chatContainer: new Container(),
        ui: { requestRender() {} },
      });
      for (const status of [
        { type: "info" as const, message: "fd not found. Downloading..." },
        {
          type: "info" as const,
          message: "ripgrep installed to original path",
        },
        { type: "warning" as const, message: "Original unavailable tool" },
      ]) {
        app.managedToolStatus(status, true);
        Reflect.apply(
          Reflect.get(InteractiveMode.prototype, "showManagedToolStatus"),
          mode,
          [status],
        );
      }
      host.snapshot();
      const entries = app.noticeEntries(0);
      assert.deepEqual(
        entries.map((entry) => entry.component.constructor.name),
        ["Spacer", "ThemedText", "ThemedText", "ThemedText"],
      );
      for (const width of [14, 79])
        assert.deepEqual(
          entries.flatMap((entry) => entry.component.render(width)),
          mode.chatContainer.render(width),
        );
      host.notice("Separate original host notice", "info");
      assert.equal(app.noticeEntries(0).length, 6);
      assert.ok(
        app
          .noticeEntries(0)
          .flatMap((entry) => entry.component.render(79))
          .join("\n")
          .includes("fd not found"),
      );
      await host.action({ action: "session.new" });
      assert.deepEqual(app.noticeEntries(0), []);
      app.managedToolStatus(
        { type: "info", message: "New native preparation" },
        true,
      );
      assert.equal(
        app.noticeEntries(0)[0]!.component.constructor.name,
        "Spacer",
      );
    } finally {
      await host.dispose();
      await files.close();
    }
  });
for (const query of ["@needle", "@nested/needle", "@other/needle"])
  test(`original fd completion is available through the desktop provider at ${query}`, async () => {
    const files = await createFixture();
    const host = new DesktopHost(files.agentDir);
    try {
      for (const dir of ["nested/deeper", "other"]) {
        await mkdir(join(files.cwd, dir), { recursive: true });
        await writeFile(
          join(files.cwd, dir, "needle-managed-tool.txt"),
          "Original recursive completion fixture",
        );
      }
      await host.initialize(files.cwd);
      const tools = host.managedTools;
      assert.equal(await host.withSdk((ctx) => ctx.managedTools), tools);
      const native = await loadManagedTools();
      assert.equal(tools.fdPath, native.getToolPath("fd") ?? undefined);
      assert.ok(tools.fdPath, "Pi did not prepare fd");
      const api = await loadTuiApi();
      const expected = new api.CombinedAutocompleteProvider(
        [],
        files.cwd,
        tools.fdPath,
      );
      const actual = host.autocompleteProvider!;
      const options = { signal: new AbortController().signal };
      const [a, b] = await Promise.all([
        actual.getSuggestions([query], 0, query.length, options),
        expected.getSuggestions([query], 0, query.length, options),
      ]);
      assert.deepEqual(a, b);
      assert.ok(
        a?.items.some((item) => item.value.includes("needle-managed-tool.txt")),
      );
      const cancelled = new AbortController();
      cancelled.abort();
      const abortedOptions = { signal: cancelled.signal };
      assert.deepEqual(
        await actual.getSuggestions([query], 0, query.length, abortedOptions),
        await expected.getSuggestions([query], 0, query.length, abortedOptions),
      );
      const original = host.desktopUI.nativeComponent("editor")!;
      await host.action({ action: "resources.reload" });
      assert.equal(host.desktopUI.nativeComponent("editor"), original);
      assert.equal(
        Reflect.get(host.autocompleteProvider!, "fdPath"),
        tools.fdPath,
      );
      const refreshed = await host.action({
        action: "managed-tools.prepare",
        args: { refresh: true },
      });
      assert.deepEqual(refreshed, {
        fd: tools.fdPath,
        rg: native.getToolPath("rg") ?? undefined,
      });
      assert.equal(
        (
          (await host.action({ action: "managed-tools.inspect" })) as {
            state: string;
          }
        ).state,
        "settled",
      );
      assert.equal(
        await host.action({
          action: "managed-tools.path",
          args: { tool: "fd" },
        }),
        tools.fdPath,
      );
      await assert.rejects(
        host.action({ action: "managed-tools.path", args: { tool: "other" } }),
        /Unknown managed tool/,
      );
      await host.dispose();
      assert.equal(tools.snapshot().state, "closed");
    } finally {
      await host.dispose();
      await files.close();
    }
  });
