import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { AgentSession } from "@earendil-works/pi-coding-agent";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const stage of ["loadKeybindings", "refreshAutocomplete"] as const) {
  for (const transition of ["replacement", "reload", "dispose"] as const) {
    test(
      `reload delayed at ${stage} cannot overwrite desktop state after ${transition}`,
      { timeout: 40000 },
      async () => {
        const fixture = await createFixture();
        const host = new DesktopHost(fixture.agentDir);
        const entered = deferred();
        const release = deferred();
        let pending: Promise<void> | undefined;
        try {
          await host.initialize(fixture.cwd);
          // Pause one real lifecycle await; later binds/reloads still use the real loader.
          const load = Reflect.get(host, stage).bind(host);
          let held = false;
          Reflect.set(host, stage, async (...args: unknown[]) => {
            await load(...args);
            if (!held) {
              held = true;
              entered.resolve();
              await release.promise;
            }
          });
          pending = host.session.reload();
          await entered.promise;
          if (transition === "dispose") {
            await host.dispose();
            release.resolve();
            await assert.rejects(pending, { name: "AbortError" });
            assert.equal(host.desktopUI.surfaces.length, 0);
            return;
          }
          if (transition === "replacement")
            await host.action({ action: "session.new" });
          else await host.session.reload();
          const current = host.session;
          const ui = current.extensionRunner.getUIContext();
          ui.setEditorText("Successor draft");
          ui.addAutocompleteProvider((previous) => ({
            ...previous,
            getSuggestions: async () => ({
              prefix: "",
              items: [{ value: "successor", label: "Successor completion" }],
            }),
            applyCompletion: previous.applyCompletion.bind(previous),
          }));
          const editor = host.desktopUI.surfaces.find(
            (surface) => surface.id === "editor",
          )?.instanceId;
          assert.ok(editor);
          release.resolve();
          await assert.rejects(pending, { name: "AbortError" });
          assert.equal(
            host.desktopUI.surfaces.find((surface) => surface.id === "editor")
              ?.instanceId,
            editor,
          );
          assert.equal(host.session, current);
          assert.equal(ui.getEditorText(), "Successor draft");
          const suggestions = await host.autocompleteProvider!.getSuggestions(
            [""],
            0,
            0,
            { signal: new AbortController().signal },
          );
          assert.equal(suggestions?.items[0]?.value, "successor");
        } finally {
          release.resolve();
          await pending?.catch(() => {});
          await host.dispose();
          await fixture.close();
        }
      },
    );
  }
}

test(
  "direct SDK reload clears desktop extension state before the caller hook and session startup",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const extensionPath = join(
      fixture.agentDir,
      "extensions",
      "reload-lifecycle.ts",
    );
    const extension = (command: string) => `export default function(pi) {
    pi.on("session_start", (_event, ctx) => ctx.ui.setStatus("reload-start", ctx.ui.getEditorText()));
    pi.registerCommand("${command}", { handler: async () => {} });
  }`;
    await writeFile(extensionPath, extension("reload-old"));
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      const session = host.session;
      const ui = session.extensionRunner.getUIContext();
      ui.setEditorText("Retained draft");
      ui.setStatus("old-extension", "stale");
      ui.setWidget("old-extension", ["stale widget"]);
      ui.onTerminalInput(() => ({ consume: true }));
      ui.setWorkingVisible(false);
      ui.setHiddenThinkingLabel("Old label");
      ui.setWorkingIndicator({ frames: ["old"], intervalMs: 100 });
      ui.addAutocompleteProvider((previous) => ({
        ...previous,
        getSuggestions: async () => ({
          prefix: "",
          items: [{ value: "stale", label: "stale" }],
        }),
        applyCompletion: previous.applyCompletion.bind(previous),
      }));
      assert.equal(host.snapshot().extensionUI.inputListeners, 1);
      await writeFile(extensionPath, extension("reload-new"));
      let hooks = 0;
      await host.withSdk(async ({ session: current }) => {
        await current.reload({
          beforeSessionStart: async () => {
            hooks++;
            assert.equal(host.snapshot().extensionUI.inputListeners, 0);
            assert.equal(host.snapshot().statuses["old-extension"], undefined);
            assert.equal(host.snapshot().widgets["old-extension"], undefined);
            assert.equal(host.snapshot().extensionUI.workingVisible, true);
            assert.equal(
              host.snapshot().extensionUI.hiddenThinkingLabel,
              undefined,
            );
            assert.equal(
              host.snapshot().extensionUI.workingIndicator,
              undefined,
            );
            const completions = await host.autocompleteProvider!.getSuggestions(
              ["/reload-"],
              0,
              8,
              { signal: new AbortController().signal },
            );
            assert.ok(
              completions?.items.some(
                (item) =>
                  item.value === "reload-new" || item.value === "/reload-new",
              ),
            );
            assert.ok(
              completions?.items.every(
                (item) => !item.value.includes("old") && item.value !== "stale",
              ),
            );
            assert.equal(ui.getEditorText(), "Retained draft");
            ui.setEditorText("Caller draft");
          },
        });
      });
      assert.equal(host.session, session);
      assert.equal(hooks, 1);
      assert.equal(host.snapshot().statuses["reload-start"], "Caller draft");
      assert.equal(ui.getEditorText(), "Caller draft");
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "reload preserves caller failures and restores the original method when a session is retired",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    const original = AgentSession.prototype.reload;
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      const session = host.session;
      const ui = session.extensionRunner.getUIContext();
      ui.onTerminalInput(() => ({ consume: true }));
      const failure = new Error("Caller hook failed");
      await assert.rejects(
        session.reload({
          beforeSessionStart: () => {
            throw failure;
          },
        }),
        (error) => error === failure,
      );
      assert.equal(host.snapshot().extensionUI.inputListeners, 0);
      await session.reload();
      await host.action({ action: "session.new" });
      assert.equal(session.reload, original);
      assert.equal(Object.hasOwn(session, "reload"), false);
      assert.equal(AgentSession.prototype.reload, original);
      const current = host.session;
      await host.dispose();
      assert.equal(current.reload, original);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "hosted reload delegates to custom runtime methods and restores their property descriptors",
  { timeout: 40000 },
  async () => {
    const fixture = await createFixture();
    let calls = 0;
    let custom: AgentSession["reload"] | undefined;
    const host = new DesktopHost(fixture.agentDir, {
      runtimeFactory: async (options, createDefault) => {
        const runtime = await createDefault(options);
        const original = runtime.session.reload;
        custom = async function (this: AgentSession, options) {
          calls++;
          await original.call(this, options);
        };
        Object.defineProperty(runtime.session, "reload", {
          value: custom,
          configurable: true,
          writable: true,
          enumerable: true,
        });
        return runtime;
      },
    });
    try {
      await host.initialize(fixture.cwd);
      const session = host.session;
      await host.action({ action: "resources.reload" });
      assert.equal(calls, 1);
      await host.dispose();
      assert.deepEqual(Object.getOwnPropertyDescriptor(session, "reload"), {
        value: custom,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);
