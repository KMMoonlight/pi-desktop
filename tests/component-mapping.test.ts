import test from "node:test";
import assert from "node:assert/strict";
import { cp, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import {
  DesktopUIRegistry,
  type DesktopRenderSource,
} from "../backend/desktop-ui.ts";
import { registerComponentMappings } from "../backend/component-mapping.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import type { PiMouseEvent } from "../backend/component-runtime.ts";
import { encodeDesktopText } from "../shared/keyboard.ts";
import { createFixture } from "./fixture.ts";
import type {
  DesktopNode,
  DesktopSurface,
  DesktopMouseEvent,
  DesktopInputResult,
} from "../shared/desktop-ui.ts";

export function nodes(node: DesktopNode): DesktopNode[] {
  return [
    node,
    ...("children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : []
    ).flatMap(nodes),
  ];
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Component mapping did not reach expected state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const dialog = (host: DesktopHost) =>
  host.desktopUI.surfaces.find((surface) => surface.slot === "dialog");
async function fixture() {
  const setup = await createFixture();
  await cp(
    new URL("./fixtures/component-library.mjs", import.meta.url),
    join(setup.agentDir, "extensions", "renamed-user-extension.ts"),
  );
  const host = new DesktopHost(setup.agentDir);
  await host.initialize(setup.cwd);
  return {
    host,
    ...setup,
    async close() {
      await host.dispose();
      await setup.close();
    },
  };
}
async function act(
  host: DesktopHost,
  surface: DesktopSurface,
  action: string,
  value?: unknown,
) {
  return host.action({
    action: "desktop.action",
    args: { id: surface.id, instanceId: surface.instanceId, action, value },
  });
}
function field(surface: DesktopSurface, kind: DesktopNode["kind"]) {
  const result = nodes(surface.view).find((node) => node.kind === kind);
  assert.ok(result && "action" in result, `Missing ${kind}`);
  return result as DesktopNode & { action: string };
}
function pointer(
  overrides: Partial<DesktopMouseEvent> = {},
): DesktopMouseEvent {
  return {
    pointerId: 7,
    type: "press",
    button: "left",
    x: 2,
    y: 1,
    screenX: 12,
    screenY: 21,
    width: 20,
    height: 2,
    shift: false,
    alt: false,
    ctrl: false,
    ...overrides,
  };
}

async function mappedEditorFixture() {
  const setup = await fixture();
  const ui = setup.host.session.extensionRunner.getUIContext();
  const previous = setup.host.desktopUI.surfaces.find(
    (surface) => surface.slot === "editor",
  )?.instanceId;
  let original:
    import("@earendil-works/pi-coding-agent").CustomEditor | undefined;
  let originalTui!: DesktopTui;
  try {
    ui.setEditorComponent((tui, theme, keys) => {
      originalTui = tui;
      original = new setup.host.sdk.sdk.CustomEditor(tui, theme, keys);
      return original;
    });
    await until(
      () =>
        !!original &&
        setup.host.desktopUI.surfaces.some(
          (surface) =>
            surface.slot === "editor" && surface.instanceId !== previous,
        ),
    );
    assert.ok(original);
    const surface = setup.host.desktopUI.surfaces.find(
      (surface) => surface.slot === "editor",
    )!;
    return { ...setup, ui, original, originalTui, surface };
  } catch (error) {
    await setup.close();
    throw error;
  }
}

test("transparent component wrappers retain delegated controls, handlers and replacement", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Input = Reflect.get(api, "Input");
  const first = new Input();
  const second = new Input();
  let calls = 0;
  const wrapper = {
    body: first,
    unused: new Input(),
    render(width: number) {
      return this.body.render(width);
    },
    invalidate() {
      this.body.invalidate();
    },
    handleInput(data: string) {
      calls++;
      this.body.handleInput(data);
    },
  };
  const originalRender = first.render;
  try {
    await registry.mount(wrapper, "dialog", "wrapper");
    assert.equal(
      nodes(registry.surfaces[0].view).filter((node) => node.kind === "input")
        .length,
      1,
    );
    await registry.input("wrapper", "a");
    assert.equal(first.getValue(), "a");
    assert.equal(calls, 1);
    assert.equal(first.render, originalRender);
    wrapper.body = second;
    const replacement = field(registry.surfaces[0], "input");
    assert.ok(replacement.kind === "input");
    assert.equal(replacement.value, "");
    await registry.input("wrapper", "b");
    assert.equal(second.getValue(), "b");
    assert.equal(first.getValue(), "a");
    assert.equal(calls, 2);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("Editor public padding and submission settings update shared desktop controls", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/editor-config-probe" },
    });
    await until(() => !!dialog(host));
    const surface = dialog(host)!;
    const editor = () => {
      const node = field(dialog(host)!, "textarea");
      assert.ok(node.kind === "textarea");
      return node;
    };
    const submit = () => {
      const node = nodes(dialog(host)!.view).find(
        (node) =>
          node.kind === "button" && node.action === `${editor().action}:submit`,
      );
      assert.ok(node?.kind === "button");
      return node;
    };
    const choose = async (value: string) => {
      const select = field(dialog(host)!, "select");
      await act(host, surface, select.action, value);
      await act(host, surface, `${select.action}:submit`);
    };
    assert.equal(editor().paddingX, 2);
    assert.equal(submit()?.disabled, true);
    await assert.rejects(
      act(host, surface, `${editor().action}:submit`),
      /unavailable/,
    );
    assert.equal(editor().value, "Retained editor draft");
    assert.equal(host.extensionStatuses.get("editor-config-submit"), undefined);
    await choose("padding4");
    assert.equal(editor().paddingX, 4);
    await choose("padding0");
    assert.equal(editor().paddingX, 0);
    await choose("enable");
    assert.equal(submit()?.disabled, false);
    await act(host, surface, `${editor().action}:submit`);
    assert.equal(
      host.extensionStatuses.get("editor-config-submit"),
      "Retained editor draft",
    );
    await choose("disable");
    assert.equal(submit()?.disabled, true);
    await choose("close");
  } finally {
    await setup.close();
  }
});

test("collapsed stack controls release keyboard focus without disposing original instances", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Input = Reflect.get(api, "Input"),
    VStack = Reflect.get(api, "VStack");
  const input = new Input();
  const fallback = new Input();
  input.setValue("retained");
  let disposed = 0;
  input.dispose = () => {
    disposed++;
  };
  const stack = new VStack();
  stack.addChild(input);
  stack.addChild(fallback);
  let tui: DesktopTui | undefined;
  try {
    await registry.mount(
      (instance: DesktopTui) => {
        tui = instance;
        return stack;
      },
      "dialog",
      "stack-focus",
    );
    assert.ok(tui);
    registry.surfaces;
    tui.setFocus(input);
    assert.ok(registry.surfaces[0].focusRequest);
    stack.clear();
    stack.addChild(input, { basis: 0 });
    stack.addChild(fallback);
    registry.surfaces;
    await registry.input("stack-focus", "x");
    assert.equal(input.getValue(), "retained");
    assert.equal(Reflect.get(input, "focused"), false);
    assert.equal(disposed, 0);
    stack.clear();
    stack.addChild(input);
    stack.addChild(fallback);
    assert.equal(registry.surfaces[0].focusRequest, undefined);
    tui.setFocus(input);
    assert.ok(registry.surfaces[0].focusRequest);
    await registry.input("stack-focus", "y");
    assert.equal(input.getValue(), "yretained");
    assert.equal(disposed, 0);
    registry.clearSurfaces();
    assert.equal(disposed, 1);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("collapsed stack children release mouse capture while retaining their lifetime", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text"),
    VStack = Reflect.get(api, "VStack"),
    MouseRegion = Reflect.get(api, "MouseRegion");
  const child = new Text("Capture target", 0, 0);
  const events: PiMouseEvent[] = [];
  let disposed = 0;
  child.dispose = () => {
    disposed++;
  };
  child.handleMouse = (event: PiMouseEvent) => {
    events.push(event);
    return { handled: true, capture: event.type === "press" };
  };
  const stack = new VStack();
  stack.addChild(child);
  const root = new MouseRegion(stack, () => undefined);
  try {
    await registry.mount(root, "dialog", "stack-capture");
    const action = field(registry.surfaces[0], "region").action;
    const pressed = await registry.mouse(
      "stack-capture",
      action,
      pointer({ y: 0 }),
    );
    assert.equal(pressed.capture, true);
    stack.clear();
    stack.addChild(child, { basis: 0 });
    registry.surfaces;
    const count = events.length;
    const dragged = await registry.mouse(
      "stack-capture",
      action,
      pointer({ type: "drag", y: 10, screenY: 30 }),
    );
    assert.equal(dragged.capture, false);
    assert.equal(events.length, count);
    assert.equal(disposed, 0);
    registry.clearSurfaces();
    assert.equal(disposed, 1);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("zero-size stack entries reject hidden actions and restore original input state", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/stack-size-probe" },
    });
    await until(() => !!dialog(host));
    const surface = dialog(host)!;
    const inputs = () =>
      nodes(dialog(host)!.view).filter((node) => node.kind === "input");
    const choose = async (value: string) => {
      const select = field(dialog(host)!, "select");
      await act(host, surface, select.action, value);
      await act(host, surface, `${select.action}:submit`);
    };
    assert.equal(inputs().length, 1);
    await choose("show");
    assert.equal(inputs().length, 2);
    const input = field(dialog(host)!, "input");
    await act(host, surface, input.action, "Retained original value");
    await choose("hide");
    assert.equal(inputs().length, 1);
    await assert.rejects(
      act(host, surface, input.action, "Stale change"),
      /unavailable/,
    );
    await assert.rejects(
      act(host, surface, `${input.action}:submit`),
      /unavailable/,
    );
    await choose("show");
    const restored = field(dialog(host)!, "input");
    assert.equal(restored.action, input.action);
    assert.ok(restored.kind === "input");
    assert.equal(restored.value, "Retained original value");
    await choose("close");
    await until(() => !dialog(host));
  } finally {
    await setup.close();
  }
});

test("ScrollView retains original modes, theme callbacks and automatic visibility lifetime", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/scrollbar-probe" },
    });
    await until(() => !!dialog(host));
    const surface = dialog(host)!;
    const scroll = field(surface, "scroll");
    const read = () => {
      const node = nodes(dialog(host)!.view).find(
        (node) => node.kind === "scroll",
      );
      assert.ok(node?.kind === "scroll");
      return node;
    };
    const choose = async (value: string) => {
      const select = field(dialog(host)!, "select");
      await act(host, surface, select.action, value);
      await act(host, surface, `${select.action}:submit`);
    };
    await act(host, surface, `${scroll.action}:layout`, {
      contentHeight: 60,
      viewportHeight: 8,
    });
    assert.equal(read().scrollbar, "always");
    assert.equal(read().scrollbarVisible, true);
    assert.deepEqual(read().scrollbarColors, {
      thumb: "#008000",
      track: "#000080",
    });
    await choose("auto");
    assert.equal(read().scrollbarVisible, false);
    await act(host, surface, `${scroll.action}:scrollbar`, true);
    assert.equal(read().scrollbarActive, true);
    assert.equal(read().scrollbarColors?.thumb, "#800000");
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(read().scrollbarVisible, true);
    await act(host, surface, `${scroll.action}:scrollbar`, false);
    await until(() => read().scrollbarVisible === false);
    await choose("scroll");
    assert.equal(read().scrollbarVisible, true);
    await until(() => read().scrollbarVisible === false);
    await choose("hidden");
    assert.equal(read().scrollbar, "hidden");
    await choose("always");
    await act(host, surface, `${scroll.action}:layout`, {
      contentHeight: 1,
      viewportHeight: 8,
    });
    assert.equal(read().scrollbarVisible, true);
    await choose("close");
    await until(() => !dialog(host));
  } finally {
    await setup.close();
  }
});

test("Pi Image constraints and fallback themes follow original instance updates", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({ action: "prompt", args: { message: "/image-probe" } });
    await until(() => !!dialog(host));
    const read = () => {
      const node = nodes(dialog(host)!.view).find(
        (node) => node.kind === "image",
      );
      assert.ok(node?.kind === "image");
      return node;
    };
    const original = read();
    assert.equal(original.width, 160);
    assert.equal(original.aspectRatio, 2);
    assert.equal(
      original.fallback?.text,
      "Unavailable [Image: mapped-image.svg [image/svg+xml] 800x400]",
    );
    assert.equal(original.fallback?.runs?.[0].style?.fontStyle, "italic");
    const change = async (value: string) => {
      const surface = dialog(host)!;
      const select = field(surface, "select");
      await act(host, surface, select.action, value);
      await act(host, surface, `${select.action}:submit`);
    };
    await change("narrow");
    assert.equal(read().width, 80);
    assert.deepEqual(read().component, original.component);
    await change("broken");
    assert.equal(read().src, "data:image/svg+xml;base64,invalid");
    await change("recover");
    assert.equal(read().src, original.src);
    assert.equal(host.snapshot().statuses["image-action"], "recover");
    await change("close");
    await until(() => !dialog(host));
  } finally {
    await setup.close();
  }
});

test("mixed option and placeholder runs retain original source styles, links and selection callbacks", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/rich-control-probe" },
    });
    await until(() => !!dialog(host));
    const surface = dialog(host)!;
    const view = nodes(surface.view);
    const input = view.find((node) => node.kind === "input");
    assert.ok(input?.kind === "input");
    assert.equal(
      input.placeholderRuns?.find((run) => run.text === "Second")?.blink,
      true,
    );
    assert.equal(
      input.placeholderRuns?.find((run) => run.text === "Second")?.style
        ?.fontStyle,
      "italic",
    );
    assert.equal(
      input.placeholderRuns?.at(-1)?.href,
      "https://example.com/placeholder",
    );
    const choice = view.find(
      (node) => node.kind === "select" && node.label === "选择",
    );
    assert.ok(choice?.kind === "select");
    assert.equal(choice.options[0].value, "alpha:original");
    assert.equal(
      choice.options[0].runs?.find((run) => run.text === "Alpha")?.style?.color,
      "rgb(18, 130, 90)",
    );
    assert.equal(
      choice.options[0].runs?.at(-1)?.href,
      "https://example.com/option",
    );
    assert.equal(
      choice.options[1].runs?.find((run) => run.text === "alternate")?.style
        ?.fontStyle,
      "italic",
    );
    await act(host, surface, choice.action, "beta:original");
    assert.equal(
      host.snapshot().statuses["rich-change"],
      JSON.stringify({ value: "beta:original", changes: 1 }),
    );
    const settings = view.find(
      (node) => node.kind === "select" && node.label === "Rich preference",
    );
    assert.ok(settings?.kind === "select");
    assert.equal(settings.options[1].runs?.at(-1)?.style?.fontStyle, "italic");
    await act(host, surface, settings.action, "loud:original");
    assert.equal(
      host.snapshot().statuses["rich-setting"],
      JSON.stringify({ id: "rich:mode", value: "loud:original" }),
    );
    await act(host, surface, `${choice.action}:submit`);
    await until(() => !dialog(host));
    await until(() => host.snapshot().statuses["rich-result"] !== undefined);
    assert.equal(
      host.snapshot().statuses["rich-result"],
      JSON.stringify({ value: "beta:original", text: "", changes: 1 }),
    );
  } finally {
    await setup.close();
  }
});

