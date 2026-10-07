import { createRequire } from "node:module";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const states = new WeakMap();
export default async function (
  { host, desktop, session, sdk, managedTools },
  { action = "inspect", mode = "recursive" } = {},
) {
  let state = states.get(host);
  if (action === "seed") {
    const root = join(host.runtime.cwd, "managed-completion-fixture");
    for (const dir of ["nested/deeper", "other"]) {
      await mkdir(join(root, dir), { recursive: true });
      for (const suffix of ["a", "b"])
        await writeFile(
          join(root, dir, `managed-needle-${suffix}.txt`),
          "Original managed file completion",
        );
    }
    const require = createRequire(join(sdk.getPackageDir(), "package.json"));
    const api = await import(
      pathToFileURL(require.resolve("@earendil-works/pi-tui")).href
    );
    state = {
      root,
      api,
      editor: desktop.nativeComponent("editor"),
      scope: desktop.terminalRuntime.capture(),
      tools: managedTools,
      mode,
    };
    state.editor.addToHistory("Managed completion retained history");
    states.set(host, state);
    if (mode === "reprepare") {
      const ui = session.extensionRunner.getUIContext();
      ui.addAutocompleteProvider((previous) => {
        state.base = previous;
        return {
          triggerCharacters: ["~"],
          async getSuggestions(...args) {
            if (args[0].join("\n") === "~managed")
              return {
                prefix: "~managed",
                items: [
                  {
                    value: "retained-managed-wrapper",
                    label: "Retained managed wrapper",
                  },
                ],
              };
            return previous.getSuggestions(...args);
          },
          applyCompletion(...args) {
            if (args[3].value === "retained-managed-wrapper")
              return {
                lines: ["Retained managed wrapper"],
                cursorLine: 0,
                cursorCol: 24,
              };
            return previous.applyCompletion(...args);
          },
        };
      });
      ui.addAutocompleteProvider((previous) => ({
        triggerCharacters: ["%"],
        getSuggestions: previous.getSuggestions.bind(previous),
        applyCompletion: previous.applyCompletion.bind(previous),
      }));
    }
    if (mode === "statuses") {
      const app = state.scope.application;
      for (const status of [
        { type: "info", message: "Native fd preparation" },
        { type: "warning", message: "Native offline rg warning" },
        { type: "info", message: "Native tools settled" },
      ])
        app.managedToolStatus(status, true);
      host.snapshot();
      state.rows = app.noticeEntries(0).map((entry) => entry.component);
      state.container = new api.Container();
      for (const row of state.rows) state.container.addChild(row);
      session.extensionRunner
        .getUIContext()
        .setWidget("managed-status", () => state.container);
      for (
        let attempt = 0;
        attempt < 100 &&
        desktop.nativeComponent("widget:managed-status") !== state.container;
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!state) throw new Error("Managed tools probe is not seeded");
  if (action === "trigger") await desktop.input("editor", "\t");
  if (action === "reprepare")
    await host.action({
      action: "managed-tools.prepare",
      args: { refresh: true },
    });
  if (action === "history") {
    state.editor.setText("");
    await desktop.input("editor", "\x1b[A");
  }
  if (action === "cleanup") {
    session.extensionRunner
      .getUIContext()
      .setWidget("managed-status", undefined);
    state.editor.setText("");
    await rm(state.root, { recursive: true, force: true });
  }
  const query =
    mode === "scoped"
      ? "@managed-completion-fixture/nested/managed-needle"
      : "@managed-needle";
  const suggestions = await host.autocompleteProvider.getSuggestions(
    [query],
    0,
    query.length,
    { signal: new AbortController().signal },
  );
  const applied =
    suggestions?.items.map((item) =>
      host.autocompleteProvider
        .applyCompletion([query], 0, query.length, item, suggestions.prefix)
        .lines.join("\n"),
    ) ?? [];
  state.scope.tui.requestRender();
  host.publish();
  return {
    query,
    applied,
    fd: managedTools.fdPath,
    toolsSame: state.tools === managedTools,
    editorSame: state.editor === desktop.nativeComponent("editor"),
    scopeSame: state.scope === desktop.terminalRuntime.capture(),
    providerFd: Reflect.get(
      host.autocompleteProvider.triggerCharacters?.length
        ? state.base
        : host.autocompleteProvider,
      "fdPath",
    ),
    triggers: host.autocompleteProvider.triggerCharacters ?? [],
    classes: state.rows?.map((row) => row.constructor.name),
    rendered: state.container?.render(60).join("\n"),
    editorText: state.editor.getText(),
  };
}
