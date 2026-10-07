import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const states = new WeakMap();
const children = (component) => Reflect.get(component, "children") ?? [];
export default async function (
  { host, session, desktop, sdk },
  { action = "inspect", mode = "header" } = {},
) {
  const scope = desktop.terminalRuntime.capture(),
    content = scope.application.content;
  const ui = session.extensionRunner.getUIContext();
  let state = states.get(host);
  if (action === "seed") {
    for (const key of content.widgetOrder()) ui.setWidget(key, undefined);
    ui.setHeader(undefined);
    ui.setToolsExpanded(false);
    session.clearQueue();
    host.snapshot();
    const require = createRequire(join(sdk.getPackageDir(), "package.json"));
    const api = await import(
      pathToFileURL(require.resolve("@earendil-works/pi-tui")).href
    );
    state = {
      scope,
      content,
      api,
      mode,
      disposed: 0,
      header: content.headerEntries().map((entry) => entry.component),
    };
    states.set(host, state);
    if (mode === "header") {
      state.components = [
        state.header.find(
          (component) => component.constructor.name !== "Spacer",
        ),
      ];
      ui.setHeader(() => state.components[0]);
      await mounted(desktop, "header", state.components[0]);
    } else if (mode === "resources" || mode === "pending") {
      if (mode === "pending") {
        await session.steer("Native pending direction");
        await session.followUp("Native pending follow-up");
      }
      state.components = (
        mode === "resources"
          ? content.showResources({
              force: true,
              showDiagnosticsWhenQuiet: true,
            })
          : content.pendingEntries()
      ).map((entry) => entry.component);
      state.container = new api.Container();
      for (const component of state.components)
        state.container.addChild(component);
      ui.setWidget("content-preview", () => state.container);
      await mounted(desktop, "widget:content-preview", state.container);
    } else {
      ui.setWidget(
        "10",
        Array.from(
          { length: 13 },
          (_, index) => `\x1b[31mNative bounded row ${index + 1}\x1b[0m`,
        ),
      );
      state.input = new api.Input({ prompt: "Native ordered input" });
      state.input.dispose = () => state.disposed++;
      ui.setWidget("factory", () => state.input);
      ui.setWidget("2", ["Native last numeric row"]);
      await mounted(desktop, "widget:factory", state.input);
      state.components = content
        .widgetEntries("aboveEditor")
        .map((entry) => entry.component);
      state.string = state.components[1];
    }
  }
  if (!state) throw new Error("Native application content probe is not seeded");
  if (action === "expand") ui.setToolsExpanded(true);
  if (action === "mutate") {
    const component =
      mode === "widgets"
        ? children(state.string)[0]
        : state.components.find(
            (component) =>
              typeof component.setText === "function" || "text" in component,
          );
    if (typeof component.setText === "function")
      component.setText("Direct native application content mutation");
    else
      Reflect.set(
        component,
        "text",
        "Direct native application content mutation",
      );
    state.mutated = component;
  }
  if (action === "theme") ui.setTheme("light");
  if (action === "move")
    ui.setWidget("10", ["Native moved numeric row"], {
      placement: "belowEditor",
    });
  if (action === "remove") ui.setWidget("factory", undefined);
  if (action === "clear") {
    session.clearQueue();
    if (mode === "pending") ui.setWidget("content-preview", undefined);
  }
  if (action === "restore") ui.setHeader(undefined);
  const snapshot = host.snapshot();
  const expanded = Reflect.get(host, "expanded");
  const current =
    mode === "header"
      ? content
          .headerEntries(undefined, expanded)
          .map((entry) => entry.component)
      : mode === "resources"
        ? content.resourceEntries(expanded).map((entry) => entry.component)
        : mode === "pending"
          ? content.pendingEntries().map((entry) => entry.component)
          : content
              .widgetEntries("aboveEditor")
              .map((entry) => entry.component);
  const native =
    mode === "header"
      ? children(children(scope.tui.children[0])[0])
      : mode === "resources"
        ? children(children(scope.tui.children[0])[1])
        : mode === "pending"
          ? children(scope.tui.children[1])
          : children(scope.tui.children[3]);
  return {
    same: scope === state.scope && content === state.content,
    headerSame: content
      .headerEntries(undefined, expanded)
      .every((entry, index) => entry.component === state.header[index]),
    instancesSame:
      mode === "widgets"
        ? current.includes(state.input)
        : state.components.every((component) => current.includes(component)),
    treeIncludes: current.every((component) => native.includes(component)),
    classes: current.map((component) => component.constructor.name),
    rendered: current.flatMap((component) => component.render(79)).join("\n"),
    order: snapshot.widgetOrder,
    placements: snapshot.widgetPlacements,
    disposed: state.disposed,
    value: state.input?.getValue(),
    sdkHash: createHash("sha256")
      .update(JSON.stringify(session.sessionManager.getEntries()))
      .digest("hex"),
  };
}
async function mounted(desktop, id, component) {
  const end = Date.now() + 10000;
  while (desktop.nativeComponent(id) !== component) {
    if (Date.now() > end)
      throw new Error("Native application content did not mount");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