test("status and string widgets share structured text mapping while retaining raw SDK values and lifecycle", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/text-surface-probe" },
    });
    await until(() => !!host.snapshot().statuses["surface-text"]);
    let snapshot = host.snapshot();
    let presentation = snapshot.extensionUI.textPresentation!;
    assert.ok(snapshot.statuses["surface-text"].includes("\x1b["));
    assert.equal(
      host.extensionStatuses.get("surface-text"),
      snapshot.statuses["surface-text"],
    );
    assert.equal(
      presentation.statuses["surface-text"].text,
      "Ready normal <script>status text</script> Status link",
    );
    assert.deepEqual(presentation.statuses["surface-text"].runs?.[0], {
      text: "Ready",
      style: { color: "rgb(18, 130, 90)", fontWeight: "bold" },
    });
    assert.equal(
      presentation.statuses["surface-text"].runs?.at(-1)?.href,
      "https://example.com/status",
    );
    const widgetRuns = presentation.widgets["surface-above"].runs!;
    assert.match(
      widgetRuns
        .filter((run) => run.style?.fontStyle === "italic")
        .map((run) => run.text)
        .join(""),
      /Above widget\s+Continued color/,
    );
    assert.equal(
      widgetRuns.find((run) => run.text.includes("Above widget"))?.style
        ?.fontStyle,
      "italic",
    );
    assert.equal(
      widgetRuns.find((run) => run.text.includes("plain widget"))?.style,
      undefined,
    );
    assert.equal(snapshot.widgetPlacements["surface-below"], "belowEditor");
    assert.equal(presentation.statuses.working.text, "Working text");
    assert.equal(
      presentation.statuses.working.runs?.[0].style?.color,
      "rgb(31, 82, 133)",
    );
    assert.equal(snapshot.extensionUI.windowTitle, "Pi Desktop");
    for (const mode of ["thinking", "thinking-empty", "thinking-reset"]) {
      await host.action({
        action: "prompt",
        args: { message: `/text-surface-probe ${mode}` },
      });
      const ui = host.snapshot().extensionUI;
      if (mode === "thinking") {
        assert.ok(ui.hiddenThinkingLabel?.includes("\x1b["));
        assert.deepEqual(ui.textPresentation?.hiddenThinkingLabel, {
          text: "Private reasoning",
          runs: [
            {
              text: "Private reasoning",
              style: { color: "rgb(80, 110, 140)", fontStyle: "italic" },
            },
          ],
        });
      } else if (mode === "thinking-empty") {
        assert.equal(ui.hiddenThinkingLabel, "");
        assert.deepEqual(ui.textPresentation?.hiddenThinkingLabel, {
          text: "",
        });
      } else {
        assert.equal(ui.hiddenThinkingLabel, undefined);
        assert.equal(ui.textPresentation?.hiddenThinkingLabel, undefined);
      }
    }
    await host.action({
      action: "prompt",
      args: { message: "/text-surface-probe indicator" },
    });
    snapshot = host.snapshot();
    assert.ok(
      snapshot.extensionUI.workingIndicator?.frames?.[0].includes("\x1b["),
    );
    assert.equal(snapshot.extensionUI.workingIndicator?.intervalMs, 300);
    assert.deepEqual(snapshot.extensionUI.textPresentation?.workingFrames, [
      {
        text: "Frame A",
        runs: [{ text: "Frame A", style: { color: "rgb(19, 120, 70)" } }],
      },
      {
        text: "Frame B",
        runs: [
          {
            text: "Frame B",
            style: { color: "rgb(140, 60, 100)", fontStyle: "italic" },
          },
        ],
      },
    ]);
    await host.action({
      action: "prompt",
      args: { message: "/text-surface-probe component" },
    });
    await until(() =>
      host.desktopUI.surfaces.some(
        (surface) => surface.id === "widget:surface-above",
      ),
    );
    snapshot = host.snapshot();
    assert.equal(snapshot.widgets["surface-above"], undefined);
    assert.equal(
      snapshot.extensionUI.textPresentation!.widgets["surface-above"],
      undefined,
    );
    await host.action({
      action: "prompt",
      args: { message: "/text-surface-probe update" },
    });
    await until(
      () => host.snapshot().statuses["surface-text"] === "Plain status",
    );
    snapshot = host.snapshot();
    presentation = snapshot.extensionUI.textPresentation!;
    assert.deepEqual(presentation.statuses["surface-text"], {
      text: "Plain status",
    });
    assert.deepEqual(presentation.widgets["surface-above"], {
      text: " Moved plain widget",
    });
    assert.equal(snapshot.widgetPlacements["surface-above"], "belowEditor");
    assert.equal(snapshot.widgets["surface-below"], undefined);
    assert.equal(
      host.desktopUI.surfaces.some(
        (surface) => surface.id === "widget:surface-above",
      ),
      false,
    );
    await host.action({
      action: "prompt",
      args: { message: "/text-surface-probe clear" },
    });
    await until(() => !host.snapshot().statuses["surface-text"]);
    assert.equal(
      host.snapshot().extensionUI.textPresentation!.statuses["surface-text"],
      undefined,
    );
    assert.deepEqual(host.snapshot().extensionUI.textPresentation!.widgets, {});
    assert.equal(
      host.snapshot().extensionUI.textPresentation?.workingFrames,
      undefined,
    );
    await host.action({ action: "resources.reload" });
    assert.deepEqual(host.snapshot().extensionUI.textPresentation!.widgets, {});
    await host.action({ action: "session.new" });
    assert.deepEqual(host.snapshot().extensionUI.textPresentation, {
      statuses: {},
      widgets: {},
    });
  } finally {
    await setup.close();
  }
});

test("native control labels retain original themes, placeholder transformations, descriptions and option identity", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/control-style-probe" },
    });
    await until(() => !!dialog(host));
    let surface = dialog(host)!;
    let view = nodes(surface.view);
    const input = view.find(
      (node) => node.kind === "input" && node.label === "Control update",
    );
    assert.ok(input?.kind === "input");
    assert.equal(input.labelRuns?.[0].style?.color, "rgb(18, 130, 90)");
    assert.equal(input.placeholder, "ORIGINAL placeholder");
    assert.equal(input.placeholderStyle?.color, "rgb(91, 101, 111)");
    assert.equal(input.placeholderStyle?.fontStyle, "italic");
    const editor = view.find((node) => node.kind === "textarea");
    assert.ok(editor?.kind === "textarea");
    assert.equal(editor.borderColor, "rgb(123, 84, 45)");
    assert.equal(
      view.find((node) => node.kind === "divider")?.style?.color,
      "rgb(100, 111, 122)",
    );
    const choice = view.find(
      (node) => node.kind === "select" && node.label === "选择",
    );
    assert.ok(choice?.kind === "select");
    assert.deepEqual(
      choice.options.map(({ value, label }) => ({ value, label })),
      [
        { value: "alpha", label: "ALPHA" },
        { value: "beta", label: "Beta" },
      ],
    );
    assert.equal(choice.options[0].style?.fontWeight, "bold");
    assert.equal(choice.options[1].style?.color, "rgb(113, 54, 95)");
    const preference = view.find(
      (node) => node.kind === "select" && node.label === "Preference",
    );
    assert.ok(preference?.kind === "select");
    assert.equal(preference.labelRuns?.[0].style?.color, "rgb(72, 83, 94)");
    assert.equal(preference.options[0].value, "quiet");
    assert.equal(preference.options[0].label, "QUIET");
    assert.equal(preference.options[0].style?.fontWeight, "bold");
    assert.equal(preference.labelPrefix?.text, "> ");
    const description = view.find(
      (node) => node.kind === "text" && node.text === "Preference description",
    );
    assert.ok(description?.kind === "text");
    assert.equal(description.runs?.[0].style?.color, "rgb(128, 99, 70)");
    await act(host, surface, preference.action, "loud");
    assert.equal(
      host.snapshot().statuses["control-setting"],
      "mode:choice=loud",
    );
    await act(host, surface, choice.action, "beta");
    assert.equal(host.snapshot().statuses["control-selected"], "beta");
    await act(host, surface, `${choice.action}:submit`);
    assert.equal(host.snapshot().statuses["control-confirmed"], "beta");
    surface = dialog(host)!;
    view = nodes(surface.view);
    const missing = view.find(
      (node) =>
        node.kind === "text" && node.text.includes("No matching commands"),
    );
    assert.ok(missing?.kind === "text");
    assert.equal(missing.runs?.[0].style?.color, "rgb(147, 58, 69)");
    await act(host, surface, input.action, "Updated by original Input");
    await act(host, surface, `${input.action}:submit`);
    surface = dialog(host)!;
    const progress = nodes(surface.view).find(
      (node) => node.kind === "progress",
    );
    assert.ok(progress?.kind === "progress");
    assert.equal(progress.label, "Updated by original Input");
    assert.equal(progress.labelRuns?.[0].style?.color, "rgb(31, 82, 133)");
    assert.equal(progress.indicator?.text, "*");
    assert.equal(progress.indicatorColor, "rgb(41, 142, 93)");
    const search = nodes(surface.view).find(
      (node) => node.kind === "input" && node.label === "搜索",
    );
    assert.ok(search?.kind === "input");
    await act(host, surface, search.action, "absent");
    assert.ok(
      nodes(dialog(host)!.view).some(
        (node) =>
          node.kind === "text" && node.text.includes("No matching settings"),
      ),
    );
    const cancel = nodes(dialog(host)!.view).find(
      (node) => node.kind === "button" && node.label === "取消",
    );
    assert.ok(cancel?.kind === "button");
    await act(host, surface, cancel.action);
    await until(() => !dialog(host));
    await until(() => host.snapshot().statuses["control-result"] !== undefined);
    assert.equal(host.snapshot().statuses["control-result"], "aborted");
  } finally {
    await setup.close();
  }
});

test("SelectList custom label layout receives allocated width and selected state without changing original values", async () => {
  const setup = await fixture();
  const { host } = setup;
  const api = await loadTuiApi();
  const calls: {
    item: { value: string };
    isSelected: boolean;
    maxWidth: number;
    columnWidth: number;
  }[] = [];
  try {
    await host.action({
      action: "desktop.viewport",
      args: { width: 160, height: 50 },
    });
    const pending = host.session.extensionRunner.getUIContext().custom(
      () => {
        const Box = Reflect.get(api, "Box");
        const SelectList = Reflect.get(api, "SelectList");
        const identity = (text: string) => text;
        const box = new Box(2, 0);
        box.addChild(
          new SelectList(
            [
              {
                value: "left",
                label: "Left source",
                description: "Left details",
              },
              {
                value: "right",
                label: "Right source",
                description: "Right details",
              },
            ],
            4,
            {
              selectedPrefix: identity,
              selectedText: identity,
              description: identity,
              scrollInfo: identity,
              noMatch: identity,
            },
            {
              minPrimaryColumnWidth: 12,
              maxPrimaryColumnWidth: 14,
              truncatePrimary: (context: (typeof calls)[number]) => {
                calls.push(context);
                return `\x1b[36m${context.item.value.toUpperCase()}${context.isSelected ? "!" : ""}\x1b[39m`;
              },
            },
          ),
        );
        return box;
      },
      { overlay: true, overlayOptions: { width: "50%" } },
    );
    await until(() => !!dialog(host));
    let surface = dialog(host)!;
    let choice = field(surface, "select");
    assert.ok(choice.kind === "select");
    assert.deepEqual(
      choice.options.map(({ value, label }) => ({ value, label })),
      [
        { value: "left", label: "LEFT!" },
        { value: "right", label: "RIGHT" },
      ],
    );
    assert.equal(calls.at(-1)?.columnWidth, 14);
    assert.equal(calls.at(-1)?.maxWidth, 12);
    await act(host, surface, choice.action, "right");
    choice = field(dialog(host)!, "select");
    assert.ok(choice.kind === "select");
    assert.equal(choice.value, "right");
    assert.equal(choice.options[1].label, "RIGHT!");
    await host.action({
      action: "desktop.viewport",
      args: { width: 80, height: 50 },
    });
    surface = dialog(host)!;
    assert.equal(surface.overlay?.bounds?.width, 40);
    assert.equal(calls.at(-1)?.columnWidth, 32);
    assert.equal(calls.at(-1)?.maxWidth, 32);
    host.desktopUI.close(surface.id);
    await pending;
  } finally {
    await setup.close();
  }
});

test("standard Text, TruncatedText and Box retain styles, links and live original callbacks", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/text-style-probe" },
    });
    await until(() => !!dialog(host));
    const surface = dialog(host)!;
    const text = nodes(surface.view).find(
      (node) => node.kind === "text" && node.text.includes("Styled message"),
    )!;
    assert.ok(text?.kind === "text");
    const runs = text.runs;
    assert.ok(runs, "Styled Text must expose desktop text runs");
    assert.equal(runs[0].text, "Styled message");
    assert.equal(runs[0].style?.color, "rgb(18, 130, 90)");
    assert.equal(runs[0].style?.backgroundColor, "#005f87");
    assert.equal(runs[0].style?.fontWeight, "bold");
    assert.equal(runs[0].style?.fontStyle, "italic");
    assert.equal(runs[0].style?.textDecorationLine, "underline line-through");
    assert.equal(
      runs.find((run) => run.text === "Pi link")?.href,
      "https://example.com/pi?x=1&y=2",
    );
    const following = runs.find((run) => run.text === " After link");
    assert.ok(following);
    assert.equal(following.href, undefined);
    assert.equal(following.style?.color, "rgb(23, 45, 67)");
    assert.equal(text.style?.backgroundColor, "rgb(31, 41, 51)");
    assert.equal(surface.view.style?.backgroundColor, "rgb(20, 30, 40)");
    assert.ok("text" in text && !text.text.includes("\x1b"));
    const truncated = nodes(surface.view).find(
      (node) => node.kind === "text" && node.truncate,
    )!;
    assert.ok(
      "text" in truncated && !truncated.text.includes("Hidden second line"),
    );
    assert.ok(truncated.kind === "text");
    assert.equal(truncated.runs?.[0].style?.color, "#ff0000");
    const markdown = nodes(surface.view).find(
      (node) => node.kind === "markdown",
    );
    assert.deepEqual(markdown?.style, {
      color: "rgb(75, 85, 95)",
      backgroundColor: "rgb(205, 215, 225)",
      fontWeight: "bold",
      fontStyle: "italic",
    });
    const input = field(surface, "input");
    await act(host, surface, input.action, "Updated by original callback");
    await act(host, surface, `${input.action}:submit`);
    const updated = nodes(dialog(host)!.view).find(
      (node) =>
        node.kind === "text" && node.text === "Updated by original callback",
    )!;
    assert.ok(updated.kind === "text");
    assert.ok(updated.runs?.[0].style?.color);
    const select = field(surface, "select");
    await act(host, surface, `${select.action}:submit`);
    await until(() => !dialog(host));
    await until(() => host.snapshot().statuses["styled-result"] !== undefined);
    assert.equal(host.snapshot().statuses["styled-result"], "closed");
  } finally {
    await setup.close();
  }
});

test("nested Markdown source transforms receive their allocated width before and after overlay resizing", async () => {
  const setup = await fixture();
  const { host } = setup;
  const api = await loadTuiApi();
  const widths: number[] = [];
  try {
    const ui = host.session.extensionRunner.getUIContext();
    const pending = ui.custom(
      () => {
        const Box = Reflect.get(api, "Box");
        const Markdown = Reflect.get(api, "Markdown");
        const box = new Box(2, 0);
        box.addChild(
          new Markdown(
            "source",
            1,
            0,
            host.sdk.sdk.getMarkdownTheme(),
            undefined,
            {
              transform: (_source: string, width: number) => {
                widths.push(width);
                return `Content width: ${width}`;
              },
            },
          ),
        );
        return box;
      },
      { overlay: true, overlayOptions: { width: "50%" } },
    );
    await until(() => !!dialog(host));
    await host.action({
      action: "desktop.viewport",
      args: { width: 40, height: 30 },
    });
    let surface = dialog(host)!;
    assert.equal(surface.overlay?.bounds?.width, 20);
    let markdown = nodes(surface.view).find((node) => node.kind === "markdown");
    assert.ok(markdown?.kind === "markdown");
    assert.equal(markdown.text, "Content width: 14");
    assert.equal(widths.at(-1), 14);
    await host.action({
      action: "desktop.viewport",
      args: { width: 24, height: 30 },
    });
    surface = dialog(host)!;
    assert.equal(surface.overlay?.bounds?.width, 12);
    markdown = nodes(surface.view).find((node) => node.kind === "markdown");
    assert.ok(markdown?.kind === "markdown");
    assert.equal(markdown.text, "Content width: 6");
    assert.equal(widths.at(-1), 6);
    host.desktopUI.close(surface.id);
    await pending;
  } finally {
    await setup.close();
  }
});

test("component input listeners and debug callback work without an input control", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const Text = Reflect.get(await loadTuiApi(), "Text");
  const received: string[] = [];
  let debug = 0;
  let original!: DesktopTui;
  try {
    await registry.mount(
      (tui: DesktopTui) => {
        original = tui;
        tui.addInputListener((data) => {
          received.push(data);
          return data === "consume" ? { consume: true } : undefined;
        });
        tui.onDebug = () => {
          debug++;
        };
        return new Text("Listener-only desktop component");
      },
      "dialog",
      "listener-only",
    );
    assert.equal(
      (await registry.input("listener-only", "consume")).consume,
      true,
    );
    assert.deepEqual(received, ["consume"]);
    assert.equal(
      (await registry.input("listener-only", "\u001b[100;6u")).consume,
      true,
    );
    assert.equal(debug, 1);
    const remove = original.addInputListener(() => ({ data: "" }));
    assert.equal(
      (await registry.input("listener-only", "\u001b[100;6u")).consume,
      true,
    );
    assert.equal(
      debug,
      1,
      "empty listener result suppresses downstream dispatch",
    );
    remove();
    await registry.input("listener-only", "\u001b[100;6u");
    assert.equal(debug, 2);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("component input listener removal takes effect during the current dispatch", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const { Input } = await loadTuiApi();
  let removedCalls = 0;
  let control!: InstanceType<typeof Input>;
  try {
    await registry.mount(
      (tui: DesktopTui) => {
        const removed = () => {
          removedCalls++;
          return undefined;
        };
        tui.addInputListener(() => {
          tui.removeInputListener(removed);
          return undefined;
        });
        tui.addInputListener(removed);
        control = new Input();
        return control;
      },
      "dialog",
      "listener-removal",
    );
    await registry.input("listener-removal", "x");
    assert.equal(removedCalls, 0);
    assert.equal(control.getValue(), "x");
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("component input listeners can redirect focus or close before control dispatch", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Container = Reflect.get(api, "Container");
  const first = new api.Input(),
    second = new api.Input();
  let closed = false;
  try {
    await registry.mount(
      (tui: DesktopTui) => {
        const root = new Container();
        root.addChild(first);
        root.addChild(second);
        tui.setFocus(first);
        tui.addInputListener((data) => {
          if (data === "close") {
            registry.close("listener-focus");
            closed = true;
            return;
          }
          tui.setFocus(second);
          return { data: data.toUpperCase() };
        });
        return root;
      },
      "dialog",
      "listener-focus",
    );
    const redirected = await registry.input("listener-focus", "x");
    assert.equal(first.getValue(), "");
    assert.equal(second.getValue(), "X");
    assert.equal(redirected.editor?.text, "X");
    await registry.input("listener-focus", "close");
    assert.equal(closed, true);
    assert.equal(
      second.getValue(),
      "X",
      "closed components must not receive pending input",
    );
    assert.equal(registry.surfaces.length, 0);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("component listener focus overrides the browser source without transferring its text or selection", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Container = Reflect.get(api, "Container");
  const first = new api.Input(),
    second = new api.Input();
  first.setValue("source");
  second.setValue("destination");
  try {
    await registry.mount(
      (tui: DesktopTui) => {
        const root = new Container();
        root.addChild(first);
        root.addChild(second);
        tui.setFocus(first);
        tui.addInputListener((data) => {
          tui.setFocus(data === "clear" ? null : second);
          return { data: "X" };
        });
        return root;
      },
      "dialog",
      "listener-context",
    );
    const source = field(registry.surfaces[0], "input");
    const result = await registry.input(
      "listener-context",
      "x",
      undefined,
      undefined,
      {
        controlAction: source.action,
        controlText: "source",
        selection: { start: 0, end: 6 },
      },
    );
    assert.equal(first.getValue(), "source");
    assert.equal(second.getValue(), "Xdestination");
    assert.equal(
      result.editor?.text,
      "source",
      "response reconciles the browser source, not the destination",
    );
    const cleared = await registry.input(
      "listener-context",
      "clear",
      undefined,
      undefined,
      {
        controlAction: source.action,
        controlText: "source",
        selection: { start: 0, end: 6 },
      },
    );
    assert.equal(cleared.consume, true);
    assert.equal(first.getValue(), "source");
    assert.equal(second.getValue(), "Xdestination");
    assert.equal(registry.surfaces[0].focusRequest?.action, null);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("component input listeners retain original text and caret mutations over browser context", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const { Input } = await loadTuiApi();
  const control = new Input();
  control.setValue("before");
  const observed: string[] = [];
  try {
    await registry.mount(
      (tui: DesktopTui) => {
        tui.addInputListener((data) => {
          observed.push(control.getValue());
          if (data === "noop") return { data: "!" };
          if (data !== "caret") control.setValue("listener");
          control.handleInput("\u0005");
          if (data === "consume") return { consume: true };
          if (data === "empty") return { data: "" };
          return { data: "!" };
        });
        return control;
      },
      "dialog",
      "listener-mutation",
    );
    const source = field(registry.surfaces[0], "input");
    for (const data of ["continue", "consume", "empty", "caret", "noop"]) {
      control.setValue("stale");
      const result = await registry.input(
        "listener-mutation",
        data,
        undefined,
        undefined,
        {
          controlAction: source.action,
          controlText: "before",
          selection: { start: 0, end: 6 },
        },
      );
      const expected =
        data === "continue"
          ? "listener!"
          : data === "caret"
            ? "before!"
            : data === "noop"
              ? "!"
              : "listener";
      assert.equal(
        observed.at(-1),
        "before",
        "listener observes synchronized browser state",
      );
      assert.equal(control.getValue(), expected, data);
      assert.equal(result.editor?.text, expected, `${data} response`);
      assert.deepEqual(result.editor?.selection, {
        start: expected.length,
        end: expected.length,
      });
    }
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("component terminal color queries resolve without a terminal", async () => {
  const setup = await fixture();
  try {
    const Text = Reflect.get(await loadTuiApi(), "Text");
    let received: unknown;
    let late = false;
    const pending = setup.host.session.extensionRunner
      .getUIContext()
      .custom(async (tui, _theme, _keys, done) => {
        received = await tui.queryTerminalColors({
          timeoutMs: 10,
          onLateReply: () => {
            late = true;
          },
        });
        done("queried");
        return new Text("Queried colors");
      });
    assert.equal(await pending, "queried");
    assert.deepEqual(received, {
      foreground: undefined,
      background: undefined,
      palette: undefined,
    });
    assert.equal(late, false);
  } finally {
    await setup.close();
  }
});

test("mapped TUI stop suspends input and presentation and start resumes original components", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    const { Input } = await loadTuiApi();
    const input = new Input();
    input.setValue("initial");
    let tui!: DesktopTui;
    let calls = 0;
    host.session.extensionRunner.getUIContext().setHeader((original) => {
      tui = original;
      tui.addInputListener(() => {
        calls++;
        return undefined;
      });
      return input;
    });
    const surface = () =>
      host.desktopUI.surfaces.find((item) => item.slot === "header")!;
    await until(() => !!surface());
    const initial = surface();
    const control = field(initial, "input");
    tui.stop();
    input.setValue("changed while paused");
    tui.requestRender();
    const paused = surface();
    assert.equal(Reflect.get(paused.view, "inert"), true);
    assert.equal(Reflect.get(field(paused, "input"), "value"), "initial");
    await act(host, paused, control.action, "unwanted desktop edit");
    const result = await host.action({
      action: "desktop.input",
      args: {
        surfaceId: paused.id,
        instanceId: paused.instanceId,
        controlAction: control.action,
        data: "!",
      },
    });
    assert.equal((result as DesktopInputResult).consume, true);
    assert.equal(calls, 0);
    assert.equal(input.getValue(), "changed while paused");
    tui.start();
    const resumed = surface();
    assert.equal(resumed.instanceId, initial.instanceId);
    assert.notEqual(Reflect.get(resumed.view, "inert"), true);
    assert.equal(
      Reflect.get(field(resumed, "input"), "value"),
      "changed while paused",
    );
    await act(host, resumed, control.action, "resumed edit");
    assert.equal(input.getValue(), "resumed edit");
    const beforeSubmit = surface();
    input.onSubmit = () => {
      tui.stop();
      input.setValue("changed inside paused callback");
    };
    const submitResult = await host.action({
      action: "desktop.input",
      args: {
        surfaceId: beforeSubmit.id,
        instanceId: beforeSubmit.instanceId,
        controlAction: control.action,
        data: "\r",
      },
    });
    assert.deepEqual(submitResult, { consume: true });
    assert.equal(
      Reflect.get(field(surface(), "input"), "value"),
      "resumed edit",
    );
    assert.equal(input.getValue(), "changed inside paused callback");
    tui.start();
    assert.equal(
      Reflect.get(field(surface(), "input"), "value"),
      "changed inside paused callback",
    );
    host.session.extensionRunner.getUIContext().setHeader(undefined);
    tui.start();
    assert.equal(surface(), undefined);
  } finally {
    await setup.close();
  }
});

test("paused mapped overlays preserve presentation, height and original callback ownership", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text");
  let tui!: DesktopTui;
  const input = new api.Input();
  input.setValue("overlay initial");
  let renders = 0;
  const render = input.render.bind(input);
  input.render = (width) => {
    renders++;
    return render(width);
  };
  try {
    await registry.mount(
      (original: DesktopTui) => {
        tui = original;
        return new Text("Owner");
      },
      "header",
      "pause-owner",
    );
    const handle = tui.showOverlay(input, { width: "50%" });
    const surface = () => registry.surfaces.find((item) => item.overlay)!;
    await until(() => !!surface());
    const before = surface();
    const height = handle.getBounds()?.height;
    const control = field(before, "input");
    tui.stop();
    const count = renders;
    input.setValue("overlay resumed");
    registry.setViewport(70, 30);
    const paused = surface();
    assert.equal(paused.view.inert, true);
    assert.equal(
      Reflect.get(field(paused, "input"), "value"),
      "overlay initial",
    );
    assert.equal(handle.getBounds()?.height, height);
    assert.equal(renders, count);
    await registry.input(paused.id, "ignored");
    await registry.action(paused.id, {
      action: control.action,
      value: "ignored action",
    });
    assert.equal(input.getValue(), "overlay resumed");
    tui.start();
    const resumed = surface();
    assert.equal(resumed.instanceId, before.instanceId);
    assert.equal(
      Reflect.get(field(resumed, "input"), "value"),
      "overlay resumed",
    );
    assert.ok(renders > count);
    let submitted: string | undefined;
    input.onSubmit = (value) => {
      submitted = value;
    };
    await registry.input(resumed.id, "\r");
    assert.equal(submitted, "overlay resumed");
    tui.stop();
    handle.hide();
    tui.start();
    assert.equal(surface(), undefined);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("paused renderers defer updates and resume only the latest source with the original component", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const Text = Reflect.get(await loadTuiApi(), "Text");
  const original = new Text("initial");
  let tui!: DesktopTui;
  const calls: string[] = [];
  const renderer = (
    value: string,
    _options: unknown,
    _theme: unknown,
    context: { tui: DesktopTui; lastComponent: unknown },
  ) => {
    tui = context.tui;
    assert.equal(context.lastComponent, calls.length ? original : undefined);
    calls.push(value);
    original.setText(value);
    return original;
  };
  const reconcile = (value: string) =>
    registry.reconcile([
      {
        id: "paused-renderer",
        slot: "tool",
        target: { toolCallId: "pause-tool" },
        source: {
          kind: "toolResult",
          renderer,
          value,
          context: {
            expanded: false,
            isStreaming: false,
            isPartial: false,
            isError: false,
            argsComplete: true,
            executionStarted: true,
            cwd: setup.cwd,
          },
        } satisfies DesktopRenderSource,
      },
    ]);
  try {
    reconcile("initial");
    await until(() => registry.surfaces.length === 1);
    tui.stop();
    reconcile("intermediate");
    reconcile("latest");
    // Input joins the mounted operation queue after both source updates.
    await registry.input("paused-renderer", "ignored");
    assert.deepEqual(calls, ["initial"]);
    assert.ok(JSON.stringify(registry.surfaces).includes("initial"));
    tui.start();
    assert.ok(JSON.stringify(registry.surfaces).includes("latest"));
    assert.deepEqual(calls, ["initial", "latest"]);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("component color scheme listeners follow desktop appearance and generation lifetime", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    const Text = Reflect.get(await loadTuiApi(), "Text");
    const changes: string[] = [];
    let original!: DesktopTui;
    let unsubscribe!: () => void;
    const ui = host.session.extensionRunner.getUIContext();
    ui.setHeader((tui) => {
      original = tui;
      unsubscribe = tui.onTerminalColorSchemeChange((scheme) =>
        changes.push(scheme),
      );
      tui.setTerminalColorSchemeNotifications(true);
      return new Text("Appearance listener");
    });
    await until(() =>
      host.desktopUI.surfaces.some((surface) => surface.slot === "header"),
    );
    const appearance = (value: string) =>
      host.action({
        action: "desktop.appearance",
        args: { appearance: value },
      });
    await appearance("dark");
    await appearance("dark");
    assert.deepEqual(changes, ["dark"]);
    original.setTerminalColorSchemeNotifications(false);
    await appearance("light");
    assert.deepEqual(changes, ["dark"]);
    original.setTerminalColorSchemeNotifications(true);
    await appearance("dark");
    assert.deepEqual(changes, ["dark", "dark"]);
    unsubscribe();
    await appearance("light");
    assert.deepEqual(changes, ["dark", "dark"]);
    unsubscribe = original.onTerminalColorSchemeChange((scheme) =>
      changes.push(scheme),
    );
    ui.setHeader(undefined);
    original.setTerminalColorSchemeNotifications(true);
    await appearance("dark");
    assert.deepEqual(changes, ["dark", "dark", "dark"]);
    let failedOff!: () => void;
    await assert.rejects(
      host.desktopUI.mount(
        (tui: DesktopTui) => {
          failedOff = tui.onTerminalColorSchemeChange(() =>
            changes.push("failed factory"),
          );
          tui.setTerminalColorSchemeNotifications(true);
          throw new Error("Appearance factory failed");
        },
        "header",
        "appearance-failure",
      ),
      /Appearance factory failed/,
    );
    await appearance("light");
    assert.deepEqual(changes, [
      "dark",
      "dark",
      "dark",
      "light",
      "failed factory",
    ]);
    unsubscribe();
    failedOff();
    ui.setHeader((tui) => {
      original = tui;
      tui.onTerminalColorSchemeChange((scheme) =>
        changes.push(`replacement:${scheme}`),
      );
      tui.setTerminalColorSchemeNotifications(true);
      return new Text("Replacement appearance listener");
    });
    await until(() =>
      host.desktopUI.surfaces.some((surface) => surface.slot === "header"),
    );
    await appearance("dark");
    assert.deepEqual(changes, [
      "dark",
      "dark",
      "dark",
      "light",
      "failed factory",
      "replacement:dark",
    ]);
    await host.action({ action: "session.new" });
    assert.equal(original, host.desktopUI.terminalRuntime.capture().tui);
    original.onTerminalColorSchemeChange(() => changes.push("retained TUI"));
    original.setTerminalColorSchemeNotifications(true);
    await appearance("light");
    assert.deepEqual(changes, [
      "dark",
      "dark",
      "dark",
      "light",
      "failed factory",
      "replacement:dark",
      "replacement:light",
      "retained TUI",
    ]);
  } finally {
    await setup.close();
  }
});

test("component terminal title and progress preserve shared last-writer state and generation cleanup", async () => {
  const setup = await fixture();
  const { host } = setup;
  const titles: string[] = [];
  host.on("event", (event) => {
    if (event.type === "activity" && event.name === "title")
      titles.push(event.data);
  });
  try {
    await host.action({
      action: "prompt",
      args: { message: "/mapped-window" },
    });
    await until(() => !!dialog(host));
    assert.equal(
      host.snapshot().extensionUI.windowTitle,
      "Mapped component window",
    );
    assert.equal(host.snapshot().extensionUI.windowProgress, true);
    const surface = dialog(host)!;
    const input = field(surface, "input");
    await act(host, surface, input.action, "Original component title");
    await act(host, surface, `${input.action}:submit`);
    await until(() => !host.snapshot().busy);
    assert.equal(
      host.snapshot().extensionUI.windowTitle,
      "Original component title",
    );
    assert.equal(host.snapshot().extensionUI.windowProgress, false);
    assert.equal(
      host.snapshot().statuses["window-result"],
      "Original component title",
    );
    await host.action({
      action: "prompt",
      args: { message: "/mapped-window-clear" },
    });
    await until(() => !host.snapshot().busy);
    assert.equal(host.snapshot().extensionUI.windowProgress, false);
    assert.equal(host.snapshot().extensionUI.windowTitle, "SDK window title");
    await host.action({
      action: "prompt",
      args: { message: "/mapped-window fail" },
    });
    await until(() => !host.snapshot().busy);
    assert.equal(host.snapshot().extensionUI.windowProgress, true);
    await host.action({
      action: "prompt",
      args: { message: "/mapped-window" },
    });
    await until(() => !!dialog(host));
    await host.action({ action: "abort" });
    await until(() => !host.snapshot().busy);
    assert.equal(host.snapshot().extensionUI.windowProgress, false);
    await host.action({ action: "session.new" });
    assert.equal(host.snapshot().extensionUI.windowProgress, false);
    const Text = Reflect.get(await loadTuiApi(), "Text");
    host.session.extensionRunner.getUIContext().setHeader((tui) => {
      const text = new Text("Title from render");
      const render = text.render.bind(text);
      text.render = (width: number) => {
        tui.terminal.setTitle("Repeated render title");
        return render(width);
      };
      return text;
    });
    await until(
      () => host.snapshot().extensionUI.windowTitle === "Repeated render title",
    );
    for (let index = 0; index < 5; index++) host.snapshot();
    assert.deepEqual(
      titles.filter((title) => title === "Repeated render title"),
      ["Repeated render title"],
    );
  } finally {
    await setup.close();
  }
});

test("paused editor ignores desktop caret changes while preserving programmatic SDK edits", async () => {
  const setup = await mappedEditorFixture();
  try {
    setup.ui.setEditorText("original value");
    const cursor = setup.original.getCursor();
    setup.originalTui.stop();
    await setup.host.desktopUI.input(setup.surface.id, "ignored", undefined, {
      start: 0,
      end: 0,
    });
    assert.deepEqual(setup.original.getCursor(), cursor);
    assert.equal(setup.original.getText(), "original value");
    setup.ui.setEditorText("programmatic update");
    assert.equal(setup.ui.getEditorText(), "programmatic update");
    setup.originalTui.start();
    assert.equal(setup.original.getText(), "programmatic update");
  } finally {
    await setup.close();
  }
});

test("mapped editor SDK reads and editor replacement preserve expanded large paste content", async () => {
  const setup = await mappedEditorFixture();
  try {
    const payload = "Large paste ".repeat(120);
    setup.ui.setEditorText("Prefix ");
    setup.ui.pasteToEditor(payload);
    assert.match(setup.original.getText(), /\[paste #1/);
    assert.equal(setup.original.getExpandedText(), `Prefix ${payload}`);
    assert.equal(setup.ui.getEditorText(), `Prefix ${payload}`);
    await act(
      setup.host,
      setup.surface,
      field(setup.surface, "textarea").action,
      `${setup.original.getText()} typed`,
    );
    assert.equal(setup.ui.getEditorText(), `Prefix ${payload} typed`);
    setup.ui.setEditorComponent(undefined);
    await until(() =>
      setup.host.desktopUI.surfaces.some(
        (surface) =>
          surface.slot === "editor" &&
          surface.instanceId !== setup.surface.instanceId,
      ),
    );
    assert.equal(setup.ui.getEditorText(), `Prefix ${payload} typed`);
  } finally {
    await setup.close();
  }
});

test("mapped editor selection replacement retains unrelated large pastes and undoes atomically", async () => {
  const setup = await mappedEditorFixture();
  try {
    const payload = Array.from(
      { length: 12 },
      (_, index) => `Pasted line ${index + 1}`,
    ).join("\n");
    setup.ui.setEditorText("prefix suffix");
    setup.host.desktopUI.setEditorSelection({ start: 7, end: 7 });
    setup.ui.pasteToEditor(payload);
    const expanded = `prefix ${payload}suffix`;
    assert.equal(setup.original.getExpandedText(), expanded);
    setup.host.desktopUI.setEditorSelection({ start: 0, end: 6 });
    setup.ui.pasteToEditor("updated");
    assert.equal(setup.original.getExpandedText(), `updated ${payload}suffix`);
    await setup.host.action({
      action: "desktop.input",
      args: {
        surfaceId: "editor",
        instanceId: setup.surface.instanceId,
        controlAction: field(setup.surface, "textarea").action,
        data: "\x1a",
      },
    });
    assert.equal(setup.original.getExpandedText(), expanded);
  } finally {
    await setup.close();
  }
});

test("mapped editor typing over a browser selection is one original undo operation", async () => {
  const setup = await mappedEditorFixture();
  try {
    setup.ui.setEditorText("one two three");
    const action = field(setup.surface, "textarea").action;
    const input = (data: string, selection?: { start: number; end: number }) =>
      setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          instanceId: setup.surface.instanceId,
          controlAction: action,
          data,
          selection,
        },
      });
    await input("X", { start: 4, end: 7 });
    assert.equal(setup.original.getText(), "one X three");
    await input("\x1a");
    assert.equal(setup.original.getText(), "one two three");
  } finally {
    await setup.close();
  }
});

test("native text insertion retains Pi multiline state, original input listeners and one range undo", async () => {
  const setup = await mappedEditorFixture();
  try {
    const action = field(setup.surface, "textarea").action;
    const records: string[] = [],
      originalInputs: string[] = [];
    setup.ui.onTerminalInput((data) => {
      records.push(data);
      return undefined;
    });
    const originalInput = setup.original.handleInput.bind(setup.original);
    setup.original.handleInput = (data) => {
      originalInputs.push(data);
      originalInput(data);
    };
    let changes = 0;
    setup.original.onChange = () => {
      changes++;
    };
    const input = (data: string, selection?: { start: number; end: number }) =>
      setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          instanceId: setup.surface.instanceId,
          controlAction: action,
          data,
          selection,
        },
      });
    for (const sample of [
      {
        before: "draft text",
        selection: { start: 0, end: 10 },
        text: "line one\nline two",
        after: "line one\nline two",
      },
      {
        before: "prefix one\nsecond suffix",
        selection: { start: 7, end: 17 },
        text: "A\r\nB\tC",
        after: "prefix A\nB    C suffix",
      },
      {
        before: "draft text",
        selection: { start: 0, end: 10 },
        text: "中🙂e\u0301\nnext",
        after: "中🙂e\u0301\nnext",
      },
    ]) {
      setup.ui.setEditorText(sample.before);
      changes = 0;
      const encoded = encodeDesktopText(sample.text);
      await input(encoded, sample.selection);
      assert.equal(setup.original.getText(), sample.after);
      assert.deepEqual(setup.original.getLines(), sample.after.split("\n"));
      assert.equal(changes, 1);
      assert.equal(records.at(-1), encoded);
      assert.equal(originalInputs.at(-1), encoded);
      await input("\x1a");
      assert.equal(setup.original.getText(), sample.before);
    }
  } finally {
    await setup.close();
  }
});

test("mapped editor selected deletion runs original input handlers, callbacks and atomic undo", async () => {
  const setup = await mappedEditorFixture();
  try {
    const action = field(setup.surface, "textarea").action;
    const input = (data: string, selection?: { start: number; end: number }) =>
      setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          instanceId: setup.surface.instanceId,
          controlAction: action,
          data,
          selection,
        },
      });
    const originalInput = setup.original.handleInput;
    const calls: string[] = [],
      changes: string[] = [];
    const deletionMethods = ["handleBackspace", "handleForwardDelete"].map(
      (key) => {
        const original = Reflect.get(setup.original, key);
        let calls = 0;
        const handler = () => {
          calls++;
          return original.call(setup.original);
        };
        Reflect.set(setup.original, key, handler);
        return {
          key,
          original,
          handler,
          descriptor: Object.getOwnPropertyDescriptor(setup.original, key),
          calls: () => calls,
        };
      },
    );
    let mode = "delegate";
    setup.original.onChange = (text) => changes.push(text);
    setup.original.handleInput = (data) => {
      calls.push(data);
      if (mode === "consume") return;
      if (mode === "throw") throw new Error("Original deletion failed");
      originalInput.call(setup.original, data);
    };
    for (const data of ["\x7f", "\x1b[3~"]) {
      for (const sample of [
        {
          text: "one two three",
          selection: { start: 4, end: 7 },
          result: "one  three",
        },
        {
          text: "prefix one\nsecond suffix",
          selection: { start: 7, end: 17 },
          result: "prefix  suffix",
        },
        {
          text: "prefix 🙂e\u0301 suffix",
          selection: { start: 7, end: 11 },
          result: "prefix  suffix",
        },
        { text: "one\ntwo", selection: { start: 3, end: 4 }, result: "onetwo" },
      ]) {
        setup.ui.setEditorText(sample.text);
        calls.length = changes.length = 0;
        await input(data, sample.selection);
        assert.deepEqual(calls, [data]);
        assert.equal(setup.original.getText(), sample.result);
        assert.deepEqual(changes, [sample.result]);
        await input("\x1a");
        assert.equal(setup.original.getText(), sample.text);
      }
      setup.ui.setEditorText("one two three");
      mode = "consume";
      await input(data, { start: 4, end: 7 });
      assert.equal(setup.original.getText(), "one two three");
      const mapped = field(
        setup.host.desktopUI.surfaces.find((s) => s.slot === "editor")!,
        "textarea",
      );
      assert.ok(mapped.kind === "textarea");
      assert.equal(mapped.selection?.start, 4);
      assert.equal(mapped.selection?.end, 7);
      mode = "throw";
      await assert.rejects(
        input(data, { start: 4, end: 7 }),
        /Original deletion failed/,
      );
      assert.equal(setup.original.getText(), "one two three");
      mode = "delegate";
      await input(data, { start: 4, end: 7 });
      assert.equal(setup.original.getText(), "one  three");
    }
    for (const method of deletionMethods) {
      assert.ok(method.calls() > 0);
      assert.equal(Reflect.get(setup.original, method.key), method.handler);
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(setup.original, method.key),
        method.descriptor,
      );
    }
    setup.ui.setEditorText("one two three");
    const method = deletionMethods[0];
    const replaced = () => method.original.call(setup.original);
    const throwing = () => {
      method.original.call(setup.original);
      Reflect.set(setup.original, method.key, replaced);
      throw new Error("Original deletion primitive failed");
    };
    Reflect.set(setup.original, method.key, throwing);
    await assert.rejects(
      input("\x7f", { start: 4, end: 7 }),
      /Original deletion primitive failed/,
    );
    assert.equal(Reflect.get(setup.original, method.key), replaced);
    assert.equal(
      Reflect.get(setup.original, deletionMethods[1].key),
      deletionMethods[1].handler,
    );
    assert.equal(setup.original.getText(), "one  three");
    await input("\x1a");
    assert.equal(setup.original.getText(), "one two three");
  } finally {
    await setup.close();
  }
});

test("mapped Input range replacement and deletion retain one original undo snapshot and restore handlers after errors", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const original = new api.Input();
  const ui = setup.host.session.extensionRunner.getUIContext();
  const finished = ui.custom(() => original);
  try {
    await until(() => !!dialog(setup.host));
    const surface = dialog(setup.host)!;
    const action = field(surface, "input").action;
    const input = (data: string, selection?: { start: number; end: number }) =>
      setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: surface.id,
          instanceId: surface.instanceId,
          controlAction: action,
          data,
          selection,
        },
      });
    const undoMethod = Reflect.get(original, "pushUndo");
    const undoDescriptor = Object.getOwnPropertyDescriptor(
      original,
      "pushUndo",
    );
    const originalInput = original.handleInput;
    const calls: string[] = [];
    let consume = false;
    original.handleInput = (data) => {
      calls.push(data);
      if (!consume) originalInput.call(original, data);
    };
    for (const data of [
      encodeDesktopText("first\nsecond\titem"),
      "X",
      "\x7f",
      "\x1b[3~",
    ]) {
      await act(setup.host, surface, action, "name draft");
      calls.length = 0;
      await input(data, { start: 0, end: 10 });
      assert.deepEqual(calls, [data]);
      assert.equal(
        original.getValue(),
        data === "X"
          ? "X"
          : data.startsWith("\x1b[200~")
            ? "firstsecond    item"
            : "",
      );
      await input("\x1a");
      assert.equal(original.getValue(), "name draft");
      assert.equal(Reflect.get(original, "pushUndo"), undoMethod);
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(original, "pushUndo"),
        undoDescriptor,
      );
    }
    consume = true;
    await input("\x7f", { start: 0, end: 10 });
    assert.equal(original.getValue(), "name draft");
    original.handleInput = () => {
      throw new Error("Original Input failure");
    };
    await assert.rejects(
      input(encodeDesktopText("one\ntwo"), { start: 0, end: 10 }),
      /Original Input failure/,
    );
    assert.equal(Reflect.get(original, "pushUndo"), undoMethod);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(original, "pushUndo"),
      undoDescriptor,
    );
  } finally {
    const surface = dialog(setup.host);
    if (surface)
      await setup.host.action({
        action: "desktop.close",
        args: { id: surface.id },
      });
    await finished;
    await setup.close();
  }
});

test("mapped Input navigation preserves original handlers, graphemes, boundary collapse and property cleanup", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const original = new api.Input();
  const finished = setup.host.session.extensionRunner
    .getUIContext()
    .custom(() => original);
  try {
    await until(() => !!dialog(setup.host));
    const surface = dialog(setup.host)!;
    const action = field(surface, "input").action;
    await act(setup.host, surface, action, "a🙂bc");
    const originalInput = original.handleInput;
    let mode = "delegate";
    const calls: string[] = [];
    original.handleInput = (data) => {
      calls.push(data);
      if (mode === "consume") return;
      originalInput.call(original, data);
      if (mode === "throw") throw new Error("navigation handler failure");
    };
    const descriptors = ["cursor", "lastAction"].map((key) => ({
      key,
      descriptor: Object.getOwnPropertyDescriptor(original, key)!,
    }));
    const input = async (
      data: string,
      start: number,
      end: number,
      direction: "ltr" | "rtl" = "ltr",
    ) =>
      (await setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: surface.id,
          instanceId: surface.instanceId,
          controlAction: action,
          data,
          controlText: original.getValue(),
          selection: { start, end },
          editorLayout: {
            text: original.getValue(),
            width: 100,
            pageRows: 1,
            direction,
            rows: [
              {
                logicalLine: 0,
                startCol: 0,
                length: 5,
                carets: [0, 1, 3, 4, 5].map((offset) => ({
                  offset,
                  x: offset * 10,
                })),
              },
            ],
          },
        },
      })) as DesktopInputResult;
    assert.deepEqual((await input("\x1b[D", 0, 5)).editor?.selection, {
      start: 0,
      end: 0,
    });
    assert.deepEqual((await input("\x1b[C", 0, 5)).editor?.selection, {
      start: 5,
      end: 5,
    });
    assert.deepEqual((await input("\x1b[D", 1, 1, "rtl")).editor?.selection, {
      start: 3,
      end: 3,
    });
    assert.deepEqual((await input("\x1b[C", 3, 3, "rtl")).editor?.selection, {
      start: 1,
      end: 1,
    });
    mode = "consume";
    assert.deepEqual((await input("\x1b[C", 0, 5)).editor?.selection, {
      start: 0,
      end: 5,
    });
    mode = "throw";
    await assert.rejects(input("\x1b[C", 0, 5), /navigation handler failure/);
    for (const { key, descriptor } of descriptors) {
      const after = Object.getOwnPropertyDescriptor(original, key)!;
      assert.equal(after.get, undefined);
      assert.equal(after.set, undefined);
      assert.equal(after.writable, descriptor.writable);
      assert.equal(after.enumerable, descriptor.enumerable);
      assert.equal(after.configurable, descriptor.configurable);
    }
    assert.deepEqual(calls, [
      "\x1b[D",
      "\x1b[C",
      "\x1b[D",
      "\x1b[C",
      "\x1b[C",
      "\x1b[C",
    ]);
    assert.equal(original.getValue(), "a🙂bc");
  } finally {
    const surface = dialog(setup.host);
    if (surface)
      await setup.host.action({
        action: "desktop.close",
        args: { id: surface.id },
      });
    await finished;
    await setup.close();
  }
});

test("desktop selection shortcuts reach original Input handlers and retain their changes", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const original = new api.Input();
  const finished = setup.host.session.extensionRunner
    .getUIContext()
    .custom(() => original);
  try {
    await until(() => !!dialog(setup.host));
    const surface = dialog(setup.host)!;
    const action = field(surface, "input").action;
    let mode = "edit";
    const called: string[] = [];
    const delegate = original.handleInput;
    original.handleInput = (data) => {
      called.push(data);
      if (mode === "edit") original.setValue("original handler");
      else if (mode === "throw") throw new Error("selection shortcut failure");
      else delegate.call(original, data);
    };
    const input = async (data: string) =>
      (await setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: surface.id,
          instanceId: surface.instanceId,
          controlAction: action,
          data,
          controlText: original.getValue(),
          selection: { start: 1, end: 4 },
        },
      })) as DesktopInputResult;
    for (const data of ["\x01", "\x03", "\x18", "\x1b[1;2D", "\x1b[1;2C"]) {
      await act(setup.host, surface, action, "draft");
      const result = await input(data);
      assert.equal(
        called.at(-1),
        data,
        "Original handlers must receive native selection shortcuts",
      );
      assert.equal(result.consume, true);
      assert.equal(result.editor?.text, "original handler");
    }
    mode = "delegate";
    await act(setup.host, surface, action, "draft");
    assert.equal(
      (await input("\x01")).consume,
      false,
      "Default Ctrl+A retains desktop select-all",
    );
    assert.equal((await input("\x1b[1;2D")).consume, false);
    mode = "throw";
    await assert.rejects(input("\x01"), /selection shortcut failure/);
  } finally {
    const surface = dialog(setup.host);
    if (surface)
      await setup.host.action({
        action: "desktop.close",
        args: { id: surface.id },
      });
    await finished;
    await setup.close();
  }
});

test("desktop selection shortcuts reach original CustomEditor handlers before native fallback", async () => {
  const setup = await mappedEditorFixture();
  try {
    const api = await loadTuiApi();
    const bindings = api.getKeybindings();
    const original = setup.original;
    const delegate = original.handleInput;
    const called: string[] = [];
    original.handleInput = (data) => {
      called.push(data);
      original.setText("handled editor");
    };
    const action = field(setup.surface, "textarea").action;
    for (const data of ["\x01", "\x03", "\x18", "\x1b[1;2D", "\x1b[1;2C"]) {
      setup.ui.setEditorText("draft");
      const result = (await setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          instanceId: setup.surface.instanceId,
          controlAction: action,
          data,
          controlText: "draft",
          selection: { start: 1, end: 4 },
        },
      })) as DesktopInputResult;
      assert.equal(called.at(-1), data);
      assert.equal(result.consume, true);
      assert.equal(result.editor?.text, "handled editor");
      assert.equal(api.getKeybindings(), bindings);
    }
    original.handleInput = delegate;
    for (const data of ["\x03", "\x18"]) {
      setup.ui.setEditorText("draft");
      const result = (await setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          instanceId: setup.surface.instanceId,
          controlAction: action,
          data,
          controlText: "draft",
          selection: { start: 1, end: 4 },
        },
      })) as DesktopInputResult;
      assert.equal(
        original.getText(),
        "draft",
        "Copying selected text must not clear the default editor",
      );
      assert.equal(result.consume, false);
    }
  } finally {
    await setup.close();
  }
});

test("mapped editor caret and partial selection keep registered paste markers atomic", async () => {
  const setup = await mappedEditorFixture();
  try {
    const payload = "Atomic paste ".repeat(100);
    setup.ui.setEditorText("prefix ");
    setup.ui.pasteToEditor(payload);
    const raw = setup.original.getText();
    const markerEnd = raw.length;
    const action = field(setup.surface, "textarea").action;
    const input = (data: string, selection?: { start: number; end: number }) =>
      setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          instanceId: setup.surface.instanceId,
          controlAction: action,
          data,
          selection,
        },
      });
    await input("X", { start: 12, end: 12 });
    assert.equal(setup.original.getText(), `prefix X${raw.slice(7)}`);
    assert.equal(setup.ui.getEditorText(), `prefix X${payload}`);
    await input("\x1a");
    assert.equal(setup.original.getText(), raw);
    await input("\x7f", { start: 10, end: markerEnd - 2 });
    assert.equal(setup.original.getText(), "prefix ");
    await input("\x1a");
    assert.equal(setup.ui.getEditorText(), `prefix ${payload}`);
    setup.host.desktopUI.setEditorSelection({ start: 10, end: markerEnd - 1 });
    setup.ui.pasteToEditor("replacement");
    assert.equal(setup.ui.getEditorText(), "prefix replacement");
    await input("\x1a");
    assert.equal(setup.ui.getEditorText(), `prefix ${payload}`);
    setup.ui.setEditorText("literal [paste #999 1234 chars]");
    await input("X", { start: 12, end: 12 });
    assert.equal(setup.ui.getEditorText(), "literal [pasXte #999 1234 chars]");
  } finally {
    await setup.close();
  }
});

test("mapped paste previews expose real contents and preserve copy, removal, undo and stale actions", async () => {
  const setup = await mappedEditorFixture();
  try {
    let copied = "";
    setup.host.setClipboard({
      getText: async () => null,
      getImage: async () => null,
      setText: async (text) => {
        copied = text;
      },
    });
    const first = "a".repeat(1200),
      second = "b".repeat(1200);
    setup.ui.pasteToEditor(first);
    setup.ui.pasteToEditor(second);
    const descriptor = () => {
      const surface = setup.host.desktopUI.surfaces.find(
        (surface) => surface.slot === "editor",
      )!;
      const node = nodes(surface.view).find((node) => node.kind === "textarea");
      assert.ok(node && node.kind === "textarea");
      return node;
    };
    const editor = descriptor();
    assert.ok(editor.pastes && editor.pasteAction);
    assert.deepEqual(
      editor.pastes.map((paste) => paste.text),
      [first, second],
    );
    const original = setup.original.getText();
    const paste = editor.pastes[0];
    await act(setup.host, setup.surface, editor.pasteAction, {
      ...paste,
      command: "copy",
    });
    assert.equal(copied, first);
    await act(setup.host, setup.surface, editor.pasteAction, {
      ...paste,
      command: "remove",
    });
    assert.equal(setup.ui.getEditorText(), second);
    assert.deepEqual(
      descriptor().pastes?.map((paste) => paste.text),
      [second],
    );
    const input = (data: string, selection?: { start: number; end: number }) =>
      setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          instanceId: setup.surface.instanceId,
          controlAction: editor.action,
          data,
          selection,
        },
      });
    await input("\x1a");
    assert.equal(setup.original.getText(), original);
    assert.equal(setup.ui.getEditorText(), first + second);
    await input("\x7f", { start: paste.end, end: paste.end });
    const replacement = descriptor().pastes![0];
    assert.equal(replacement.marker, paste.marker);
    assert.equal(replacement.start, paste.start);
    assert.equal(replacement.text, second);
    copied = "";
    await act(setup.host, setup.surface, editor.pasteAction, {
      ...paste,
      command: "copy",
    });
    await act(setup.host, setup.surface, editor.pasteAction, {
      ...paste,
      command: "remove",
    });
    assert.equal(copied, "");
    assert.equal(setup.ui.getEditorText(), second);
    setup.ui.setEditorText("[paste #999 1200 chars]");
    assert.deepEqual(descriptor().pastes, []);
    await act(setup.host, setup.surface, editor.pasteAction, {
      ...paste,
      command: "remove",
    });
    assert.equal(setup.ui.getEditorText(), "[paste #999 1200 chars]");
  } finally {
    await setup.close();
  }
});

test("editor completion confirmation remains valid when Pi replaces its suggestion list", async () => {
  const setup = await mappedEditorFixture();
  try {
    const editorAction = field(setup.surface, "textarea").action;
    const input = (data: string) =>
      setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          instanceId: setup.surface.instanceId,
          controlAction: editorAction,
          data,
        },
      });
    const current = () =>
      setup.host.desktopUI.surfaces.find(
        (surface) => surface.slot === "editor",
      )!;
    setup.ui.setEditorText("/mapped-");
    await input("\t");
    await until(() =>
      nodes(current().view).some((node) => node.kind === "select"),
    );
    const firstList = field(current(), "select").action;
    const confirm = field(current(), "select");
    assert.ok(confirm.kind === "select" && confirm.submitAction);
    setup.ui.setEditorText("/mapped-s");
    await input("\t");
    await until(() =>
      nodes(current().view).some((node) => node.kind === "select"),
    );
    assert.notEqual(field(current(), "select").action, firstList);
    const replacement = field(current(), "select");
    assert.ok(replacement.kind === "select");
    const requested = replacement.options.find((option) =>
      option.label.includes("mapped-settings"),
    );
    assert.ok(requested);
    await act(setup.host, setup.surface, confirm.submitAction, requested.value);
    assert.equal(setup.ui.getEditorText(), "/mapped-settings ");
    await act(setup.host, setup.surface, confirm.submitAction);
    assert.equal(setup.ui.getEditorText(), "/mapped-settings ");
  } finally {
    await setup.close();
  }
});

test("mapped range edits preserve synchronous original callbacks, replacement handlers and exception cleanup", async () => {
  const setup = await mappedEditorFixture();
  try {
    const originalInput = setup.original.handleInput;
    const originalPush = Reflect.get(setup.original, "pushUndoSnapshot");
    const action = field(setup.surface, "textarea").action;
    const input = (data: string) =>
      setup.host.action({
        action: "desktop.input",
        args: {
          surfaceId: "editor",
          instanceId: setup.surface.instanceId,
          controlAction: action,
          data,
          selection: { start: 4, end: 7 },
        },
      });
    setup.ui.setEditorText("one two three");
    const changes: string[] = [];
    const onChange = (value: string) => changes.push(value);
    setup.original.onChange = onChange;
    let callsInside = 0;
    setup.original.handleInput = (data) => {
      originalInput.call(setup.original, data);
      callsInside = changes.length;
    };
    await input("X");
    assert.deepEqual(changes, ["one X three"]);
    assert.equal(callsInside, 1);
    assert.equal(setup.original.onChange, onChange);
    assert.equal(Reflect.get(setup.original, "pushUndoSnapshot"), originalPush);
    setup.ui.setEditorText("one two three");
    changes.length = 0;
    setup.original.handleInput = (data) => {
      originalInput.call(setup.original, data);
      throw new Error("Original editor input failed");
    };
    await assert.rejects(input("Y"), /Original editor input failed/);
    assert.deepEqual(changes, ["one Y three"]);
    assert.equal(setup.original.onChange, onChange);
    assert.equal(Reflect.get(setup.original, "pushUndoSnapshot"), originalPush);
    setup.ui.setEditorText("one two three");
    let replacementCalls = 0;
    const replacement = () => {
      replacementCalls++;
    };
    setup.original.handleInput = (data) => {
      setup.original.onChange = replacement;
      originalInput.call(setup.original, data);
    };
    await input("Z");
    assert.equal(setup.original.onChange, replacement);
    assert.equal(replacementCalls, 1);
    assert.equal(Reflect.get(setup.original, "pushUndoSnapshot"), originalPush);
  } finally {
    await setup.close();
  }
});

test("composer submission expands original paste markers and records the expanded history before clearing", async () => {
  const setup = await mappedEditorFixture();
  try {
    const payload = "Submitted paste ".repeat(90);
    setup.ui.setEditorText("prefix ");
    setup.ui.pasteToEditor(payload);
    const displayed = `${setup.original.getText()} suffix`;
    const expected = `prefix ${payload} suffix`;
    await setup.host.action({
      action: "prompt",
      args: { message: displayed, clearEditor: true },
    });
    await until(() =>
      setup.host.session.messages.some(
        (message) =>
          message.role === "user" &&
          (typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("")) === expected,
      ),
    );
    assert.equal(setup.original.getText(), "");
    await until(() => !setup.host.snapshot().busy);
    await setup.host.action({
      action: "desktop.input",
      args: {
        surfaceId: "editor",
        instanceId: setup.surface.instanceId,
        controlAction: field(setup.surface, "textarea").action,
        data: "\x1b[A",
      },
    });
    assert.equal(setup.original.getText(), expected);
  } finally {
    await setup.close();
  }
});

test("Pi mouse dispatch preserves a nested capture target, keyboard focus and explicit rendering flags", async () => {
  const setup = await fixture();
  let changes = 0;
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => changes++,
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text"),
    Container = Reflect.get(api, "Container"),
    MouseRegion = Reflect.get(api, "MouseRegion");
  const events: PiMouseEvent[] = [];
  const keys: string[] = [];
  let disposed = 0,
    fallbacks = 0;
  const child = new Text("Nested mouse target", 0, 0);
  child.focused = false;
  child.dispose = () => disposed++;
  child.handleInput = (data: string) => keys.push(data);
  child.handleMouse = (event: PiMouseEvent) => {
    events.push(event);
    return {
      handled: true,
      capture: event.type === "press",
      focus: event.type === "press",
      render: event.type === "move",
    };
  };
  const container = new Container();
  container.addChild(new Text("Mouse header", 0, 0));
  container.addChild(child);
  const region = new MouseRegion(container, () => {
    fallbacks++;
    return undefined;
  });
  try {
    await registry.mount(region, "dialog", "nested-mouse");
    const action = field(registry.surfaces[0], "region").action;
    const before = changes;
    const press = await registry.mouse("nested-mouse", action, pointer());
    assert.equal(press.capture, true);
    assert.equal(press.render, false);
    assert.ok(press.focusAction);
    assert.equal(child.focused, true);
    assert.equal(changes, before);
    assert.equal(events[0].y, 0);
    const drag = await registry.mouse(
      "nested-mouse",
      action,
      pointer({ type: "drag", x: -5, y: 6, screenX: 5, screenY: 26 }),
    );
    assert.equal(drag.capture, true);
    assert.equal(events.at(-1)?.x, -5);
    assert.equal(events.at(-1)?.y, 5);
    assert.equal(events.at(-1)?.height, 1);
    assert.equal(events.at(-1)?.width, 20);
    assert.equal(fallbacks, 0);
    const move = await registry.mouse(
      "nested-mouse",
      action,
      pointer({ type: "move", button: "none", screenX: 4, screenY: 26 }),
    );
    assert.equal(move.render, true);
    assert.ok(changes > before);
    await registry.input("nested-mouse", "x");
    assert.deepEqual(keys, ["x"]);
    const release = await registry.mouse(
      "nested-mouse",
      action,
      pointer({ type: "release", x: -5, y: 6, screenX: 5, screenY: 26 }),
    );
    assert.equal(release.capture, false);
    assert.equal(
      events.some((event) => event.type === "click"),
      false,
    );
    await registry.mouse("nested-mouse", action, pointer());
    container.removeChild(child);
    registry.surfaces;
    const retiredEvents = events.length;
    await registry.mouse(
      "nested-mouse",
      action,
      pointer({ type: "drag", screenX: 1, screenY: 30, y: 10 }),
    );
    assert.equal(events.length, retiredEvents);
    assert.equal(disposed, 1);
    assert.equal(
      (await registry.input("nested-mouse", "retired")).consume,
      false,
    );
    assert.deepEqual(keys, ["x"]);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("Pi mouse focus retains delegating containers and overlay owners across child removal", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text"),
    Container = Reflect.get(api, "Container"),
    MouseRegion = Reflect.get(api, "MouseRegion");
  const delegated: string[] = [],
    overlayKeys: string[] = [],
    childKeys: string[] = [];
  const child = new Text("Delegated child", 0, 0);
  child.focused = false;
  child.handleInput = (data: string) => childKeys.push(data);
  child.handleMouse = () => ({ handled: true, focus: true });
  const container = new Container();
  container.focused = false;
  container.handleInput = (data: string) => delegated.push(data);
  container.addChild(child);
  const root = new MouseRegion(container, () => undefined);
  let tui: DesktopTui | undefined;
  try {
    await registry.mount(
      (instance: DesktopTui) => {
        tui = instance;
        return root;
      },
      "dialog",
      "delegated-mouse",
    );
    assert.ok(tui);
    let surface = registry.surfaces.find(
      (item) => item.id === "delegated-mouse",
    )!;
    const press = await registry.mouse(
      surface.id,
      field(surface, "region").action,
      pointer({ y: 0 }),
    );
    assert.ok(press.focusAction);
    assert.equal(container.focused, true);
    assert.equal(child.focused, false);
    await registry.input(surface.id, "parent");
    assert.deepEqual(delegated, ["parent"]);
    assert.equal(childKeys.length, 0);
    container.removeChild(child);
    registry.surfaces;
    await registry.input(surface.id, "after-removal");
    assert.deepEqual(delegated, ["parent", "after-removal"]);

    const overlayChild = new Text("Overlay child", 0, 0);
    overlayChild.focused = false;
    overlayChild.handleInput = (data: string) => childKeys.push(data);
    overlayChild.handleMouse = () => ({ handled: true, focus: true });
    const overlay = new Container();
    overlay.focused = false;
    overlay.handleInput = (data: string) => overlayKeys.push(data);
    overlay.addChild(overlayChild);
    const handle = tui.showOverlay(overlay);
    await until(() => registry.surfaces.some((item) => item.overlay));
    surface = registry.surfaces.find((item) => item.overlay)!;
    await registry.mouse(
      surface.id,
      field(surface, "region").action,
      pointer({ y: 0 }),
    );
    assert.equal(handle.isFocused(), true);
    assert.equal(overlay.focused, true);
    assert.equal(overlayChild.focused, false);
    await registry.input(surface.id, "overlay");
    assert.deepEqual(overlayKeys, ["overlay"]);
    assert.equal(childKeys.length, 0);
    handle.hide();
    await registry.input("delegated-mouse", "restored");
    assert.equal(container.focused, true);
    assert.deepEqual(delegated, ["parent", "after-removal", "restored"]);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("Pi mouse gestures synthesize original clicks, retain handled presses and cancel without a click", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text"),
    MouseRegion = Reflect.get(api, "MouseRegion");
  const events: PiMouseEvent[] = [];
  const region = new MouseRegion(
    new Text("Click target"),
    (event: PiMouseEvent) => {
      events.push(event);
      return { handled: true };
    },
  );
  try {
    await registry.mount(region, "dialog", "click-mouse");
    const surface = registry.surfaces[0],
      action = field(surface, "region").action;
    for (let index = 0; index < 3; index++) {
      const press = await registry.mouse(surface.id, action, pointer({ y: 0 }));
      assert.equal(press.capture, false);
      assert.equal(press.retainPointer, true);
      await registry.mouse(
        surface.id,
        action,
        pointer({ type: "release", y: 0 }),
      );
    }
    assert.deepEqual(
      events
        .filter((event) => event.type === "click")
        .map((event) => event.clickCount),
      [1, 2, 3],
    );
    await registry.mouse(surface.id, action, pointer({ y: 0 }));
    await registry.mouse(
      surface.id,
      action,
      pointer({ type: "release", y: 0, cancelled: true }),
    );
    assert.equal(events.filter((event) => event.type === "click").length, 3);
    region.onMouse = () => undefined;
    const ignored = await registry.mouse(surface.id, action, pointer({ y: 0 }));
    assert.deepEqual(ignored, {
      handled: false,
      capture: false,
      retainPointer: false,
      render: false,
    });
    region.onMouse = (event: PiMouseEvent) => {
      events.push(event);
      return event.type === "click" ? { handled: true } : undefined;
    };
    await registry.mouse(surface.id, action, pointer({ y: 0 }));
    const selectionClick = await registry.mouse(
      surface.id,
      action,
      pointer({ type: "release", y: 0 }),
    );
    assert.equal(selectionClick.handled, true);
    assert.equal(events.filter((event) => event.type === "click").length, 4);
    for (const ending of ["cancel", "drag", "right", "link"] as const) {
      const button = ending === "right" ? "right" : "left";
      await registry.mouse(
        surface.id,
        action,
        pointer({ y: 0, button, nativeLink: ending === "link" }),
      );
      if (ending === "drag")
        await registry.mouse(
          surface.id,
          action,
          pointer({ type: "drag", screenX: 2 }),
        );
      await registry.mouse(
        surface.id,
        action,
        pointer({
          type: "release",
          y: 0,
          button,
          cancelled: ending === "cancel",
        }),
      );
    }
    assert.equal(events.filter((event) => event.type === "click").length, 4);
    const stale = await registry.mouse(
      surface.id,
      action,
      pointer(),
      "obsolete-instance",
    );
    assert.equal(stale.capture, false);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("custom native form mouse handlers retain Pi text changes, selection and single original callbacks", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/mapped-native-pointer" },
    });
    await until(() => !!dialog(host));
    const surface = dialog(host)!;
    const input = field(surface, "input"),
      editor = field(surface, "textarea"),
      select = field(surface, "select");
    assert.ok(select.kind === "select" && select.visibleOptions);
    const mouse = (action: string, event: DesktopMouseEvent) =>
      host.action({
        action: "desktop.mouse",
        args: { id: surface.id, instanceId: surface.instanceId, action, event },
      });
    const changed = (await mouse(
      input.action,
      pointer({
        button: "right",
        nativeControl: {
          action: input.action,
          kind: "input",
          text: "Native input selection",
          selection: { start: 6, end: 6 },
        },
      }),
    )) as { editor: { text: string }; render: boolean };
    assert.equal(changed.editor.text, "Original mouse override");
    assert.equal(changed.render, false);
    await act(host, surface, `${input.action}:submit`);
    assert.equal(host.snapshot().statuses["native-input-submit"], "1");
    const native = {
      action: editor.action,
      kind: "textarea" as const,
      text: "Native textarea selection",
      selection: { start: 7, end: 7 },
    };
    const press = (await mouse(
      editor.action,
      pointer({ nativeControl: native }),
    )) as { handled: boolean; retainPointer: boolean };
    assert.equal(press.handled, false);
    assert.equal(press.retainPointer, false);
    const dragged = { ...native, selection: { start: 7, end: 15 } };
    await mouse(
      editor.action,
      pointer({ type: "drag", screenX: 15, nativeControl: dragged }),
    );
    await mouse(
      editor.action,
      pointer({ type: "release", screenX: 15, nativeControl: dragged }),
    );
    const released = field(dialog(host)!, "textarea");
    assert.ok(released.kind === "textarea");
    assert.equal(released.selection?.start, 7);
    assert.equal(released.selection?.end, 15);
    assert.deepEqual(
      JSON.parse(host.snapshot().statuses["native-editor-pointer"]),
      ["press", "drag", "release"],
    );
    await act(host, surface, select.action, "high");
    const option = {
      action: select.action,
      kind: "select" as const,
      value: "high",
    };
    await mouse(select.action, pointer({ nativeControl: option }));
    await mouse(
      select.action,
      pointer({ type: "release", nativeControl: option }),
    );
    assert.deepEqual(
      JSON.parse(host.snapshot().statuses["native-select-change"]),
      { value: "high", count: 1 },
    );
    assert.deepEqual(
      JSON.parse(host.snapshot().statuses["native-select-submit"]),
      { value: "high", count: 1 },
    );
    await assert.rejects(
      mouse(
        select.action,
        pointer({ nativeControl: { ...option, value: "removed" } }),
      ),
      /no longer available/,
    );
    await assert.rejects(
      mouse(
        input.action,
        pointer({ nativeControl: { ...native, action: editor.action } }),
      ),
      /does not match/,
    );
    await assert.rejects(
      mouse(
        input.action,
        pointer({
          nativeControl: {
            action: input.action,
            kind: "select",
            value: "high",
          },
        }),
      ),
      /type does not match/,
    );
  } finally {
    await setup.close();
  }
});

test("native controls route through original container and settings mouse handlers once", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/mapped-native-regions" },
    });
    await until(() => !!dialog(host));
    const surface = dialog(host)!;
    const root = field(surface, "region");
    const input = field(surface, "input");
    const mouse = (event: DesktopMouseEvent) =>
      host.action({
        action: "desktop.mouse",
        args: {
          id: surface.id,
          instanceId: surface.instanceId,
          action: root.action,
          event,
        },
      });
    const native = {
      action: input.action,
      kind: "input" as const,
      text: "Native nested selection",
      selection: { start: 7, end: 7 },
    };
    await mouse(pointer({ nativeControl: native }));
    await mouse(pointer({ type: "release", nativeControl: native }));
    const types = JSON.parse(
      host.snapshot().statuses["native-capture-pointer"],
    );
    assert.deepEqual(types, ["press", "release", "click"]);
    assert.deepEqual(
      JSON.parse(host.snapshot().statuses["native-container-pointer"]),
      ["press"],
    );
    const wheel = (await mouse(
      pointer({ type: "wheel", wheelDelta: 1, nativeControl: native }),
    )) as {
      editor: { text: string };
      render: boolean;
    };
    assert.equal(wheel.editor.text, "Parent wheel override");
    assert.equal(wheel.render, false);
    assert.deepEqual(
      JSON.parse(host.snapshot().statuses["native-inner-region"]),
      ["wheel"],
    );
    assert.deepEqual(
      JSON.parse(host.snapshot().statuses["native-outer-region"]),
      ["wheel"],
    );
    const captureNative = { ...native, text: wheel.editor.text };
    const press = (await mouse(
      pointer({ button: "middle", nativeControl: captureNative }),
    )) as { capture: boolean };
    assert.equal(press.capture, true);
    const drag = (await mouse(
      pointer({
        type: "drag",
        button: "middle",
        screenY: 30,
        nativeControl: { ...captureNative, offset: { x: 0.5, y: 2 } },
      }),
    )) as { editor: { text: string } };
    assert.equal(drag.editor.text, "Native captured outside");
    await mouse(
      pointer({
        type: "release",
        button: "middle",
        screenY: 30,
        nativeControl: {
          ...captureNative,
          text: drag.editor.text,
          offset: { x: 0.5, y: 2 },
        },
      }),
    );
    const setting = nodes(dialog(host)!.view).find(
      (node) =>
        node.kind === "button" &&
        node.mouseControl &&
        node.label.startsWith("Mode:"),
    );
    assert.ok(setting?.kind === "button");
    const context = { action: setting.action, kind: "setting" as const };
    await mouse(pointer({ nativeControl: context }));
    await mouse(pointer({ type: "release", nativeControl: context }));
    assert.deepEqual(
      JSON.parse(host.snapshot().statuses["native-settings-change"]),
      {
        id: "mode:choice",
        value: "expanded",
        count: 1,
      },
    );
    assert.deepEqual(
      JSON.parse(host.snapshot().statuses["native-settings-pointer"]),
      ["press", "release", "click"],
    );
    await assert.rejects(
      mouse(
        pointer({
          nativeControl: {
            action: setting.action.replace("mode%3Achoice", "missing"),
            kind: "setting",
          },
        }),
      ),
      /no longer available/,
    );
  } finally {
    await setup.close();
  }
});

test("horizontal layout routes native pointer input to the original right column handler", async () => {
  const setup = await fixture();
  const { host } = setup;
  try {
    await host.action({
      action: "prompt",
      args: { message: "/mapped-layout-pointer" },
    });
    await until(() => !!dialog(host));
    const surface = dialog(host)!;
    const root = field(surface, "region");
    const right = nodes(surface.view).find(
      (node) => node.kind === "input" && node.label === "Right column",
    );
    assert.ok(right?.kind === "input");
    const result = (await host.action({
      action: "desktop.mouse",
      args: {
        id: surface.id,
        instanceId: surface.instanceId,
        action: root.action,
        event: pointer({
          type: "wheel",
          wheelDelta: 1,
          nativeControl: {
            action: right.action,
            kind: "input",
            text: right.value,
            selection: { start: 3, end: 3 },
          },
        }),
      },
    })) as { editor?: { text: string } };
    assert.equal(result.editor?.text, "Right original wheel");
    assert.equal(host.snapshot().statuses["layout-Left-pointer"], undefined);
    const records = JSON.parse(
      host.snapshot().statuses["layout-Right-pointer"],
    );
    assert.equal(records.length, 1);
    assert.ok(records[0].width < 20);
  } finally {
    await setup.close();
  }
});

test("desktop hit paths distinguish shared horizontal occurrences and retain their capture transforms", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text"),
    HStack = Reflect.get(api, "HStack"),
    Container = Reflect.get(api, "Container");
  const events: PiMouseEvent[] = [];
  let parentCalls = 0;
  const shared = new Text("Shared target", 0, 0);
  shared.handleMouse = (event: PiMouseEvent) => {
    events.push(event);
    return { handled: true, capture: event.type === "press", render: false };
  };
  const stack = new HStack([shared, shared], { gap: 2 });
  const root = new (class extends Container {
    handleMouse(event: PiMouseEvent) {
      parentCalls++;
      this.render(20);
      return super.handleMouse(event);
    }
  })();
  root.addChild(stack);
  const original = shared.handleMouse;
  const layout = stack.mouseLayout;
  try {
    await registry.mount(root, "dialog", "shared-hit");
    const surface = registry.surfaces[0];
    const identities = nodes(surface.view)
      .filter((node) => node.component)
      .map((node) => node.component!);
    const [rootId, stackId, first, second] = identities;
    assert.equal(first.action, second.action);
    assert.notEqual(first.occurrence, second.occurrence);
    const hit = (x: number, type: DesktopMouseEvent["type"]) =>
      pointer({
        type,
        x: 12 + x,
        y: 0,
        screenX: 22 + x,
        screenY: 20,
        hitPath: [
          { ...rootId, x: 12 + x, y: 0, width: 20, height: 1 },
          { ...stackId, x: 12 + x, y: 0, width: 20, height: 1 },
          { ...second, x, y: 0, width: 8, height: 1 },
        ],
      });
    const press = await registry.mouse(
      surface.id,
      rootId.action,
      hit(3, "press"),
    );
    assert.equal(press.capture, true);
    assert.equal(parentCalls, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].x, 3);
    assert.equal(events[0].width, 8);
    await registry.mouse(surface.id, rootId.action, hit(-15, "drag"));
    assert.equal(events.at(-1)?.x, -15);
    assert.equal(parentCalls, 1);
    await registry.mouse(surface.id, rootId.action, hit(-15, "release"));
    assert.deepEqual(
      events.map((event) => event.type),
      ["press", "drag", "release"],
    );
    assert.equal(shared.handleMouse, original);
    assert.equal(Object.hasOwn(stack, "handleMouse"), false);
    assert.equal(stack.mouseLayout, layout);
    await assert.rejects(
      registry.mouse(
        surface.id,
        rootId.action,
        pointer({
          hitPath: [
            { ...rootId, x: 1, y: 0, width: 20, height: 1 },
            { ...second, x: 1, y: 0, width: 8, height: 1 },
          ],
        }),
      ),
      /hit path is no longer available/,
    );
  } finally {
    registry.dispose();
    await setup.close();
  }
});

test("desktop paths route clipped scroll children and leave vertical gaps to the original parent", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text"),
    VStack = Reflect.get(api, "VStack"),
    ScrollView = Reflect.get(api, "ScrollView"),
    MouseRegion = Reflect.get(api, "MouseRegion");
  const events: PiMouseEvent[] = [];
  let fallbacks = 0;
  const first = new Text("First", 0, 0),
    last = new Text("Last", 0, 0);
  first.handleMouse = () => {
    throw new Error("Offscreen child must not receive this event");
  };
  last.handleMouse = (event: PiMouseEvent) => {
    events.push(event);
    return { handled: true, render: false };
  };
  const stack = new VStack([first, last], { gap: 4 });
  const scroll = new ScrollView(stack);
  scroll.updateLayout(6, 2, () => {});
  scroll.scrollTo(4);
  const root = new MouseRegion(scroll, () => {
    fallbacks++;
    return { handled: true, render: false };
  });
  try {
    await registry.mount(root, "dialog", "scroll-hit");
    const surface = registry.surfaces[0];
    const [rootId, scrollId, stackId, , lastId] = nodes(surface.view)
      .filter((node) => node.component)
      .map((node) => node.component!);
    const hitPath = [
      { ...rootId, x: 2, y: 1, width: 20, height: 2 },
      { ...scrollId, x: 2, y: 1, width: 20, height: 2 },
      { ...stackId, x: 2, y: 5, width: 20, height: 6 },
      { ...lastId, x: 2, y: 0, width: 20, height: 1 },
    ];
    await registry.mouse(
      surface.id,
      rootId.action,
      pointer({ type: "wheel", hitPath }),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].y, 0);
    assert.equal(fallbacks, 0);
    assert.equal(scroll.scrollTop, 4);
    assert.equal(scroll.viewportHeight, 2);
    await registry.mouse(
      surface.id,
      rootId.action,
      pointer({
        type: "wheel",
        hitPath: hitPath.slice(0, 3).map((hit) => ({ ...hit, y: hit.y - 1 })),
      }),
    );
    assert.equal(events.length, 1);
    assert.equal(fallbacks, 1);
    assert.equal(scroll.scrollTop, 4);
  } finally {
    registry.dispose();
    await setup.close();
  }
});

test("scoped mouse dispatch restores original handlers after errors and preserves layout writes from original render", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text"),
    HStack = Reflect.get(api, "HStack"),
    Container = Reflect.get(api, "Container");
  const child = new Text("Failing child", 0, 0);
  const stack = new HStack([child]);
  const root = new (class extends Container {
    handleMouse(event: PiMouseEvent) {
      return super.handleMouse(event);
    }
  })();
  root.addChild(stack);
  const originalRoot = root.handleMouse;
  const next = () => ({ handled: true, render: false });
  child.handleMouse = () => {
    root.render(23);
    child.handleMouse = next;
    throw new Error("Original handler failure");
  };
  try {
    await registry.mount(root, "dialog", "error-hit");
    const surface = registry.surfaces[0];
    const hitPath = nodes(surface.view)
      .filter((node) => node.component)
      .map((node) => ({
        ...node.component!,
        x: 2,
        y: 0,
        width: 20,
        height: 1,
      }));
    await assert.rejects(
      registry.mouse(
        surface.id,
        hitPath[0].action,
        pointer({ type: "wheel", hitPath }),
      ),
      /Original handler failure/,
    );
    assert.equal(root.handleMouse, originalRoot);
    assert.equal(Object.hasOwn(root, "handleMouse"), false);
    assert.equal(Object.hasOwn(stack, "handleMouse"), false);
    assert.equal(child.handleMouse, next);
    assert.equal(root.mouseLayout.width, 23);
    const result = await registry.mouse(
      surface.id,
      hitPath[0].action,
      pointer({ type: "wheel", hitPath }),
    );
    assert.equal(result.handled, true);
  } finally {
    registry.dispose();
    await setup.close();
  }
});

test("mapped overlay bounds retain Pi sizing, margins, percentages and original render width", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text");
  const root = new Text("first\nsecond\nthird", 0, 0);
  const ui = setup.host.session.extensionRunner.getUIContext();
  let tui: DesktopTui | undefined;
  let handle: ReturnType<DesktopTui["showOverlay"]> | undefined;
  let options: NonNullable<Parameters<DesktopTui["showOverlay"]>[1]> = {};
  const widths: number[] = [];
  const render = root.render.bind(root);
  root.render = (width: number) => {
    widths.push(width);
    if (handle) assert.equal(handle.getBounds()?.width, width);
    return render(width);
  };
  const pending = ui.custom(
    (instance) => {
      tui = instance;
      return root;
    },
    {
      overlay: true,
      overlayOptions: () => options,
      onHandle: (value) => {
        handle = value;
      },
    },
  );
  try {
    await until(() => !!handle && !!tui);
    for (const viewport of [
      { width: 101, height: 41 },
      { width: 21, height: 13 },
    ]) {
      setup.host.desktopUI.setViewport(viewport.width, viewport.height);
      const cases: (typeof options)[] = [
        {},
        {
          width: "55.5%",
          maxHeight: 2,
          row: "100%",
          col: "100%",
          margin: { top: 2, right: 3, bottom: 4, left: 5 },
        },
        {
          width: 50,
          minWidth: 70,
          maxHeight: "50%",
          anchor: "bottom-right",
          margin: 3,
          offsetX: 8,
          offsetY: 8,
        },
        {
          width: "50%",
          row: "33.3%",
          col: "66.6%",
          margin: { left: 7, bottom: 2 },
        },
        { anchor: "top-left", margin: -3, offsetX: -8, offsetY: -8 },
      ];
      for (options of cases) {
        const resolve = Reflect.get(tui!, "resolveOverlayLayout");
        const dimensions = resolve.call(
          tui,
          options,
          0,
          viewport.width,
          viewport.height,
        );
        const height = Math.min(
          render(dimensions.width).length,
          dimensions.maxHeight ?? Infinity,
        );
        const expected = resolve.call(
          tui,
          options,
          height,
          viewport.width,
          viewport.height,
        );
        assert.deepEqual(handle!.getBounds(), {
          row: expected.row,
          col: expected.col,
          width: expected.width,
          height,
        });
        const surface = setup.host.desktopUI.surfaces.find(
          (surface) => surface.overlay,
        )!;
        assert.deepEqual(surface.overlay!.bounds, handle!.getBounds());
        assert.equal(widths.at(-1), expected.width);
      }
    }
    root.setText("one\ntwo\nthree\nfour\nfive\nsix");
    options = { anchor: "bottom-left", maxHeight: 4, margin: 1 };
    assert.deepEqual(handle!.getBounds(), {
      col: 1,
      row: 8,
      width: 19,
      height: 4,
    });
    options = { anchor: "bottom-right", width: "50%", margin: 1 };
    const registry = setup.host.desktopUI;
    let surface = registry.surfaces.find((item) => item.overlay)!;
    const staleKey = surface.overlay!.layoutKey!;
    assert.equal(
      registry.measureOverlay(surface.id, surface.instanceId, staleKey, 9),
      true,
    );
    assert.equal(handle!.getBounds()!.height, 9);
    assert.equal(handle!.getBounds()!.row, 3);
    registry.setViewport(31, 21);
    assert.equal(
      registry.measureOverlay(surface.id, surface.instanceId, staleKey, 1),
      false,
    );
    surface = registry.surfaces.find((item) => item.overlay)!;
    assert.equal(
      registry.measureOverlay(
        surface.id,
        "retired",
        surface.overlay!.layoutKey!,
        1,
      ),
      false,
    );
    assert.equal(
      registry.measureOverlay(
        surface.id,
        surface.instanceId,
        surface.overlay!.layoutKey!,
        8,
      ),
      true,
    );
    assert.equal(handle!.getBounds()!.row, 12);
    assert.throws(
      () =>
        registry.measureOverlay(
          surface.id,
          surface.instanceId,
          surface.overlay!.layoutKey!,
          NaN,
        ),
      /Invalid desktop overlay height/,
    );
  } finally {
    handle?.hide();
    setup.host.desktopUI.clearSurfaces();
    await pending;
    await setup.close();
  }
});

test("overlay component visibility uses original stack viewport, padding and allocated child widths", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const HStack = Reflect.get(api, "HStack"),
    Box = Reflect.get(api, "Box"),
    Text = Reflect.get(api, "Text");
  const nested = new HStack([
    {
      component: new Text("Allocated-width child", 0, 0),
      visible: ({ width, height }: { width: number; height: number }) =>
        width >= 20 && height === Number.MAX_SAFE_INTEGER,
    },
  ]);
  const stack = new HStack([
    {
      component: new Text("Always visible", 0, 0),
      basis: 12,
      grow: 0,
      shrink: 0,
    },
    { component: nested, grow: 1 },
    {
      component: new Text("Never allocated", 0, 0),
      basis: 0,
      grow: 0,
      shrink: 0,
    },
  ]);
  const box = new Box(2, 0);
  box.addChild(stack);
  const ui = setup.host.session.extensionRunner.getUIContext();
  let width = 30;
  let handle: ReturnType<DesktopTui["showOverlay"]> | undefined;
  const pending = ui.custom(() => box, {
    overlay: true,
    overlayOptions: () => ({ width }),
    onHandle: (value) => {
      handle = value;
    },
  });
  const contents = () =>
    nodes(setup.host.desktopUI.surfaces.find((item) => item.overlay)!.view)
      .filter((node) => node.kind === "text")
      .map((node) => (node.kind === "text" ? node.text : ""));
  try {
    await until(() => !!handle);
    assert.deepEqual(contents(), ["Always visible"]);
    width = 60;
    assert.deepEqual(contents(), ["Always visible", "Allocated-width child"]);
    width = 30;
    assert.deepEqual(contents(), ["Always visible"]);
  } finally {
    handle?.hide();
    setup.host.desktopUI.clearSurfaces();
    await pending;
    await setup.close();
  }
});

test("direct TUI overlays map standard components and retain their global lifetime after creator close", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Input = Reflect.get(api, "Input");
  let tui: DesktopTui | undefined;
  const parent = new Input({ prompt: "Parent input" });
  const first = new Input({ prompt: "First overlay" });
  const second = new Input({ prompt: "Second overlay" });
  let disposed = 0;
  first.dispose = second.dispose = () => disposed++;
  try {
    await registry.mount(
      (instance: DesktopTui) => {
        tui = instance;
        instance.setFocus(parent);
        return parent;
      },
      "dialog",
      "overlay-parent",
    );
    assert.ok(tui);
    const firstHandle = tui.showOverlay(first, {
      width: 40,
      anchor: "top-left",
      visible: (width) => width >= 60,
    });
    await until(() => registry.surfaces.some((surface) => surface.overlay));
    const firstSurface = registry.surfaces.find((surface) => surface.overlay)!;
    assert.equal(
      field(firstSurface, "input").action.startsWith("component:"),
      true,
    );
    assert.equal(firstHandle.isFocused(), true);
    assert.equal(firstHandle.getBounds()?.width, 40);
    const firstControl = field(firstSurface, "input");
    const actionView = await registry.action(firstSurface.id, {
      action: firstControl.action,
      value: "typed",
    });
    assert.ok(actionView);
    const actionInput = nodes(actionView).find((node) => node.kind === "input");
    assert.ok(actionInput && "value" in actionInput);
    assert.equal(actionInput.value, "typed");
    await registry.key(firstSurface.id, { key: "a" });
    assert.equal(first.getValue(), "typeda");
    assert.equal(parent.getValue(), "");
    const secondHandle = tui.showOverlay(second, { width: 30 });
    await until(
      () => registry.surfaces.filter((surface) => surface.overlay).length === 2,
    );
    const secondSurface = registry.surfaces.find(
      (surface) => surface.overlay && surface.id !== firstSurface.id,
    )!;
    assert.equal(firstHandle.isFocused(), false);
    assert.equal(secondHandle.isFocused(), true);
    await registry.action(firstSurface.id, {
      action: `${firstControl.action}:selection`,
      value: { text: first.getValue(), start: 1, end: 1 },
    });
    assert.equal(firstHandle.isFocused(), false);
    assert.equal(secondHandle.isFocused(), true);
    secondHandle.setHidden(true);
    assert.equal(secondHandle.isHidden(), true);
    assert.equal(firstHandle.isFocused(), true);
    assert.equal(
      registry.surfaces.find((surface) => surface.id === secondSurface.id)
        ?.overlay?.hidden,
      true,
    );
    secondHandle.setHidden(false);
    assert.equal(secondHandle.isFocused(), true);
    secondHandle.unfocus({ target: first });
    assert.equal(firstHandle.isFocused(), true);
    registry.focus(secondSurface.id);
    assert.equal(secondHandle.isFocused(), true);
    registry.setViewport(50, 40);
    assert.equal(
      registry.surfaces.find((surface) => surface.id === firstSurface.id)
        ?.overlay?.hidden,
      true,
    );
    registry.setViewport(120, 40);
    tui.hideOverlay();
    assert.equal(
      registry.surfaces.some((surface) => surface.id === secondSurface.id),
      false,
    );
    assert.equal(firstHandle.isFocused(), true);
    registry.close("overlay-parent");
    assert.equal(tui.hasOverlay(), true);
    assert.equal(
      registry.surfaces.filter((surface) => surface.overlay).length,
      1,
    );
    assert.equal(disposed, 0);
    firstHandle.hide();
    secondHandle.hide();
    registry.clearSurfaces();
    assert.equal(disposed, 2);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("retired async component factories release late trees without rendering or replacing their successor", async () => {
  for (const retirement of ["replace", "close", "dispose"]) {
    const setup = await fixture();
    const registry = new DesktopUIRegistry(
      () => setup.host.sdk,
      () => {},
    );
    registerComponentMappings(registry);
    const api = await loadTuiApi();
    const Text = Reflect.get(api, "Text");
    const Container = Reflect.get(api, "Container");
    let resume!: () => void;
    let entered = false;
    let renders = 0;
    const disposed: string[] = [];
    const child = new Text("Retired child");
    child.dispose = () => disposed.push("child");
    const root = new Container();
    root.addChild(child);
    root.dispose = () => {
      disposed.push("root");
      child.dispose();
    };
    const render = root.render.bind(root);
    root.render = (width: number) => {
      renders++;
      return render(width);
    };
    try {
      const pending = registry.mount(
        async () => {
          entered = true;
          await new Promise<void>((resolve) => {
            resume = resolve;
          });
          return root;
        },
        "header",
        "async-root",
      );
      await until(() => entered);
      if (retirement === "replace")
        await registry.mount(
          () => new Text("Successor"),
          "header",
          "async-root",
        );
      else if (retirement === "close") registry.close("async-root");
      else registry.dispose();
      resume();
      await pending;
      assert.equal(renders, 0);
      assert.deepEqual(disposed.sort(), ["child", "root"]);
      assert.equal(registry.surfaces.length, retirement === "replace" ? 1 : 0);
      if (retirement === "replace")
        assert.ok(JSON.stringify(registry.surfaces).includes("Successor"));
      registry.clearSurfaces();
      assert.deepEqual(disposed.sort(), ["child", "root"]);
    } finally {
      registry.clearSurfaces();
      await setup.close();
    }
  }
});

test("component trees are released when their first render throws", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text");
  const Container = Reflect.get(api, "Container");
  const child = new Text("Never rendered");
  const root = new Container();
  const disposed: string[] = [];
  child.dispose = () => disposed.push("child");
  root.addChild(child);
  root.dispose = () => {
    disposed.push("root");
    child.dispose();
  };
  root.render = () => {
    throw new Error("Original render failed");
  };
  try {
    await assert.rejects(
      setup.host.desktopUI.mount(() => root, "header", "render-failure"),
      /Original render failed/,
    );
    assert.deepEqual(disposed.sort(), ["child", "root"]);
    assert.ok(
      !setup.host.desktopUI.surfaces.some(
        (surface) => surface.id === "render-failure",
      ),
    );
  } finally {
    await setup.close();
  }
});

test("throwing component disposers release siblings and preserve the original render failure", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text");
  const Container = Reflect.get(api, "Container");
  const originalError = new Error("Original render failure");
  const disposed: string[] = [];
  const notices: string[] = [];
  setup.host.on("event", (event) => {
    if (event.type === "notice") notices.push(event.message);
  });
  const root = new Container();
  for (const name of ["broken", "healthy"]) {
    const child = new Text(name);
    child.dispose = () => {
      disposed.push(name);
      if (name === "broken") throw new Error("Child cleanup failure");
    };
    root.addChild(child);
  }
  root.dispose = () => {
    disposed.push("root");
    throw new Error("Parent cleanup failure");
  };
  root.render = () => {
    throw originalError;
  };
  try {
    await assert.rejects(
      setup.host.desktopUI.mount(() => root, "header", "throwing-cleanup"),
      (error) => error === originalError,
    );
    assert.deepEqual(disposed, ["root", "broken", "healthy"]);
    assert.equal(
      notices.filter((message) => message.includes("Parent cleanup failure"))
        .length,
      1,
    );
    assert.equal(
      notices.filter((message) => message.includes("Child cleanup failure"))
        .length,
      1,
    );
  } finally {
    await setup.close();
  }
});

test("closing a component with a throwing disposer retains its result and releases children once", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text");
  const Container = Reflect.get(api, "Container");
  let childDisposals = 0;
  let rootDisposals = 0;
  let mounted = false;
  let terminal!: DesktopTui["terminal"];
  const errors: string[] = [];
  setup.host.on("event", (event) => {
    if (event.type === "notice" && event.level === "error")
      errors.push(event.message);
  });
  try {
    const result = setup.host.session.extensionRunner
      .getUIContext()
      .custom((tui) => {
        terminal = tui.terminal;
        tui.terminal.setProgress(true);
        const root = new Container();
        const child = new Text("Healthy child");
        child.dispose = () => {
          childDisposals++;
        };
        root.addChild(child);
        root.dispose = () => {
          rootDisposals++;
          throw new Error("Close cleanup failure");
        };
        mounted = true;
        return root;
      });
    await until(() => mounted && !!dialog(setup.host));
    const surface = dialog(setup.host)!;
    setup.host.desktopUI.close(surface.id, "original result");
    assert.equal(await result, "original result");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(childDisposals, 1);
    assert.equal(rootDisposals, 1);
    assert.equal(setup.host.snapshot().extensionUI.windowProgress, true);
    terminal.setProgress(false);
    assert.equal(setup.host.snapshot().extensionUI.windowProgress, false);
    assert.deepEqual(errors, ["Close cleanup failure"]);
    setup.host.desktopUI.close(surface.id);
    assert.equal(rootDisposals, 1);
    assert.equal(childDisposals, 1);
  } finally {
    await setup.close();
  }
});

test("explicit original focus requests retain identity and retire after ordinary control edits", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const Container = Reflect.get(api, "Container");
  const Input = Reflect.get(api, "Input");
  const first = new Input({ prompt: "First" });
  const second = new Input({ prompt: "Second" });
  const root = new Container();
  root.addChild(first);
  root.addChild(second);
  let tui!: DesktopTui;
  try {
    await setup.host.desktopUI.mount(
      (value: DesktopTui) => {
        tui = value;
        tui.setFocus(second);
        return root;
      },
      "header",
      "focus-probe",
    );
    const surface = () =>
      setup.host.desktopUI.surfaces.find((item) => item.id === "focus-probe")!;
    const inputs = nodes(surface().view).filter(
      (node) => node.kind === "input",
    );
    const [firstInput, secondInput] = inputs;
    assert.ok(firstInput?.kind === "input" && secondInput?.kind === "input");
    assert.equal(surface().focusRequest?.action, secondInput.action);
    const initial = surface().focusRequest;
    tui.setFocus(second);
    assert.deepEqual(surface().focusRequest, initial);
    await act(setup.host, surface(), firstInput.action, "ordinary input");
    assert.equal(surface().focusRequest, undefined);
    tui.setFocus(second);
    assert.ok(surface().focusRequest!.revision > initial!.revision);
    tui.setFocus(null);
    assert.equal(surface().focusRequest?.action, null);
    setup.host.desktopUI.close("focus-probe");
    tui.setFocus(first);
    assert.equal(surface(), undefined);
  } finally {
    await setup.close();
  }
});

test("factory TUI invalidation reaches original root caches, native overlays and registered children", async () => {
  const setup = await fixture();
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text");
  const Container = Reflect.get(api, "Container");
  const calls: string[] = [];
  let value = "initial";
  const label = new Text(value);
  const originalInvalidate = label.invalidate.bind(label);
  label.invalidate = () => {
    calls.push("label");
    label.setText(value);
    originalInvalidate();
  };
  const root = new Container();
  root.addChild(label);
  const overlay = new Text("Overlay");
  overlay.invalidate = () => calls.push("overlay");
  const registered = new Text("Registered");
  registered.invalidate = () => calls.push("registered");
  let tui!: DesktopTui;
  try {
    await setup.host.desktopUI.mount(
      (original: DesktopTui) => {
        tui = original;
        return root;
      },
      "header",
      "invalidate-root",
    );
    const handle = tui.showOverlay(overlay);
    tui.addChild(registered);
    calls.length = 0;
    value = "updated through original invalidate";
    tui.invalidate();
    tui.renderNow();
    assert.deepEqual(calls, ["label", "registered", "overlay"]);
    assert.ok(JSON.stringify(setup.host.desktopUI.surfaces).includes(value));
    tui.addChild(root);
    calls.length = 0;
    tui.invalidate();
    assert.deepEqual(calls, ["label", "registered", "label", "overlay"]);
    handle.hide();
    setup.host.desktopUI.close("invalidate-root");
    calls.length = 0;
    tui.invalidate();
    assert.deepEqual(calls, ["registered", "label"]);
  } finally {
    await setup.close();
  }
});

test("an async Pi factory can await input from its direct overlay before returning a root", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Input = Reflect.get(api, "Input");
  const child = new Input({ prompt: "Pending factory input" });
  const parent = new Input({ prompt: "Resolved factory input" });
  let submitted = "";
  try {
    const mounted = registry.mount(
      async (tui: DesktopTui) => {
        await new Promise<void>((resolve) => {
          const handle = tui.showOverlay(child, { width: 40 });
          child.onSubmit = (text: string) => {
            submitted = text;
            handle.hide();
            resolve();
          };
        });
        return parent;
      },
      "dialog",
      "pending-overlay-parent",
    );
    await until(() => registry.surfaces.some((surface) => surface.overlay));
    const surface = registry.surfaces.find((item) => item.overlay)!;
    await registry.key(surface.id, { key: "x" });
    assert.equal(
      field(
        registry.surfaces.find((item) => item.id === surface.id)!,
        "input",
      ).kind,
      "input",
    );
    assert.equal(child.getValue(), "x");
    await registry.key(surface.id, { key: "Enter" });
    await mounted;
    assert.equal(submitted, "x");
    assert.equal(registry.surfaces.length, 1);
    assert.equal(registry.surfaces[0].id, "pending-overlay-parent");
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("tool renderer updates retain previous components, invalidate state and release only retired instances", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  const api = await loadTuiApi();
  const Text = Reflect.get(api, "Text"),
    Container = Reflect.get(api, "Container");
  const shared = new Text("shared"),
    retired = new Text("retired");
  let sharedDisposals = 0,
    retiredDisposals = 0,
    rootDisposals = 0;
  shared.dispose = () => sharedDisposals++;
  retired.dispose = () => retiredDisposals++;
  let previous: unknown,
    invalidate: () => void = () => {};
  const state = { label: "first" };
  const renderer = (
    value: { step: number },
    _options: unknown,
    _theme: unknown,
    context: {
      lastComponent: unknown;
      invalidate(): void;
      state: typeof state;
    },
  ) => {
    assert.equal(context.lastComponent, previous);
    invalidate = context.invalidate;
    shared.setText(context.state.label);
    if (value.step === 2) return previous;
    const root = new Container();
    root.addChild(shared);
    if (value.step === 1) root.addChild(retired);
    root.dispose = () => {
      rootDisposals++;
      root.children.forEach((child: { dispose?: () => void }) =>
        child.dispose?.(),
      );
    };
    previous = root;
    return root;
  };
  const source = (step: number): DesktopRenderSource => ({
    kind: "toolResult",
    renderer,
    value: { step },
    context: {
      expanded: false,
      isStreaming: false,
      isPartial: false,
      isError: false,
      argsComplete: true,
      executionStarted: true,
      cwd: setup.cwd,
      state,
    },
  });
  const reconcile = (step: number) =>
    registry.reconcile([
      {
        id: "test-renderer",
        source: source(step),
        slot: "tool",
        target: { toolCallId: "test-tool" },
      },
    ]);
  try {
    reconcile(1);
    await until(() => registry.surfaces.length === 1);
    state.label = "second";
    reconcile(2);
    await until(() => JSON.stringify(registry.surfaces).includes("second"));
    assert.equal(rootDisposals, 0);
    state.label = "third";
    reconcile(3);
    await until(() => JSON.stringify(registry.surfaces).includes("third"));
    assert.equal(rootDisposals, 1);
    assert.equal(retiredDisposals, 1);
    assert.equal(sharedDisposals, 0);
    state.label = "invalidated";
    invalidate();
    assert.ok(JSON.stringify(registry.surfaces).includes("invalidated"));
    assert.equal(sharedDisposals, 0);
    registry.close("test-renderer");
    assert.equal(sharedDisposals, 1);
    assert.equal(retiredDisposals, 1);
    assert.equal(rootDisposals, 3);
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test("terminal transcript renderers retain their instances until the source changes", async () => {
  const setup = await fixture();
  const registry = new DesktopUIRegistry(
    () => setup.host.sdk,
    () => {},
  );
  registerComponentMappings(registry);
  let calls = 0;
  const renderer = () => {
    calls++;
    return { render: () => ["custom drawing"], invalidate() {} };
  };
  const reconcile = (value: string) =>
    registry.reconcile([
      {
        id: "unsupported",
        slot: "message",
        target: { messageId: "unsupported-message" },
        source: {
          kind: "message",
          renderer,
          value,
          context: {
            expanded: false,
            isStreaming: false,
            isPartial: false,
            isError: false,
            argsComplete: true,
            executionStarted: true,
            cwd: setup.cwd,
          },
        },
      },
    ]);
  try {
    for (let index = 0; index < 5; index++) {
      reconcile("first");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(calls, 1);
    reconcile("changed");
    await until(() => calls === 2);
    assert.equal(registry.surfaces.length, 1);
    assert.ok(
      nodes(registry.surfaces[0].view).some((node) => node.kind === "terminal"),
    );
  } finally {
    registry.clearSurfaces();
    await setup.close();
  }
});

test(
  "unchanged standard component factories map without an extension adapter and preserve callbacks and disposal",
  { timeout: 60000 },
  async () => {
    const setup = await fixture(),
      { host } = setup;
    try {
      await host.action({
        action: "prompt",
        args: { message: "/mapped-form" },
      });
      await until(() => !!dialog(host));
      let surface = dialog(host)!;
      const all = nodes(surface.view);
      assert.ok(all.some((node) => node.kind === "divider"));
      assert.ok(all.some((node) => node.kind === "image"));
      assert.ok(all.some((node) => node.kind === "markdown"));
      assert.ok(all.some((node) => node.kind === "spacer"));
      const stack = all.find((node) => node.kind === "row");
      assert.ok(stack && stack.kind === "row");
      assert.equal(stack.gap, 2);
      assert.equal(stack.sizes?.[0].grow, 1);
      assert.equal(host.snapshot().statuses["factory-keys"], "true");
      const input = field(surface, "input"),
        editor = field(surface, "textarea"),
        select = field(surface, "select");
      await act(host, surface, input.action, "Task A");
      await act(host, surface, `${input.action}:submit`);
      assert.ok(
        JSON.stringify(dialog(host)!.view).includes("Input submitted: Task A"),
      );
      await host.action({
        action: "desktop.input",
        args: {
          surfaceId: surface.id,
          instanceId: surface.instanceId,
          controlAction: editor.action,
          controlText: "",
          selection: { start: 0, end: 0 },
          data: "original callbacks",
        },
      });
      const changed = field(dialog(host)!, "textarea");
      assert.ok(changed.kind === "textarea");
      assert.equal(changed.value, "original callbacks");
      const scroll = field(dialog(host)!, "scroll");
      await act(host, surface, `${scroll.action}:layout`, {
        contentHeight: 50,
        viewportHeight: 10,
      });
      assert.equal(
        (
          field(dialog(host)!, "scroll") as Extract<
            DesktopNode,
            { kind: "scroll" }
          >
        ).scrollTop,
        40,
      );
      await act(host, surface, scroll.action, 5);
      assert.equal(
        (
          field(dialog(host)!, "scroll") as Extract<
            DesktopNode,
            { kind: "scroll" }
          >
        ).followEnd,
        false,
      );
      const region = field(dialog(host)!, "region");
      const event = {
        type: "wheel",
        button: "none",
        x: 3,
        y: 2,
        screenX: 10,
        screenY: 20,
        width: 20,
        height: 4,
        shift: true,
        alt: false,
        ctrl: false,
        wheelDelta: -3,
      };
      await act(host, surface, region.action, event);
      assert.deepEqual(JSON.parse(host.snapshot().statuses.pointer), {
        ...event,
        clickCount: 0,
      });
      await host.action({
        action: "desktop.viewport",
        args: { width: 48, height: 32 },
      });
      surface = dialog(host)!;
      const narrowStack = nodes(surface.view).find(
        (node) => node.kind === "row",
      );
      assert.ok(narrowStack && narrowStack.kind === "row");
      assert.equal(narrowStack.children.length, 1);
      await act(host, surface, select.action, "high");
      assert.equal(host.snapshot().statuses.selection, "high");
      await act(host, surface, `${select.action}:submit`);
      await until(() => !!host.snapshot().statuses["form-result"]);
      assert.deepEqual(JSON.parse(host.snapshot().statuses["form-result"]), {
        name: "Task A",
        notes: "original callbacks",
        priority: "high",
      });
      assert.equal(host.snapshot().statuses["root-disposed"], "1");
      assert.equal(host.snapshot().statuses["input-disposed"], "1");
      await act(host, surface, input.action, "obsolete");
      assert.equal(dialog(host), undefined);
    } finally {
      await setup.close();
    }
  },
);

test(
  "settings search, colon IDs, submenus, remapped keys and footer data retain original semantics",
  { timeout: 60000 },
  async () => {
    const setup = await fixture(),
      { host } = setup;
    try {
      await writeFile(
        join(setup.agentDir, "keybindings.json"),
        JSON.stringify({ "tui.select.confirm": "ctrl+j" }),
      );
      await host.action({ action: "resources.reload" });
      await host.action({
        action: "prompt",
        args: { message: "/mapped-settings" },
      });
      await until(() => !!dialog(host));
      const surface = dialog(host)!;
      const mode = field(surface, "select");
      await act(host, surface, mode.action, "expanded");
      assert.equal(
        host.snapshot().statuses["setting-result"],
        "mode:choice=expanded",
      );
      const search = field(dialog(host)!, "input");
      await act(host, surface, search.action, "Nested");
      assert.ok(
        !nodes(dialog(host)!.view).some((node) => node.kind === "select"),
      );
      const nested = nodes(dialog(host)!.view).find(
        (node) => node.kind === "button" && node.label === "Nested",
      );
      assert.ok(nested && nested.kind === "button");
      await act(host, surface, nested.action);
      const selection = field(dialog(host)!, "select");
      await act(host, surface, selection.action, "two");
      await act(host, surface, `${selection.action}:submit`);
      assert.equal(
        host.snapshot().statuses["setting-result"],
        "nested:choice=two",
      );
      assert.ok(
        JSON.stringify(
          host.desktopUI.surfaces.find((item) => item.slot === "footer")?.view,
        ).includes("nested:choice=two"),
      );
      const currentSearch = field(dialog(host)!, "input");
      await act(host, surface, currentSearch.action, "Unsupported");
      const unsupported = nodes(dialog(host)!.view).find(
        (node) => node.kind === "button" && node.label === "Unsupported",
      );
      assert.ok(unsupported && unsupported.kind === "button");
      await act(host, surface, unsupported.action);
      assert.ok(
        JSON.stringify(host.snapshot().desktopSurfaces).includes(
          "custom drawing",
        ),
      );
      await host.action({ action: "desktop.close", args: { id: surface.id } });
      await appendFile(
        join(setup.agentDir, "extensions", "renamed-user-extension.ts"),
        "\n// This extension can change without re-auditing its name or hash.\n",
      );
      await host.action({ action: "resources.reload" });
      await host.action({
        action: "prompt",
        args: { message: "/mapped-settings" },
      });
      await until(() => !!dialog(host));
      await host.action({ action: "abort" });
      await until(() => !host.snapshot().busy);
      await host.action({ action: "session.new" });
      assert.equal(dialog(host), undefined);
    } finally {
      await setup.close();
    }
  },
);

test(
  "mapped SDK CustomEditor runs subclass input, autocomplete, history and application handlers",
  { timeout: 60000 },
  async () => {
    const setup = await fixture(),
      { host } = setup;
    try {
      await host.action({
        action: "prompt",
        args: { message: "/mapped-editor" },
      });
      await until(() => {
        const surface = host.desktopUI.surfaces.find(
          (surface) => surface.slot === "editor",
        );
        return (
          !!surface &&
          host.session.extensionRunner.getUIContext().getEditorComponent() !==
            undefined &&
          nodes(surface.view).some((node) => node.kind === "textarea")
        );
      });
      const surface = host.desktopUI.surfaces.find(
        (surface) => surface.slot === "editor",
      )!;
      const editor = field(surface, "textarea");
      const input = (
        data: string,
        text: string,
        start = text.length,
        end = start,
      ) =>
        host.action({
          action: "desktop.input",
          args: {
            surfaceId: "editor",
            instanceId: surface.instanceId,
            controlAction: editor.action,
            controlText: text,
            editorText: text,
            selection: { start, end },
            data,
          },
        });
      await input("!", "");
      assert.equal(
        host.session.extensionRunner.getUIContext().getEditorText(),
        "mapped",
      );
      assert.equal(host.snapshot().statuses["editor-change"], "mapped");
      await input("\x1b[200~replacement\x1b[201~", "mapped", 1, 5);
      assert.equal(
        host.session.extensionRunner.getUIContext().getEditorText(),
        "mreplacementd",
      );
      await input("\x03", "mreplacementd");
      assert.equal(
        host.session.extensionRunner.getUIContext().getEditorText(),
        "",
      );
      host.session.extensionRunner.getUIContext().setEditorText("/mapped-s");
      await input("\t", "/mapped-s");
      await until(() =>
        nodes(
          host.desktopUI.surfaces.find((item) => item.id === "editor")!.view,
        ).some((node) => node.kind === "select"),
      );
      const completion = field(
        host.desktopUI.surfaces.find((item) => item.id === "editor")!,
        "select",
      );
      assert.ok(completion.kind === "select" && completion.submitAction);
      await act(host, surface, completion.submitAction);
      assert.ok(
        host.session.extensionRunner
          .getUIContext()
          .getEditorText()
          .startsWith("/mapped-settings"),
      );
      await host.action({
        action: "prompt",
        args: { message: "/mapped-message" },
      });
      await until(() =>
        host.desktopUI.surfaces.some(
          (surface) =>
            surface.slot === "message" &&
            JSON.stringify(surface.view).includes(
              "Original message: library renderer",
            ),
        ),
      );
    } finally {
      await setup.close();
    }
  },
);

test(
  "loaders abort on cancellation or replacement and render-only roots retain original callbacks through terminal fallback",
  { timeout: 60000 },
  async () => {
    const setup = await fixture(),
      { host } = setup;
    try {
      await host.action({
        action: "prompt",
        args: { message: "/mapped-bordered-loader" },
      });
      await until(() => !!dialog(host));
      const bordered = dialog(host)!;
      const borderedCancel = nodes(bordered.view).find(
        (node) => node.kind === "button",
      );
      assert.ok(borderedCancel && borderedCancel.kind === "button");
      await act(host, bordered, borderedCancel.action);
      assert.equal(host.snapshot().statuses["bordered-loader-aborted"], "true");
      await host.action({
        action: "prompt",
        args: { message: "/mapped-loader" },
      });
      await until(() => !!dialog(host));
      assert.ok(
        nodes(dialog(host)!.view).some((node) => node.kind === "progress"),
      );
      await host.action({
        action: "desktop.close",
        args: { id: dialog(host)!.id },
      });
      await host.action({
        action: "prompt",
        args: { message: "/mapped-cancel-loader" },
      });
      await until(() => !!dialog(host));
      const surface = dialog(host)!;
      const cancel = nodes(surface.view).find((node) => node.kind === "button");
      assert.ok(cancel && cancel.kind === "button");
      await act(host, surface, cancel.action);
      assert.equal(host.snapshot().statuses["loader-aborted"], "true");
      assert.equal(host.snapshot().statuses["loader-signal"], "aborted");
      await host.action({
        action: "prompt",
        args: { message: "/mapped-cancel-loader" },
      });
      await until(() => !!dialog(host));
      await host.action({ action: "abort" });
      await until(() => !host.snapshot().busy);
      await host.action({ action: "resources.reload" });
      assert.equal(dialog(host), undefined);
      const notices: string[] = [];
      host.on("event", (event) => {
        if (event.type === "notice") notices.push(event.message);
      });
      await host.action({
        action: "prompt",
        args: { message: "/mapped-unsupported" },
      });
      await until(() => !!dialog(host));
      const terminal = nodes(dialog(host)!.view).find(
        (node) => node.kind === "terminal",
      );
      assert.ok(terminal && terminal.kind === "terminal");
      assert.match(terminal.data, /custom character art/);
      await act(host, dialog(host)!, terminal.action, { data: "x" });
      assert.equal(host.snapshot().statuses["terminal-fallback"], "x");
      await act(host, dialog(host)!, terminal.action, { data: "\r" });
      await until(() => !dialog(host));
      await until(
        () => host.snapshot().statuses["terminal-fallback-result"] === "x",
      );
      assert.equal(host.snapshot().statuses["terminal-fallback-result"], "x");
      assert.deepEqual(notices, []);
    } finally {
      await setup.close();
    }
  },
);
