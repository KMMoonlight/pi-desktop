import {
  CustomEditor,
  BorderedLoader,
  DynamicBorder,
  getPackageDir,
} from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname, join } from "node:path";
import {
  Container,
  Box,
  HStack,
  VStack,
  ScrollView,
  MouseRegion,
  Input,
  Editor,
  SelectList,
  SettingsList,
  Text,
  Markdown,
  TruncatedText,
  Spacer,
  Image,
  Loader,
  CancellableLoader,
  matchesKey,
  isKeyRelease,
  isKeyRepeat,
  parseKey,
  CURSOR_MARKER,
  stripTerminalSequences,
  compositeTuiLine,
  visibleWidth,
} from "@earendil-works/pi-tui";

const identity = (text) => text;
const presentationSubscriptions = new AsyncLocalStorage();
const presentationDebugOwners = new WeakMap();
async function withListeners(ui, factory, options) {
  const subscriptions = [];
  try {
    return await ui.custom(
      (...args) =>
        presentationSubscriptions.run(subscriptions, () => factory(...args)),
      options,
    );
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe();
  }
}
function presentationInput(tui, listener) {
  const unsubscribe = tui.addInputListener(listener);
  presentationSubscriptions.getStore().push(unsubscribe);
  return unsubscribe;
}
function presentationDebug(tui, listener) {
  tui.onDebug = listener;
  presentationDebugOwners.set(tui, listener);
  presentationSubscriptions.getStore().push(() => {
    if (presentationDebugOwners.get(tui) === listener) {
      tui.onDebug = undefined;
      presentationDebugOwners.delete(tui);
    }
  });
}
const requireTui = createRequire(join(getPackageDir(), "package.json"));
const { extractAnsiCode } = requireTui(
  join(dirname(requireTui.resolve("@earendil-works/pi-tui")), "utils.js"),
);
const { allocateStackSizes } = requireTui(
  join(
    dirname(requireTui.resolve("@earendil-works/pi-tui")),
    "components",
    "stack.js",
  ),
);

function maskFrameText(line) {
  const replacement = stripTerminalSequences(line).replace(/secret/g, "hidden");
  let result = "",
    offset = 0;
  for (let index = 0; index < line.length;) {
    const ansi = extractAnsiCode(line, index);
    if (ansi) {
      result += ansi.code;
      index += ansi.length;
    } else {
      result += replacement[offset++];
      index++;
    }
  }
  return result;
}
const listTheme = {
  selectedPrefix: identity,
  selectedText: identity,
  description: identity,
  scrollInfo: identity,
  noMatch: identity,
};
const markdownTheme = Object.fromEntries(
  [
    "heading",
    "link",
    "linkUrl",
    "code",
    "codeBlock",
    "codeBlockBorder",
    "quote",
    "quoteBorder",
    "hr",
    "listBullet",
    "bold",
    "italic",
    "strikethrough",
    "underline",
  ].map((key) => [key, identity]),
);
const settingsTheme = {
  label: identity,
  value: identity,
  description: identity,
  cursor: "> ",
  hint: identity,
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";

export default function componentLibrary(pi) {
  let overlayLifecycleControl;
  pi.registerCommand("overlay-lifecycle-control", {
    handler: (operation) => overlayLifecycleControl?.(operation),
  });
  pi.registerCommand("overlay-lifecycle-probe", {
    handler: async (args, ctx) => {
      const mode = args || "native";
      const direct = mode.startsWith("direct");
      const state = { mode, settled: false, disposed: 0, value: "" };
      let handle;
      const publish = () =>
        ctx.ui.setStatus(
          "overlay-lifecycle-state",
          JSON.stringify({
            ...state,
            hidden: handle?.isHidden(),
            focused: handle?.isFocused(),
          }),
        );
      const value = await withListeners(
        ctx.ui,
        (tui, _theme, _keys, done) => {
          const input = new Input({ prompt: "Overlay lifecycle input" });
          input.onSubmit = (text) => {
            state.value = text;
            publish();
          };
          const overlay = mode.endsWith("xterm")
            ? Object.freeze({
                render: (width) => [
                  "Original overlay lifetime",
                  ...input.render(width),
                ],
                handleInput: (data) => input.handleInput(data),
                invalidate() {},
                dispose() {
                  state.disposed++;
                  publish();
                },
              })
            : input;
          if (overlay === input)
            input.dispose = () => {
              state.disposed++;
              publish();
            };
          overlayLifecycleControl = (operation) => {
            if (operation === "hide") handle.hide();
            else if (operation === "hide-stack") tui.hideOverlay();
            else if (operation === "temporary") {
              handle.setHidden(true);
              handle.focus();
            } else if (operation === "restore") handle.setHidden(false);
            else if (operation === "focus") handle.focus();
            else if (operation === "done") done(state.value);
            publish();
          };
          if (!direct) return overlay;
          handle = tui.showOverlay(overlay, { width: "75%" });
          const parent = new Input({ prompt: "Overlay lifecycle parent" });
          parent.onSubmit = () => done(state.value);
          publish();
          return parent;
        },
        {
          overlay: !direct,
          overlayOptions: { width: "75%" },
          onHandle: (value) => {
            handle = value;
            publish();
          },
        },
      );
      state.settled = true;
      state.result = value;
      publish();
      overlayLifecycleControl = undefined;
    },
  });
  pi.registerCommand("custom-close-order-probe", {
    handler: async (args, ctx) => {
      const mode = args || "native";
      const events = [];
      let stage = 0;
      let cleanup = Promise.resolve();
      const value = await withListeners(
        ctx.ui,
        (_tui, _theme, _keys, done) => {
          const input = new Input({ prompt: "Custom close ordering" });
          input.onSubmit = (value) => {
            done(value);
            events.push("done-return");
          };
          const component = mode.startsWith("xterm")
            ? {
                render: (width) => [
                  "Original custom close",
                  ...input.render(width),
                ],
                handleInput: (data) => input.handleInput(data),
                invalidate() {},
              }
            : input;
          component.dispose = () => {
            events.push("dispose");
            for (let index = 1; index <= 8; index++)
              cleanup = cleanup.then(() => {
                stage = index;
                events.push(`cleanup:${index}`);
              });
            return cleanup;
          };
          return mode.startsWith("xterm")
            ? Object.freeze(component)
            : component;
        },
        { overlay: mode.endsWith("overlay"), overlayOptions: { width: "75%" } },
      );
      events.push(`result:${stage}`);
      await cleanup;
      ctx.ui.setStatus(
        "custom-close-order-result",
        JSON.stringify({ mode, value, events }),
      );
    },
  });
  let sharedRemountProbe;
  pi.registerCommand("component-remount-clear", {
    handler: async (args, ctx) => {
      if (args === "header") ctx.ui.setHeader(undefined);
      else ctx.ui.setFooter(undefined);
      await Promise.all(sharedRemountProbe?.pendingDisposals ?? []);
      sharedRemountProbe?.publish();
    },
  });
  pi.registerCommand("component-remount-probe", {
    handler: async (args, ctx) => {
      const mode = args || "writable";
      const wrappedMode = mode.startsWith("wrapped");
      const asyncMode = mode.startsWith("wrapped-async");
      const wrapperEvents = [];
      const pendingDisposals = [];
      const input = new Input({ prompt: "Reusable lifecycle" });
      let mounts = 0,
        disposals = 0,
        reads = 0,
        receiverErrors = 0,
        currentTui,
        wrapped = false;
      const publish = () =>
        ctx.ui.setStatus(
          "component-remount-state",
          JSON.stringify({
            mode,
            mounts,
            disposals,
            reads,
            receiverErrors,
            wrapped,
            wrapperEvents,
            text: input.getValue(),
            restored: restored(),
          }),
        );
      const handleInput = input.handleInput.bind(input);
      input.handleInput = (data) => {
        handleInput(data);
        if (wrappedMode && !wrapped) {
          wrapped = true;
          for (
            let index = 0;
            index < (mode === "wrapped-chain" ? 3 : 1);
            index++
          ) {
            const previous = root.dispose;
            root.dispose = function () {
              if (this !== root) receiverErrors++;
              wrapperEvents.push(`before-${index}`);
              if (asyncMode) {
                const completion = (async () => {
                  await new Promise((resolve) => setTimeout(resolve, 0));
                  const result = await previous.call(this);
                  wrapperEvents.push(`after-${index}`);
                  publish();
                  return result;
                })();
                pendingDisposals.push(completion);
                return completion;
              }
              previous.call(this);
              wrapperEvents.push(`after-${index}`);
            };
          }
          if (mode.endsWith("-frozen")) Object.freeze(root);
          original = Object.getOwnPropertyDescriptor(root, "dispose");
        }
        publish();
      };
      let root = input;
      const dispose = function () {
        if (this !== root) receiverErrors++;
        if (wrappedMode) wrapperEvents.push("original");
        disposals++;
        publish();
      };
      if (mode === "frozen" || mode.endsWith("-frozen")) {
        root = {
          render: (width) => [
            "Reusable original terminal",
            ...input.render(width),
          ],
          invalidate() {},
          handleInput(data) {
            input.handleInput(data);
            currentTui.requestRender();
          },
          dispose,
        };
        if (mode === "frozen") Object.freeze(root);
      } else if (mode === "inherited") {
        const prototype = Object.create(Object.getPrototypeOf(input));
        Object.defineProperty(prototype, "dispose", { value: dispose });
        Object.setPrototypeOf(input, prototype);
      } else
        Object.defineProperty(
          input,
          "dispose",
          mode === "getter"
            ? {
                configurable: true,
                get: () => {
                  reads++;
                  return dispose;
                },
              }
            : {
                value: dispose,
                writable:
                  mode === "writable" || mode === "overlap" || wrappedMode,
                configurable: mode !== "locked",
              },
        );
      let original = Object.getOwnPropertyDescriptor(root, "dispose");
      const restored = () => {
        const current = Object.getOwnPropertyDescriptor(root, "dispose");
        return (
          (!original && !current) ||
          (!!original &&
            !!current &&
            [
              "value",
              "get",
              "set",
              "writable",
              "configurable",
              "enumerable",
            ].every((key) => original[key] === current[key]))
        );
      };
      if (mode.endsWith("overlap")) {
        input.setValue("shared");
        input.onSubmit = (value) => {
          ctx.ui.setStatus("component-remount-submitted", value);
          publish();
        };
        ctx.ui.setHeader(() => input);
        ctx.ui.setFooter(() => input);
        mounts = 2;
        sharedRemountProbe = { publish, pendingDisposals };
        publish();
        return;
      }
      const results = [];
      for (let index = 0; index < 3; index++) {
        input.setValue("");
        mounts = index + 1;
        const result = await withListeners(
          ctx.ui,
          (tui, _theme, _keys, done) => {
            currentTui = tui;
            input.onSubmit = done;
            tui.setFocus(root);
            publish();
            return root;
          },
        );
        results.push(result);
        if (result === undefined) break;
      }
      await Promise.all(pendingDisposals);
      ctx.ui.setStatus(
        "component-remount-result",
        JSON.stringify({
          results,
          disposals,
          reads,
          receiverErrors,
          wrapperEvents,
          restored: restored(),
        }),
      );
      publish();
    },
  });
  pi.registerCommand("component-disposal-probe", {
    handler: async (args, ctx) => {
      const mode = args.trim();
      const events = [];
      let field,
        root,
        reads = 0,
        opaque = false,
        text = "";
      const report = () =>
        ctx.ui.setStatus(
          "component-disposal-state",
          JSON.stringify({ events, reads, text: field?.getValue?.() ?? text }),
        );
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        if (mode === "frozen") {
          root = field = Object.freeze({
            render: () => ["Frozen original component", text + CURSOR_MARKER],
            invalidate() {},
            handleInput(data) {
              if (data === "\r") done(text);
              else text += data;
              report();
            },
            dispose() {
              events.push(this === root ? "root" : "wrong receiver");
              report();
            },
          });
        } else {
          field = new Input({ prompt: "Readonly lifecycle" });
          field.onSubmit = (value) => done(value);
          const original = field.handleInput.bind(field);
          field.handleInput = (data) => {
            original(data);
            report();
          };
          const cleanup = function () {
            events.push(this === field ? "child" : "wrong receiver");
            report();
          };
          if (mode === "inherited") {
            const prototype = Object.create(Object.getPrototypeOf(field));
            Object.defineProperty(prototype, "dispose", { value: cleanup });
            Object.setPrototypeOf(field, prototype);
          } else if (mode === "getter")
            Object.defineProperty(field, "dispose", {
              get: () => {
                reads++;
                return cleanup;
              },
              set: () => {
                throw new Error("Original disposal setter must not run");
              },
              configurable: true,
            });
          else
            Object.defineProperty(field, "dispose", {
              value: cleanup,
              writable: mode === "writable",
              configurable: mode === "configurable",
            });
          root = field;
          if (mode === "cached") {
            root = new Container();
            const parent = new Container();
            parent.addChild(field);
            Object.defineProperty(parent, "dispose", {
              value: () => {
                events.push("parent");
                report();
              },
            });
            root.addChild(parent);
            let stage = 0;
            presentationInput(tui, (data) => {
              if (!matchesKey(data, "f2")) return;
              root.clear();
              if (++stage === 1) root.addChild(new Text("Cached child hidden"));
              else {
                field.setValue("restored");
                root.addChild(field);
                tui.setFocus(field);
              }
              report();
              return { consume: true };
            });
          } else if (["children", "self", "none"].includes(mode)) {
            root = new Container();
            root.addChild(field);
            if (mode !== "none")
              Object.defineProperty(root, "dispose", {
                value: function () {
                  events.push(this === root ? "root" : "wrong receiver");
                  if (mode === "children") field.dispose();
                  report();
                },
              });
          } else if (mode === "transition") {
            root = {
              field,
              render: (width) => [
                "Readonly transition",
                ...field.render(opaque ? width - 4 : width),
              ],
              invalidate: () => field.invalidate(),
              dispose() {
                events.push("root");
                field.dispose();
                report();
              },
            };
            presentationInput(tui, (data) => {
              if (matchesKey(data, "f2")) {
                opaque = !opaque;
                return { consume: true };
              }
              if (matchesKey(data, "f3")) {
                field.setValue("SDK readonly update");
                report();
                return { consume: true };
              }
            });
          }
        }
        tui.setFocus(field);
        report();
        return root;
      });
      ctx.ui.setStatus(
        "component-disposal-result",
        JSON.stringify({ result, events, reads }),
      );
    },
  });
  pi.registerCommand("composite-focus-probe", {
    handler: async (args, ctx) => {
      const kind = args.trim(),
        calls = [];
      let field,
        disposed = 0;
      const report = () =>
        ctx.ui.setStatus(
          "composite-focus-state",
          JSON.stringify({
            calls,
            selected: field.selectedIndex,
            disposed,
          }),
        );
      await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        if (kind === "readonly")
          field = new SettingsList(
            [
              { id: "alpha", label: "Alpha", currentValue: "off" },
              { id: "beta", label: "Beta", currentValue: "off" },
            ],
            3,
            settingsTheme,
            () => {},
            () => {},
          );
        else {
          field = new Container();
          field.addChild(new Input({ prompt: "Composite peer" }));
        }
        const original = field.handleInput?.bind(field);
        field.handleInput = (data) => {
          calls.push(data);
          original?.(data);
          report();
        };
        field.dispose = () => disposed++;
        presentationInput(tui, (data) => {
          if (matchesKey(data, "f4")) {
            done();
            return { consume: true };
          }
        });
        tui.setFocus(field);
        report();
        return field;
      });
      ctx.ui.setStatus(
        "composite-focus-result",
        JSON.stringify({ calls, disposed }),
      );
    },
  });
  pi.registerCommand("terminal-transition-probe", {
    handler: async (args, ctx) => {
      const [kind = "Input", holder = "closure"] = args.trim().split(/\s+/);
      const editing = ["Input", "Editor", "CustomEditor"].includes(kind);
      const submitted = [],
        calls = [];
      let opaque = false,
        disposed = 0,
        field,
        screen,
        updates = 0;
      const report = () =>
        ctx.ui.setStatus(
          "terminal-transition-state",
          JSON.stringify({
            mode: opaque ? "opaque" : "desktop",
            disposed,
            submitted,
            calls,
            updates,
            value: field?.getText?.() ?? field?.getValue?.(),
            focused: screen?.getFocusedComponent() === field,
          }),
        );
      await withListeners(ctx.ui, (tui, _theme, keys, done) => {
        screen = tui;
        field =
          kind === "Input"
            ? new Input({ prompt: "Transition field" })
            : kind === "SelectList"
              ? new SelectList(
                  [
                    { value: "alpha", label: "Alpha" },
                    { value: "beta", label: "Beta" },
                  ],
                  3,
                  listTheme,
                )
              : kind === "SettingsList"
                ? new SettingsList(
                    [
                      {
                        id: "alpha",
                        label: "Alpha",
                        currentValue: "off",
                        values: ["off", "on"],
                      },
                      {
                        id: "beta",
                        label: "Beta",
                        currentValue: "off",
                        values: ["off", "on"],
                      },
                    ],
                    3,
                    settingsTheme,
                    (id, value) => submitted.push(`${id}:${value}`),
                    () => {},
                  )
                : kind === "CustomEditor"
                  ? new CustomEditor(
                      tui,
                      { borderColor: identity, selectList: listTheme },
                      keys,
                    )
                  : new Editor(tui, {
                      borderColor: identity,
                      selectList: listTheme,
                    });
        if (editing) {
          (field.setText ?? field.setValue).call(field, "one");
          field.handleInput("\x05");
          field.onSubmit = (value) => submitted.push(value);
        } else if (kind === "SelectList")
          field.onSelect = (item) => submitted.push(item.value);
        const original = field.handleInput.bind(field);
        field.handleInput = (data) => {
          calls.push(data);
          original(data);
          report();
        };
        field.dispose = () => {
          disposed++;
          report();
        };
        const hidden = new WeakMap();
        class Wrapper {
          field = field;
          #field = field;
          constructor() {
            hidden.set(this, field);
          }
          child() {
            return holder === "closure"
              ? field
              : holder === "weakmap"
                ? hidden.get(this)
                : this.#field;
          }
          render(width) {
            return [
              "Transition wrapper",
              ...this.child().render(opaque ? width - 4 : width),
            ];
          }
          invalidate() {
            this.child().invalidate();
          }
          dispose() {
            this.child().dispose();
          }
        }
        const wrapper = new Wrapper();
        presentationInput(tui, (data) => {
          if (matchesKey(data, "f2")) {
            opaque = !opaque;
            if (opaque) delete wrapper.field;
            else wrapper.field = field;
            report();
            return { consume: true };
          }
          if (matchesKey(data, "f3")) {
            updates++;
            if (editing)
              (field.setText ?? field.setValue).call(
                field,
                `SDK update ${updates}`,
              );
            else if (kind === "SelectList") field.setSelectedIndex(0);
            else {
              field.selectItem("alpha");
              field.updateValue("beta", "off");
            }
            report();
            return { consume: true };
          }
          if (matchesKey(data, "f4")) {
            done();
            return { consume: true };
          }
        });
        tui.setFocus(field);
        report();
        return wrapper;
      });
      ctx.ui.setStatus(
        "terminal-transition-result",
        JSON.stringify({ submitted, disposed }),
      );
    },
  });
  pi.registerCommand("terminal-descendant-probe", {
    handler: async (args, ctx) => {
      const [kind = "Input", mode = "multiple"] = args.trim().split(/\s+/);
      const editing = ["Input", "Editor", "CustomEditor"].includes(kind);
      const fields = [],
        submitted = [],
        calls = [],
        disposed = [0, 0];
      let active = 0,
        consumed = 0,
        screen;
      const values = () =>
        fields.map(
          (field) =>
            field.getText?.() ??
            field.getValue?.() ??
            field.getSelectedItem?.()?.value,
        );
      const report = () =>
        ctx.ui.setStatus(
          "terminal-descendant-state",
          JSON.stringify({
            active,
            consumed,
            calls,
            submitted,
            values: values(),
            focused: fields.indexOf(screen?.getFocusedComponent()),
          }),
        );
      await withListeners(ctx.ui, (tui, _theme, keys, done) => {
        screen = tui;
        for (let index = 0; index < 2; index++) {
          const field =
            kind === "Input"
              ? new Input({ prompt: `Field ${index}` })
              : kind === "SelectList"
                ? new SelectList(
                    [
                      { value: "alpha", label: `Alpha ${index}` },
                      { value: "beta", label: `Beta ${index}` },
                    ],
                    3,
                    listTheme,
                  )
                : kind === "SettingsList"
                  ? new SettingsList(
                      [
                        {
                          id: "alpha",
                          label: `Alpha ${index}`,
                          currentValue: "off",
                          values: ["off", "on"],
                        },
                        {
                          id: "beta",
                          label: `Beta ${index}`,
                          currentValue: "off",
                          values: ["off", "on"],
                        },
                      ],
                      3,
                      settingsTheme,
                      (id, selected) =>
                        submitted.push(`${index}:${id}:${selected}`),
                      () => {},
                    )
                  : kind === "CustomEditor"
                    ? new CustomEditor(
                        tui,
                        { borderColor: identity, selectList: listTheme },
                        keys,
                      )
                    : new Editor(tui, {
                        borderColor: identity,
                        selectList: listTheme,
                      });
          if (editing) {
            (field.setText ?? field.setValue).call(
              field,
              index ? "two" : "one",
            );
            field.handleInput("\x05");
            field.onSubmit = (value) => submitted.push(`${index}:${value}`);
          } else if (kind === "SelectList") {
            field.onSelect = (item) => submitted.push(`${index}:${item.value}`);
          }
          const original = field.handleInput.bind(field);
          field.handleInput = (data) => {
            calls.push(`${index}:${data}`);
            original(data);
            report();
          };
          field.dispose = () => disposed[index]++;
          if (mode === "locked")
            Object.defineProperty(field, "render", {
              value: field.render,
              configurable: false,
              writable: false,
            });
          fields.push(field);
        }
        presentationInput(tui, (data) => {
          if (matchesKey(data, "f2")) {
            active = 1;
            tui.setFocus(fields[1]);
            return { data: editing ? "b" : "\x1b[B" };
          }
          if (matchesKey(data, "f3")) {
            consumed++;
            report();
            return { consume: true };
          }
          if (matchesKey(data, "f4")) {
            done();
            return { consume: true };
          }
          if (matchesKey(data, "f5")) {
            tui.setFocus(null);
            report();
            return { data: "z" };
          }
          if (matchesKey(data, "f6")) {
            active = 0;
            tui.setFocus(fields[0]);
            return { data: editing ? "q" : "\r" };
          }
        });
        const wrap = (field) => ({
          field,
          render: (width) => ["Opaque region", ...field.render(width - 4)],
          invalidate: () => field.invalidate(),
        });
        tui.setFocus(fields[mode === "regions" ? 1 : 0]);
        report();
        if (mode === "regions") {
          const root = new Container();
          fields.forEach((field) => root.addChild(wrap(field)));
          return root;
        }
        return {
          ...(mode === "closure" ? {} : { fields }),
          ...(mode === "closure"
            ? {
                dispose() {
                  fields.forEach((field) => field.dispose());
                },
              }
            : {}),
          ...(mode === "owner"
            ? {
                handleInput(data) {
                  calls.push(`owner:${data}`);
                  fields[active].handleInput(data);
                },
              }
            : {}),
          render(width) {
            return [
              "Opaque heading",
              ...(mode === "multiple" || mode === "owner"
                ? fields.flatMap((field) => field.render(width))
                : fields[active].render(mode === "width" ? width - 4 : width)),
            ];
          },
          invalidate() {
            fields.forEach((field) => field.invalidate());
          },
        };
      });
      ctx.ui.setStatus(
        "terminal-descendant-result",
        JSON.stringify({ disposed, submitted }),
      );
    },
  });
  pi.registerCommand("gap-frame-probe", {
    handler: async (args, ctx) => {
      const [
        align = "start",
        nesting = "plain",
        sizing = "fixed",
        framing = "plain",
        transform = "none",
        height = "stable",
      ] = args.trim().split(/\s+/);
      const modes = ["text", "background", "normal"];
      let mode = 0,
        clicks = 0,
        lastColumn;
      const submitted = [],
        disposed = {};
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        let left, right;
        const report = () =>
          ctx.ui.setStatus(
            "gap-frame-state",
            JSON.stringify({
              mode: modes[mode],
              clicks,
              lastColumn,
              submitted,
              left: left.getValue(),
              right: right.getValue(),
            }),
          );
        class Field extends Input {
          handleInput(data) {
            if (matchesKey(data, "f2")) {
              mode = (mode + 1) % modes.length;
              tui.requestRender();
            } else if (matchesKey(data, "f3")) {
              left.setValue("SDK");
              right.setValue("Peer");
              tui.requestRender();
            } else if (matchesKey(data, "f4")) {
              done({
                submitted,
                clicks,
                get disposed() {
                  return disposed;
                },
              });
            } else super.handleInput(data);
            report();
          }
        }
        class GapStack extends HStack {
          render(columns) {
            let lines = super.render(columns);
            if (modes[mode] === "normal") return lines;
            const widths = allocateStackSizes(
              this.entries,
              this.entries.map(({ component }) =>
                component
                  .render(columns)
                  .reduce((max, line) => Math.max(max, visibleWidth(line)), 0),
              ),
              columns,
              this.gap,
            );
            if (transform !== "none")
              lines = lines.map((line, row) =>
                compositeTuiLine(
                  line,
                  `\x1b[38;2;163;52;93mHidden ${row}\x1b[0m`,
                  0,
                  widths[0],
                  columns,
                ),
              );
            if (transform === "both")
              lines = lines.map((line, row) =>
                compositeTuiLine(
                  line,
                  `\x1b[38;2;73;85;191mMasked ${row}\x1b[0m`,
                  widths[0] + widths[1] + this.gap * 2,
                  widths[2],
                  columns,
                ),
              );
            let x = 0;
            const regions = [];
            for (let index = 0; index < widths.length; index++) {
              x += widths[index];
              if (index < widths.length - 1) {
                regions.push({
                  x,
                  columns: this.gap,
                  labels: index === 0 ? ["A\u754c", "B", "C"] : ["X", "Y", "Z"],
                });
                x += this.gap;
              }
            }
            if (x < columns)
              regions.push({
                x,
                columns: columns - x,
                labels: ["END", "END", "END"],
              });
            for (const region of regions)
              lines = lines.map((line, row) =>
                compositeTuiLine(
                  line,
                  modes[mode] === "background"
                    ? `\x1b[48;2;201;225;239m${" ".repeat(region.columns)}\x1b[0m`
                    : `\x1b]8;;https://example.com/gap\x1b\\\x1b[38;2;11;122;99m${region.labels[row] ?? ""}\x1b[0m\x1b]8;;\x1b\\`,
                  region.x,
                  region.columns,
                  columns,
                ),
              );
            const middle = Math.floor(lines.length / 2);
            if (height === "insert")
              lines.splice(middle, 0, " ".repeat(columns));
            else if (height === "cut") lines.splice(middle, 1);
            return framing === "framed"
              ? [
                  "\x1b[38;2;73;85;191mFrame title\x1b[0m",
                  "Top note",
                  ...lines,
                  "Frame ending",
                ]
              : lines;
          }
          handleMouse(event) {
            if (event.type === "press") {
              clicks++;
              lastColumn = event.x;
              tui.setFocus(left);
            }
            const result = super.handleMouse(event);
            report();
            return result;
          }
        }
        class Outer extends Box {
          render(columns) {
            return super
              .render(columns)
              .map((line) =>
                line
                  .replace("A", "D")
                  .replace("Frame title", "Frame caption")
                  .replace("Frame ending", "Frame footer"),
              );
          }
        }
        left = new Field({ prompt: "Gap left" });
        right = new Field({ prompt: "Gap right" });
        left.setValue("one");
        right.setValue("two");
        left.onSubmit = (value) => {
          submitted.push(value);
          report();
        };
        const middle = new Text(
          height === "stable" ? "p\nq\nr" : "p\nq\nr\ns\nt\nu\nv\nw",
          0,
          0,
        );
        const stack = new GapStack([], { gap: 4, align });
        const size = sizing === "fill" ? { basis: 0, grow: 1 } : { basis: 12 };
        stack.addChild(left, size);
        stack.addChild(middle, { basis: 3 });
        stack.addChild(right, size);
        let root = stack;
        const components = { left, middle, right, stack };
        if (nesting === "nested") {
          root = new Outer(1, 1);
          root.addChild(stack);
          components.outer = root;
        }
        for (const [name, component] of Object.entries(components)) {
          disposed[name] = 0;
          component.dispose = () => disposed[name]++;
        }
        tui.setFocus(left);
        report();
        return root;
      });
      ctx.ui.setStatus("gap-frame-result", JSON.stringify(result));
    },
  });
  pi.registerCommand("nested-frame-probe", {
    handler: async (args, ctx) => {
      const [parentKind, kind, path = ""] = args.trim().split(/\s+/);
      const innerKinds = path.split(",").filter(Boolean);
      const ParentBase = { Container, Box, VStack, HStack, ScrollView }[
        parentKind
      ];
      const Base = { Input, Editor, CustomEditor, SelectList, SettingsList }[
        kind
      ];
      if (!ParentBase || !Base) throw new Error("Unknown nested frame probe");
      const modes = ["mask", "cut", "insert", "normal"];
      let mode = 0,
        clicks = 0;
      const submitted = [],
        changes = [],
        disposed = {};
      const result = await withListeners(ctx.ui, (tui, theme, keys, done) => {
        let field;
        const value = () => field.getText?.() ?? field.getValue?.();
        const report = () =>
          ctx.ui.setStatus(
            "nested-frame-state",
            JSON.stringify({
              mode: modes[mode],
              value: value(),
              submitted,
              changes,
              clicks,
              filter: field.searchInput?.getValue(),
              selected: field.getSelectedItem?.()?.value,
            }),
          );
        class Parent extends ParentBase {
          render(width) {
            const body = super.render(width);
            if (modes[mode] === "normal") return body;
            const masked = body.map(maskFrameText);
            if (modes[mode] === "cut")
              return masked.filter(
                (line) => !stripTerminalSequences(line).includes("tail suffix"),
              );
            if (modes[mode] === "insert" && kind !== "Input") {
              const row = masked.findIndex((line) => line.includes("hidden"));
              if (row >= 0)
                masked.splice(
                  row + 1,
                  0,
                  "\x1b[38;2;11;122;99mInserted child line\x1b[0m",
                );
            }
            return masked;
          }
          handleMouse(event) {
            if (event.type === "press") clicks++;
            const result = super.handleMouse(event);
            report();
            return result;
          }
        }
        class Field extends Base {
          handleInput(data) {
            if (matchesKey(data, "f2")) {
              mode = (mode + 1) % modes.length;
              tui.setFocus(this);
              tui.requestRender();
            } else if (matchesKey(data, "f3")) {
              if (kind === "SelectList") this.setSelectedIndex(1);
              else if (kind === "SettingsList") {
                this.searchInput.setValue("");
                super.handleInput("");
                this.updateValue("beta", "off");
                this.selectItem("beta");
              } else (this.setText ?? this.setValue).call(this, "SDK secret");
              tui.requestRender();
            } else if (matchesKey(data, "f4")) {
              done({
                submitted,
                changes,
                value: value(),
                mode: modes[mode],
                clicks,
                get disposed() {
                  return disposed;
                },
              });
            } else if (
              parentKind === "ScrollView" &&
              (matchesKey(data, "f5") || matchesKey(data, "f6"))
            ) {
              if (matchesKey(data, "f5")) parent.scrollToEnd();
              else parent.scrollToStart();
              tui.requestRender();
            } else super.handleInput(data);
            report();
          }
        }
        if (kind === "SelectList") {
          field = new Field(
            [
              { value: "alpha", label: "Alpha secret" },
              { value: "beta", label: "Beta tail suffix" },
            ],
            5,
            listTheme,
          );
          field.onSelect = (item) => {
            submitted.push(item.value);
            report();
          };
        } else if (kind === "SettingsList") {
          field = new Field(
            [
              {
                id: "alpha",
                label: "Alpha secret",
                currentValue: "off",
                values: ["off", "on"],
              },
              {
                id: "beta",
                label: "Beta tail suffix",
                currentValue: "off",
                values: ["off", "on"],
              },
            ],
            5,
            settingsTheme,
            (id, value) => {
              changes.push(`${id}:${value}`);
              report();
            },
            () => {},
            { enableSearch: true },
          );
        } else {
          field =
            kind === "Input"
              ? new Field({ prompt: "Nested field" })
              : new Field(
                  tui,
                  {
                    borderColor: theme.fg.bind(theme, "border"),
                    selectList: listTheme,
                  },
                  ...(kind === "CustomEditor" ? [keys] : []),
                );
          (field.setText ?? field.setValue).call(
            field,
            kind === "Input"
              ? "original-secret"
              : "original-secret\ntail suffix",
          );
          field.onSubmit = (text) => submitted.push(text);
        }
        let parent;
        const sibling = new Input({ prompt: "Other field" });
        sibling.setValue("Sibling value");
        const components = {
          field,
          sibling,
          ...(field.searchInput ? { search: field.searchInput } : {}),
        };
        let child = field;
        for (const [index, name] of [...innerKinds].reverse().entries()) {
          const plain = name.startsWith("plain:");
          const innerKind = plain ? name.slice(6) : name;
          const InnerBase = { Container, Box, VStack }[innerKind];
          if (!InnerBase) throw new Error("Unknown inner container");
          class Inner extends InnerBase {
            render(width) {
              return [
                `Nested ${innerKind} heading`,
                ...super.render(width),
                `Nested ${innerKind} ending`,
              ];
            }
          }
          const Constructor = plain ? InnerBase : Inner;
          const inner =
            innerKind === "Box" ? new Constructor(1, 1) : new Constructor();
          const innerSibling = new Input({
            prompt: `Nested ${innerKind} sibling`,
          });
          innerSibling.setValue("Nested sibling value");
          inner.addChild(child);
          inner.addChild(innerSibling);
          components[`inner${index}`] = inner;
          components[`innerSibling${index}`] = innerSibling;
          child = inner;
        }
        if (parentKind === "ScrollView") {
          const content = new Container();
          content.addChild(child);
          content.addChild(sibling);
          parent = new Parent(content, { scrollbar: "always" });
          components.content = content;
        } else {
          parent =
            parentKind === "Box"
              ? new Parent(1, 1)
              : parentKind === "HStack"
                ? new Parent([], { gap: 2 })
                : new Parent();
          parent.addChild(
            child,
            ...(parentKind === "HStack" ? [{ basis: 0, grow: 3 }] : []),
          );
          parent.addChild(
            sibling,
            ...(parentKind === "HStack" ? [{ basis: 0, grow: 1 }] : []),
          );
        }
        components.parent = parent;
        for (const [name, component] of Object.entries(components)) {
          disposed[name] = 0;
          component.dispose = () => disposed[name]++;
        }
        tui.setFocus(field);
        report();
        return parent;
      });
      ctx.ui.setStatus("nested-frame-result", JSON.stringify(result));
    },
  });
  pi.registerCommand("list-render-probe", {
    handler: async (args, ctx) => {
      const [kind, variant] = args.trim().split(/\s+/);
      const Base = { SelectList, SettingsList }[kind];
      if (!Base) throw new Error("Unknown list probe");
      const helper = variant === "helper";
      const modes = ["replace", "partial", "normal"];
      let mode = 0,
        confirmed = [],
        changes = [],
        cancelled = 0,
        handled = 0;
      const disposed = { root: 0, search: 0, menu: 0 };
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const report = (original) =>
          ctx.ui.setStatus(
            "list-render-state",
            JSON.stringify({
              mode: modes[mode],
              confirmed,
              changes,
              handled,
              filter: original.searchInput?.getValue(),
              selected: original.getSelectedItem?.()?.value,
              activeMenu: !!original.submenuComponent,
              values:
                kind === "SettingsList"
                  ? Object.fromEntries(
                      original.items.map((item) => [
                        item.id,
                        item.currentValue,
                      ]),
                    )
                  : undefined,
            }),
          );
        const transform = (body) =>
          modes[mode] === "normal"
            ? body
            : modes[mode] === "partial"
              ? body.map((line) => line.replace(/Original/g, "Displayed"))
              : ["\x1b[38;2;11;122;99mList frame\x1b[0m", "Visible selection"];
        class Reframed extends Base {
          handleInput(data) {
            handled++;
            if (matchesKey(data, "f2")) {
              mode = (mode + 1) % modes.length;
              tui.requestRender();
            } else if (matchesKey(data, "f3")) {
              if (kind === "SelectList") this.setFilter("beta");
              else {
                this.searchInput.setValue("");
                this.applyFilter("");
                this.updateValue("beta", "off");
                this.selectItem("beta");
              }
              tui.requestRender();
            } else super.handleInput(data);
            report(this);
          }
          dispose() {
            disposed.root++;
          }
        }
        if (helper) {
          const method =
            kind === "SelectList" ? "renderItem" : "renderMainList";
          Reframed.prototype[method] = function (...args) {
            const body = Base.prototype[method].apply(this, args);
            return kind === "SelectList"
              ? transform([body]).join("\n")
              : transform(body);
          };
        } else
          Reframed.prototype.render = function (width) {
            return transform(Base.prototype.render.call(this, width));
          };
        const close = () => {
          cancelled++;
          done({
            confirmed,
            changes,
            cancelled,
            handled,
            get disposed() {
              return disposed;
            },
          });
        };
        const items =
          kind === "SelectList"
            ? [
                { value: "alpha", label: "Original alpha" },
                { value: "beta", label: "Original beta" },
              ]
            : [
                {
                  id: "alpha",
                  label: "Original alpha",
                  currentValue: "off",
                  values: ["off", "on"],
                },
                {
                  id: "beta",
                  label: "Original beta",
                  currentValue: "off",
                  values: ["off", "on"],
                },
                {
                  id: "menu",
                  label: "Original menu",
                  currentValue: "one",
                  submenu: (value, complete) => {
                    const menu = new SelectList(
                      [
                        { value: "one", label: "Original one" },
                        { value: "two", label: "Original two" },
                      ],
                      5,
                      listTheme,
                    );
                    menu.setSelectedIndex(value === "two" ? 1 : 0);
                    menu.onSelect = (item) => {
                      complete(item.value);
                      report(original);
                    };
                    menu.onCancel = () => {
                      complete(undefined);
                      report(original);
                    };
                    menu.dispose = () => {
                      disposed.menu++;
                    };
                    return menu;
                  },
                },
              ];
        const original =
          kind === "SelectList"
            ? new Reframed(items, 5, listTheme)
            : new Reframed(
                items,
                5,
                settingsTheme,
                (id, value) => {
                  changes.push(`${id}:${value}`);
                  report(original);
                },
                close,
                { enableSearch: true },
              );
        if (kind === "SelectList") {
          original.onSelect = (item) => {
            confirmed.push(item.value);
            report(original);
          };
          original.onSelectionChange = () => report(original);
          original.onCancel = close;
        } else
          original.searchInput.dispose = () => {
            disposed.search++;
          };
        report(original);
        tui.setFocus(original);
        return original;
      });
      ctx.ui.setStatus("list-render-result", JSON.stringify(result));
    },
  });
  pi.registerCommand("interactive-render-probe", {
    handler: async (args, ctx) => {
      const kind = args.trim();
      const Base = { Input, Editor, CustomEditor }[kind];
      if (!Base) throw new Error("Unknown interactive probe");
      const modes = ["mask", "partial", "normal"];
      let mode = 0,
        submitted = 0,
        clicks = 0,
        disposed = 0,
        edited = "";
      const result = await withListeners(ctx.ui, (tui, theme, keys, done) => {
        class Reframed extends Base {
          render(width) {
            const body = super.render(width);
            if (modes[mode] === "normal") return body;
            if (modes[mode] === "partial")
              return body.map((line) => line.replace(/secret/g, "hidden"));
            const value = this.getText?.() ?? this.getValue();
            return [
              "\x1b[38;2;11;122;99mMasked field\x1b[0m",
              `${CURSOR_MARKER}${"*".repeat(Array.from(value).length)}`,
            ];
          }
          handleInput(data) {
            if (matchesKey(data, "f2")) {
              mode = (mode + 1) % modes.length;
              ctx.ui.setStatus("interactive-render-mode", modes[mode]);
              tui.setFocus(this);
              tui.requestRender();
              return;
            }
            if (matchesKey(data, "f3")) {
              (this.setText ?? this.setValue).call(this, "SDK secret");
              tui.requestRender();
              return;
            }
            if (matchesKey(data, "f4")) {
              done({
                text: this.getText?.() ?? this.getValue(),
                submitted,
                edited,
                clicks,
                get disposed() {
                  return disposed;
                },
              });
              return;
            }
            super.handleInput(data);
          }
          handleMouse(event) {
            if (event.type === "press") {
              ctx.ui.setStatus("interactive-render-clicks", String(++clicks));
              return { handled: true, focus: true };
            }
          }
          dispose() {
            disposed++;
          }
        }
        const original =
          kind === "Input"
            ? new Reframed({ prompt: "Private field" })
            : new Reframed(
                tui,
                {
                  borderColor: (text) => text,
                  selectList: { ...listTheme, matchHighlight: identity },
                },
                ...(kind === "CustomEditor" ? [keys] : []),
              );
        (original.setText ?? original.setValue).call(
          original,
          "original-secret",
        );
        original.onSubmit = (value) => {
          submitted++;
          edited = value;
          ctx.ui.setStatus("interactive-render-submit", value);
        };
        tui.setFocus(original);
        return original;
      });
      ctx.ui.setStatus("interactive-render-result", JSON.stringify(result));
    },
  });
  pi.registerCommand("container-render-probe", {
    handler: async (args, ctx) => {
      const kind = args.trim();
      const Base = { Container, Box, VStack }[kind];
      if (!Base) throw new Error("Unknown container probe");
      const modes = [
        "normal",
        "insert",
        "omit",
        "partial",
        "reorder",
        "replace",
      ];
      let index = 0,
        submitted = 0,
        edited = "",
        clicks = 0;
      const disposed = {};
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        class Reframed extends Base {
          render(width) {
            const body = super.render(width);
            const offset = kind === "Box" ? 1 : 0;
            const content = body.slice(offset, offset + 5);
            switch (modes[index]) {
              case "insert":
                return [
                  ...body.slice(0, offset + 3),
                  "\x1b[38;2;11;122;99mInserted middle\x1b[0m",
                  ...body.slice(offset + 3),
                ];
              case "omit":
                return body.filter((_line, row) => row !== offset + 4);
              case "partial":
                return body.filter((_line, row) => row !== offset + 1);
              case "reorder":
                return [content[4], "Moved divider", content[3]];
              case "replace":
                return [
                  "\x1b[38;2;11;122;99mReplacement",
                  "",
                  "Continued\x1b[0m",
                  "",
                ];
              default:
                return body;
            }
          }
          handleMouse(event) {
            if (event.type === "press")
              ctx.ui.setStatus("container-render-clicks", String(++clicks));
            return super.handleMouse(event);
          }
        }
        const root = new Container();
        const container = kind === "Box" ? new Reframed(1, 1) : new Reframed();
        const label = new Text(
          "Original first\nOriginal removed\nOriginal last",
          0,
          0,
        );
        const retained = new Input({ prompt: "Retained field" });
        const omitted = new Input({ prompt: "Omitted field" });
        retained.setValue("Original value");
        omitted.setValue("Other value");
        retained.onSubmit = (value) => {
          submitted++;
          edited = value;
          ctx.ui.setStatus("container-render-submit", value);
        };
        class Controller extends Input {
          handleInput(data) {
            if (matchesKey(data, "f2")) {
              index = (index + 1) % modes.length;
              ctx.ui.setStatus("container-render-mode", modes[index]);
              tui.requestRender();
              return;
            }
            if (matchesKey(data, "f3")) {
              retained.setValue("SDK hidden value");
              omitted.setValue("SDK other value");
              tui.requestRender();
              return;
            }
            super.handleInput(data);
          }
        }
        const controller = new Controller({ prompt: "Controller field" });
        controller.onSubmit = (value) =>
          done({
            value,
            edited,
            submitted,
            mode: modes[index],
            clicks,
            get disposed() {
              return disposed;
            },
          });
        for (const [name, component] of Object.entries({
          root,
          container,
          label,
          retained,
          omitted,
          controller,
        })) {
          disposed[name] = 0;
          component.dispose = () => {
            disposed[name]++;
          };
        }
        for (const child of [label, retained, omitted])
          container.addChild(child);
        root.addChild(container);
        root.addChild(controller);
        tui.setFocus(retained);
        return root;
      });
      ctx.ui.setStatus("container-render-result", JSON.stringify(result));
    },
  });
  pi.registerCommand("render-baseline-probe", {
    handler: async (args, ctx) => {
      const disposed = {
        root: 0,
        box: 0,
        markdown: 0,
        editor: 0,
        controller: 0,
      };
      let mode = 0,
        edited = "",
        submitted = 0;
      const result = await withListeners(ctx.ui, (tui, _theme, keys, done) => {
        class HelperEditor extends CustomEditor {
          renderTopBorder() {
            return `\x1b[38;2;11;122;99m${mode ? "Updated" : "Inherited"} editor label\x1b[0m`;
          }
          renderBottomBorder() {
            return "Original helper footer";
          }
        }
        class CachedMarkdown extends Markdown {
          render(width) {
            const lines = super.render(width);
            const annotation = `Markdown cache note ${mode}`;
            if (!lines.includes(annotation)) lines.push(annotation);
            return lines;
          }
        }
        class CachedBox extends Box {
          render(width) {
            const lines = super.render(width);
            const annotation = `Box cache note ${mode}`;
            if (!lines.includes(annotation)) lines.push(annotation);
            return lines;
          }
        }
        const root = new Container();
        const box = new CachedBox(0, 0);
        const markdown = new CachedMarkdown(
          "**Original markdown**",
          0,
          0,
          markdownTheme,
        );
        box.addChild(markdown);
        const editor = new (
          args.trim() === "own" ? CustomEditor : HelperEditor
        )(tui, { borderColor: identity, selectList: listTheme }, keys);
        if (args.trim() === "own") {
          editor.renderTopBorder = HelperEditor.prototype.renderTopBorder;
          editor.renderBottomBorder = HelperEditor.prototype.renderBottomBorder;
        }
        editor.setText("Original editor value");
        editor.onSubmit = (text) => {
          edited = text;
          submitted++;
          ctx.ui.setStatus("render-baseline-submit", text);
        };
        class Controller extends Input {
          handleInput(data) {
            if (matchesKey(data, "f2")) {
              mode = 1 - mode;
              markdown.invalidate();
              box.invalidateCache();
              tui.requestRender();
              return;
            }
            super.handleInput(data);
          }
        }
        const controller = new Controller({ prompt: "Controller field" });
        controller.onSubmit = (value) =>
          done({
            value,
            edited,
            submitted,
            mode,
            inherited: editor.render === CustomEditor.prototype.render,
            get disposed() {
              return disposed;
            },
          });
        for (const [name, component] of Object.entries({
          root,
          box,
          markdown,
          editor,
          controller,
        }))
          component.dispose = () => {
            disposed[name]++;
          };
        root.addChild(box);
        root.addChild(editor);
        root.addChild(controller);
        tui.setFocus(editor);
        return root;
      });
      ctx.ui.setStatus("render-baseline-result", JSON.stringify(result));
    },
  });
  for (const kind of ["input", "editor", "custom-editor"])
    pi.registerCommand(`authority-${kind}`, {
      handler: async (_args, ctx) => {
        const result = await withListeners(ctx.ui, (tui, theme, keys, done) => {
          const Base =
            kind === "input"
              ? Input
              : kind === "editor"
                ? Editor
                : CustomEditor;
          let submitted = 0,
            disposed = 0;
          class OriginalControl extends Base {
            handleInput(data) {
              if (data === "authority-mutate-throw") {
                write("SDK callback after error");
                super.handleInput("\x1b[F");
                throw new Error("Original authority callback failed");
              }
              super.handleInput(data);
              ctx.ui.setStatus(
                "authority-value",
                this.getText?.() ?? this.getValue(),
              );
            }
            dispose() {
              disposed++;
              if (
                globalThis[Symbol.for("pi-desktop.authority-probe")] === probe
              )
                delete globalThis[Symbol.for("pi-desktop.authority-probe")];
            }
          }
          const original = new OriginalControl(
            ...(kind === "input"
              ? []
              : [
                  tui,
                  { borderColor: identity, selectList: listTheme },
                  ...(kind === "custom-editor" ? [keys] : []),
                ]),
          );
          const read = () => original.getText?.() ?? original.getValue();
          const write = (text) =>
            original.setText ? original.setText(text) : original.setValue(text);
          const probe = {
            mutate({ text, left = 0 }) {
              if (text !== undefined) write(text);
              original.handleInput("\x1b[F");
              for (let i = 0; i < left; i++) original.handleInput("\x1b[D");
              return read();
            },
            read,
          };
          write("abcdef");
          original.handleInput("\x1b[F");
          globalThis[Symbol.for("pi-desktop.authority-probe")] = probe;
          original.onSubmit = (text) => {
            submitted++;
            done({
              text,
              submitted,
              get disposed() {
                return disposed;
              },
            });
          };
          tui.setFocus(original);
          return original;
        });
        ctx.ui.setStatus("authority-result", JSON.stringify(result));
      },
    });
  pi.registerCommand("empty-render-probe", {
    handler: async (_args, ctx) => {
      const disposed = { root: 0, box: 0, label: 0, input: 0, controller: 0 };
      let submitted = 0;
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        class UserBox extends Box {
          hidden = false;
          render(width) {
            return this.hidden ? [] : super.render(width);
          }
          dispose() {
            disposed.box++;
          }
        }
        class UserInput extends Input {
          hidden = false;
          render(width) {
            return this.hidden ? [] : super.render(width);
          }
          dispose() {
            disposed.input++;
          }
        }
        const root = new Container();
        root.dispose = () => disposed.root++;
        const box = new UserBox(0, 0);
        const label = new Text("Original branch content", 0, 0);
        label.dispose = () => disposed.label++;
        const input = new UserInput({ prompt: "Nested field" });
        const controller = new Input({ prompt: "Controller field" });
        controller.dispose = () => disposed.controller++;
        input.onSubmit = (value) => {
          submitted++;
          done({ value, controller: controller.getValue(), submitted });
        };
        box.addChild(label);
        box.addChild(input);
        root.addChild(box);
        root.addChild(controller);
        presentationInput(tui, (data) => {
          if (matchesKey(data, "f2")) input.hidden = !input.hidden;
          else if (matchesKey(data, "f3")) box.hidden = !box.hidden;
          else if (matchesKey(data, "f4")) {
            input.handleInput("\x1b[F");
            input.handleInput("!");
            ctx.ui.setStatus("empty-render-value", input.getValue());
          } else if (matchesKey(data, "f5")) {
            input.setValue("SDK hidden value");
            ctx.ui.setStatus("empty-render-value", input.getValue());
          } else return;
          tui.requestRender();
          return { consume: true };
        });
        return root;
      });
      ctx.ui.setStatus(
        "empty-render-result",
        JSON.stringify({ ...result, disposed }),
      );
    },
  });
  pi.registerCommand("passive-render-probe", {
    handler: async (_args, ctx) => {
      const disposed = {
        root: 0,
        input: 0,
        Text: 0,
        TruncatedText: 0,
        Spacer: 0,
        DynamicBorder: 0,
      };
      let mode = 0,
        clicks = 0;
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const root = new Container();
        root.dispose = () => disposed.root++;
        const specs = [
          ["Text", Text, ["Original Text", 0, 0]],
          ["TruncatedText", TruncatedText, ["Original TruncatedText", 0, 0]],
          ["Spacer", Spacer, [2]],
          ["DynamicBorder", DynamicBorder, [identity]],
        ];
        const probes = specs.map(([name, Base, args]) => {
          const probe = new (class extends Base {
            render(width) {
              const body = super.render(width);
              if (mode === 2) return body;
              if (mode === 1) return [];
              const replacement = [
                `\x1b[38;2;11;122;99mChanged ${name} label`,
                "",
                `\x1b]8;;https://example.com/pi-render\x07Continuation ${name}\x1b]8;;\x07\x1b[0m`,
                "",
              ];
              if (name === "Text") {
                body.splice(0, body.length, ...replacement);
                return body;
              }
              return replacement;
            }
            handleMouse(event) {
              if (event.type === "click") {
                clicks++;
                ctx.ui.setStatus("passive-render-clicks", String(clicks));
              } else if (!["press", "release"].includes(event.type)) return;
              return { handled: true, render: false };
            }
            dispose() {
              disposed[name]++;
            }
          })(...args);
          root.addChild(probe);
          return probe;
        });
        const input = new Input({ prompt: "Retained field" });
        input.dispose = () => disposed.input++;
        input.onSubmit = (value) => done({ value, clicks, mode });
        root.addChild(input);
        presentationInput(tui, (data) => {
          if (!matchesKey(data, "f2")) return;
          mode = (mode + 1) % 3;
          for (const probe of probes) probe.invalidate();
          tui.requestRender();
          return { consume: true };
        });
        return root;
      });
      ctx.ui.setStatus(
        "passive-render-result",
        JSON.stringify({ ...result, disposed }),
      );
    },
  });
  pi.registerCommand("standard-render-probe", {
    handler: async (_args, ctx) => {
      const disposed = { root: 0, box: 0, text: 0, input: 0, list: 0 };
      let selected = "first",
        changes = 0;
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        let details = true;
        class UserContainer extends Container {
          render(width) {
            return details
              ? [
                  "Container heading",
                  ...super.render(width),
                  `Container footer: ${selected}`,
                ]
              : super.render(width);
          }
          dispose() {
            disposed.root++;
            box.dispose();
            list.dispose();
          }
        }
        class UserBox extends Box {
          render(width) {
            return details
              ? ["Box heading", ...super.render(width), "Box footer"]
              : super.render(width);
          }
          dispose() {
            disposed.box++;
            label.dispose();
            input.dispose();
          }
        }
        class UserText extends Text {
          render(width) {
            return details
              ? ["Text heading", ...super.render(width), "Text footer"]
              : super.render(width);
          }
          dispose() {
            disposed.text++;
          }
        }
        class UserList extends SelectList {
          render(width) {
            return details
              ? [
                  "\x1b[38;2;11;122;99mGeneric list heading\x1b[0m",
                  ...super.render(width),
                  `List footer: ${selected}`,
                ]
              : super.render(width);
          }
          dispose() {
            disposed.list++;
          }
        }
        const root = new UserContainer();
        const box = new UserBox(1, 0);
        const label = new UserText("Original component text", 0, 0);
        const input = new Input({ prompt: "Original field" });
        input.dispose = () => {
          disposed.input++;
        };
        const list = new UserList(
          [
            { value: "first", label: "First choice" },
            { value: "second", label: "Second choice" },
          ],
          2,
          listTheme,
        );
        list.onSelectionChange = (item) => {
          selected = item.value;
          changes++;
          ctx.ui.setStatus("standard-render-change", `${selected}:${changes}`);
        };
        list.onSelect = (item) =>
          done({ value: input.getValue(), selected: item.value, changes });
        box.addChild(label);
        box.addChild(input);
        root.addChild(box);
        root.addChild(list);
        presentationInput(tui, (data) => {
          if (!matchesKey(data, "f2")) return;
          details = !details;
          tui.requestRender();
          return { consume: true };
        });
        return root;
      });
      ctx.ui.setStatus(
        "standard-render-result",
        JSON.stringify({ ...result, disposed }),
      );
    },
  });
  pi.registerCommand("render-additions-probe", {
    handler: async (_args, ctx) => {
      const result = await withListeners(
        ctx.ui,
        (_tui, _theme, _keys, done) => {
          class UserInput extends Input {
            showDetails = true;
            render(width) {
              return this.showDetails
                ? [
                    "\x1b[38;2;11;122;99mRendered input heading\x1b[0m",
                    ...super.render(width),
                    `Rendered input footer: ${this.getValue()}`,
                  ]
                : super.render(width);
            }
            handleInput(data) {
              if (matchesKey(data, "f2")) this.showDetails = !this.showDetails;
              else super.handleInput(data);
            }
          }
          const input = new UserInput({ prompt: "Rendered input" });
          input.onSubmit = done;
          input.onEscape = () => done();
          const root = new Container();
          root.addChild(input);
          return root;
        },
      );
      ctx.ui.setStatus("render-additions-result", result);
    },
  });
  let lifecycleTui;
  pi.registerCommand("component-lifecycle-probe", {
    handler: async (args, ctx) => {
      if (args === "resume") {
        lifecycleTui.start();
        return;
      }
      if (args === "close") {
        ctx.ui.setHeader(undefined);
        return;
      }
      ctx.ui.setHeader((tui) => {
        lifecycleTui = tui;
        const input = new Input({ placeholder: "Lifecycle input" });
        input.setValue("Before pause");
        input.onSubmit = () => {
          tui.stop();
          input.setValue("After resume");
          tui.requestRender();
        };
        return input;
      });
    },
  });
  pi.registerCommand("notice-probe", {
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "\x1b[31mNotice probe\x1b[0m: \x1b]8;;https://example.invalid/notice\x1b\\Open reference\x1b]8;;\x1b\\",
        "info",
      );
    },
  });
  pi.registerCommand("delegated-frame-probe", {
    handler: async (args, ctx) => {
      const [
        kind = "Input",
        shape = "decorated",
        depthText = "3",
        storage = "direct",
      ] = args.trim().split(/\s+/);
      const depth = Number(depthText),
        modes = ["heading", "mask", "normal"];
      let mode = 0,
        clicks = 0;
      const submitted = [],
        changes = [],
        disposed = {};
      const result = await withListeners(ctx.ui, (tui, _theme, keys, done) => {
        let field, peer;
        const report = () =>
          ctx.ui.setStatus(
            "delegated-frame-state",
            JSON.stringify({
              mode: modes[mode],
              submitted,
              changes,
              clicks,
              value: field.getText?.() ?? field.getValue?.(),
            }),
          );
        const own = (name, value) => {
          disposed[name] = 0;
          value.dispose = () => disposed[name]++;
          return value;
        };
        if (kind === "SelectList") {
          field = new SelectList(
            [
              { value: "alpha", label: "secret alpha" },
              { value: "beta", label: "secret beta" },
            ],
            3,
            listTheme,
          );
          field.onSelect = (item) => {
            submitted.push(item.value);
            report();
          };
        } else if (kind === "SettingsList") {
          field = new SettingsList(
            [
              {
                id: "alpha",
                label: "secret alpha",
                currentValue: "off",
                values: ["off", "on"],
              },
              {
                id: "beta",
                label: "secret beta",
                currentValue: "off",
                values: ["off", "on"],
              },
            ],
            3,
            settingsTheme,
            (id, value) => {
              changes.push(`${id}:${value}`);
              report();
            },
            () => {},
            { enableSearch: true },
          );
        } else {
          const Base = { Input, Editor, CustomEditor }[kind];
          field =
            kind === "Input"
              ? new Base({ prompt: "Wrapped field" })
              : new Base(
                  tui,
                  { borderColor: identity, selectList: listTheme },
                  ...(kind === "CustomEditor" ? [keys] : []),
                );
          (field.setText ?? field.setValue).call(field, "secret value");
          field.handleInput("\x05");
          field.onSubmit = (value) => {
            submitted.push(value);
            report();
          };
        }
        own("field", field);
        const originalMouse = field.handleMouse?.bind(field);
        field.handleMouse = (event) => {
          if (event.type === "press") {
            clicks++;
            report();
          }
          return originalMouse?.(event);
        };
        let child = field;
        if (shape !== "decorated") {
          const body = own("body", new Box(1, 1));
          body.addChild(field);
          peer = own("peer", new Input({ prompt: "Wrapped peer" }));
          peer.setValue("Peer value");
          body.addChild(peer);
          child = body;
        }
        for (let index = 0; index < depth; index++) {
          const body = child;
          const references =
            storage === "symbol"
              ? { [Symbol("body")]: body }
              : storage === "array"
                ? { holder: [body, body] }
                : storage === "map-value"
                  ? { holder: new Map([["body", body]]) }
                  : storage === "map-key"
                    ? { holder: new Map([[body, "body"]]) }
                    : storage === "set"
                      ? { holder: new Set([body]) }
                      : storage === "record"
                        ? { holder: { content: { body } } }
                        : { body };
          if (storage !== "direct") references.self = references;
          child = own(`wrapper ${index}`, {
            ...references,
            render(width) {
              const lines = body.render(width);
              if (modes[mode] === "normal" || shape === "transparent")
                return lines;
              const drawing =
                modes[mode] === "mask" ? lines.map(maskFrameText) : lines;
              return [
                `Wrapper ${index} heading`,
                ...drawing,
                `Wrapper ${index} footer`,
              ];
            },
            handleInput(data) {
              if (index === depth - 1 && matchesKey(data, "f2"))
                mode = (mode + 1) % modes.length;
              else if (index === depth - 1 && matchesKey(data, "f3")) {
                (field.setText ?? field.setValue)?.call(field, "SDK update");
                tui.setFocus(field);
              } else if (index === depth - 1 && matchesKey(data, "f4"))
                done({ submitted, changes, disposed });
              else (body.handleInput ? body : field).handleInput(data);
              tui.requestRender();
              report();
            },
            invalidate() {
              body.invalidate();
            },
          });
        }
        if (shape !== "decorated") {
          class Outer extends Box {
            render(width) {
              return [
                "Enclosing heading",
                ...super
                  .render(width)
                  .map((line) =>
                    (modes[mode] === "mask"
                      ? maskFrameText(line)
                      : line
                    ).replaceAll("Wrapper", "Enclosing wrapper"),
                  ),
                "Enclosing footer",
              ];
            }
          }
          const outer = own("outer", new Outer(1, 1));
          outer.addChild(child);
          child = outer;
        }
        tui.setFocus(field);
        report();
        return child;
      });
      ctx.ui.setStatus("delegated-frame-result", JSON.stringify(result));
    },
  });
  pi.registerCommand("delegated-component-probe", {
    handler: async (_args, ctx) => {
      const result = await withListeners(
        ctx.ui,
        (_tui, _theme, _keys, done) => {
          const input = new Input();
          input.onSubmit = (value) => done(value);
          const body = new Container();
          body.addChild(new Text("Delegated Pi Input", 0, 0));
          body.addChild(input);
          return {
            body,
            render(width) {
              return this.body.render(width);
            },
            invalidate() {
              this.body.invalidate();
            },
            handleInput(data) {
              if (data === "\u001b") done(undefined);
              else input.handleInput(data);
            },
          };
        },
      );
      ctx.ui.setStatus("delegated-component", result);
    },
  });
  pi.registerCommand("file-link-probe", {
    handler: async (args, ctx) => {
      const url = args.trim();
      await withListeners(ctx.ui, (_tui, _theme, _keys, done) => {
        const root = new Container();
        root.addChild(
          new Text(`\x1b]8;;${url}\x1b\\Text file\x1b]8;;\x1b\\`, 0, 0),
        );
        root.addChild(
          new Markdown(`[Markdown file](${url})`, 0, 0, markdownTheme),
        );
        const choices = new SelectList(
          [{ value: "close", label: "Close file links" }],
          1,
          listTheme,
        );
        choices.onSelect = () => done();
        root.addChild(choices);
        return root;
      });
    },
  });
  pi.registerCommand("link-probe", {
    handler: async (args, ctx) => {
      await withListeners(ctx.ui, (_tui, _theme, _keys, done) => {
        const root = new Container();
        root.addChild(
          new Text(
            "\x1b]8;;mailto:pi@example.invalid?subject=Pi%20desktop\x1b\\Text email\x1b]8;;\x1b\\\n\x1b]8;;tel:+15550123456\x1b\\Text phone\x1b]8;;\x1b\\",
            0,
            0,
          ),
        );
        root.addChild(
          new Markdown(
            "[Markdown email](mailto:pi@example.invalid?subject=Pi%20desktop) and [Markdown phone](tel:+15550123456)",
            0,
            0,
            markdownTheme,
          ),
        );
        const customUrl =
          args.trim() || "pi-desktop-test:open?file=hello%20world&line=12#part";
        root.addChild(
          new Text(`\x1b]8;;${customUrl}\x1b\\Text custom\x1b]8;;\x1b\\`, 0, 0),
        );
        root.addChild(
          new Markdown(`[Markdown custom](${customUrl})`, 0, 0, markdownTheme),
        );
        const choices = new SelectList(
          [{ value: "close", label: "Close links" }],
          1,
          listTheme,
        );
        choices.onSelect = () => done();
        root.addChild(choices);
        return root;
      });
    },
  });
  pi.registerCommand("editor-config-probe", {
    handler: async (_args, ctx) => {
      await withListeners(ctx.ui, (tui, theme, _keys, done) => {
        const root = new Container();
        const editor = new Editor(
          tui,
          {
            borderColor: (text) => theme.fg("border", text),
            selectList: listTheme,
          },
          { paddingX: 2 },
        );
        editor.disableSubmit = true;
        editor.setText("Retained editor draft");
        editor.onSubmit = (value) =>
          ctx.ui.setStatus("editor-config-submit", value);
        const choices = new SelectList(
          ["enable", "disable", "padding0", "padding4", "close"].map(
            (value) => ({ value, label: value }),
          ),
          5,
          listTheme,
        );
        choices.onSelect = ({ value }) => {
          if (value === "close") return done();
          if (value === "enable" || value === "disable")
            editor.disableSubmit = value === "disable";
          else editor.setPaddingX(value === "padding0" ? 0 : 4);
          tui.requestRender();
        };
        root.addChild(editor);
        root.addChild(choices);
        return root;
      });
    },
  });
  pi.registerCommand("stack-size-probe", {
    handler: async (_args, ctx) => {
      await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const root = new Container();
        const stack = new VStack([], { gap: 1 });
        const input = new Input({ prompt: "Collapsible input" });
        input.setValue("Retained draft");
        input.onSubmit = (value) => ctx.ui.setStatus("stack-submit", value);
        const minimum = new Input({ prompt: "Minimum input" });
        const maximum = new Input({ prompt: "Maximum hidden input" });
        const rebuild = (show) => {
          stack.clear();
          stack.addChild(new Text("Before collapsed entry", 0, 0));
          stack.addChild(input, { basis: show ? 4 : 0 });
          stack.addChild(minimum, { basis: 0, minSize: 3 });
          stack.addChild(maximum, { maxSize: 0 });
          stack.addChild(new Text("After collapsed entry", 0, 0));
        };
        rebuild(false);
        const choices = new SelectList(
          ["show", "hide", "close"].map((value) => ({ value, label: value })),
          3,
          listTheme,
        );
        choices.onSelect = ({ value }) => {
          if (value === "close") return done();
          rebuild(value === "show");
          tui.requestRender();
        };
        root.addChild(stack);
        root.addChild(choices);
        return root;
      });
    },
  });
  pi.registerCommand("layout-order-probe", {
    handler: async (_args, ctx) => {
      await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const root = new Container();
        const lines = Array.from(
          { length: 60 },
          (_, index) => `Layout row ${index + 1}`,
        ).join("\n");
        const content = new Text(lines, 0, 0);
        const scroll = new ScrollView(content, {
          scrollbar: "always",
          scrollbarThumbStyle: (text) =>
            `\x1b[${text === "█" ? 31 : 32}m${text}\x1b[0m`,
          scrollbarTrackStyle: (text) => `\x1b[34m${text}\x1b[0m`,
        });
        let dimensions = "";
        const updateLayout = scroll.updateLayout.bind(scroll);
        scroll.updateLayout = (height, viewport, changed) => {
          updateLayout(height, viewport, changed);
          dimensions = `${height}:${viewport}`;
          ctx.ui.setStatus("layout-order-dimensions", dimensions);
        };
        root.addChild(
          new MouseRegion(scroll, (event) => {
            if (event.type !== "press") return;
            ctx.ui.setStatus("layout-order-pointer", dimensions);
            return { handled: true, render: false };
          }),
        );
        const commands = new SelectList(
          ["short", "long", "auto", "active", "close"].map((value) => ({
            value,
            label: value,
          })),
          5,
          listTheme,
        );
        commands.onSelect = ({ value }) => {
          if (value === "close") return done();
          if (value === "short" || value === "long")
            content.setText(value === "short" ? "Short layout content" : lines);
          if (value === "auto") scroll.setScrollbar("auto");
          if (value === "active") scroll.setScrollbarActive(true);
          ctx.ui.setStatus("layout-order-action", value);
          tui.requestRender();
        };
        root.addChild(commands);
        return root;
      });
    },
  });
  pi.registerCommand("scrollbar-probe", {
    handler: async (_args, ctx) => {
      await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const root = new Container();
        const lines = Array.from(
          { length: 60 },
          (_, index) => `Scroll row ${index + 1}`,
        ).join("\n");
        const content = new Text(lines, 0, 0);
        const scroll = new ScrollView(content, {
          scrollbar: "always",
          scrollbarHideDelayMs: 400,
          scrollbarTrackStyle: (text) => `\x1b[34m${text}\x1b[0m`,
          scrollbarThumbStyle: (text) =>
            `\x1b[${text === "█" ? 31 : 32}m${text}\x1b[0m`,
        });
        const updateLayout = scroll.updateLayout.bind(scroll);
        scroll.updateLayout = (
          contentHeight,
          viewportHeight,
          requestRender,
        ) => {
          updateLayout(contentHeight, viewportHeight, requestRender);
          ctx.ui.setStatus(
            "scrollbar-layout",
            `${contentHeight}:${viewportHeight}`,
          );
        };
        const commands = new SelectList(
          [
            "auto",
            "always",
            "hidden",
            "active",
            "inactive",
            "scroll",
            "short",
            "long",
            "close",
          ].map((value) => ({ value, label: value })),
          9,
          listTheme,
        );
        commands.onSelect = ({ value }) => {
          if (value === "close") return done();
          if (["auto", "always", "hidden"].includes(value))
            scroll.setScrollbar(value);
          if (value === "active" || value === "inactive")
            scroll.setScrollbarActive(value === "active");
          if (value === "scroll") scroll.scrollBy(3);
          if (value === "short" || value === "long")
            content.setText(value === "short" ? "Short content" : lines);
          ctx.ui.setStatus("scrollbar-action", value);
          tui.requestRender();
        };
        root.addChild(scroll);
        root.addChild(commands);
        return root;
      });
    },
  });
  pi.registerCommand("image-probe", {
    handler: async (_args, ctx) => {
      await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const root = new Container();
        const source = Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#2463a5"/><circle cx="400" cy="200" r="140" fill="#ffd166"/></svg>',
        ).toString("base64");
        const options = {
          filename: "mapped-image.svg",
          maxWidthCells: 30,
          maxHeightCells: 4,
        };
        const picture = new Image(
          source,
          "image/svg+xml",
          {
            fallbackColor(text) {
              return `\x1b[31;3mUnavailable ${text}\x1b[0m`;
            },
          },
          options,
          { widthPx: 800, heightPx: 400 },
        );
        const choices = new SelectList(
          [
            { value: "narrow", label: "Narrow image" },
            { value: "broken", label: "Broken image" },
            { value: "recover", label: "Recover image" },
            { value: "close", label: "Close image" },
          ],
          4,
          listTheme,
        );
        choices.onSelect = (item) => {
          if (item.value === "close") return done();
          if (item.value === "narrow") options.maxWidthCells = 10;
          else
            picture.base64Data = item.value === "broken" ? "invalid" : source;
          picture.invalidate();
          ctx.ui.setStatus("image-action", item.value);
          tui.requestRender();
        };
        root.addChild(picture);
        root.addChild(choices);
        return root;
      });
    },
  });
  pi.registerCommand("rich-control-probe", {
    description: "Shared mixed text, links and original control interactions",
    handler: async (args, ctx) => {
      let changes = 0;
      const mouse = [];
      const unsubscribe =
        args === "listener"
          ? ctx.ui.onTerminalInput((data) => {
              if (data === "\x1b[B") return { consume: true };
              if (data === "\x1b[A") return { data: "\x1b[B" };
            })
          : undefined;
      try {
        const result = await withListeners(
          ctx.ui,
          (_tui, _theme, _keys, done) => {
            const root = new Container();
            const input = new Input({
              prompt: "Rich input",
              placeholder: "First Second Help",
              placeholderStyle: () =>
                "\x1b[38;2;18;130;90mFirst\x1b[39m \x1b[3;5;38;2;113;54;95mSecond\x1b[0m \x1b]8;;https://example.com/placeholder\x1b\\Help\x1b]8;;\x1b\\",
            });
            input.onSubmit = (text) => ctx.ui.setStatus("rich-input", text);
            root.addChild(input);
            const choice = new SelectList(
              args.startsWith("scroll")
                ? Array.from({ length: 24 }, (_, index) => ({
                    value: `row:${index + 1}:original`,
                    label: `\x1b[38;2;18;130;90mRow ${index + 1}\x1b[39m plain`,
                  }))
                : [
                    {
                      value: "alpha:original",
                      label:
                        "\x1b[38;2;18;130;90;4:2;58:5:196mAlpha\x1b[24;59;39m plain \x1b]8;;https://example.com/option\x1b\\Item link\x1b]8;;\x1b\\",
                    },
                    {
                      value: "beta:original",
                      label:
                        "\x1b[38;2;113;54;95mBeta\x1b[39m \x1b[3malternate\x1b[23m",
                    },
                  ],
              4,
              {
                ...listTheme,
                selectedText: (text) => `\x1b[1m${text}\x1b[22m`,
              },
            );
            if (args.startsWith("scroll")) choice.setSelectedIndex(19);
            if (args === "listbox" || args === "scroll-listbox") {
              choice.handleMouse = (event) => {
                mouse.push({
                  type: event.type,
                  x: event.x,
                  y: event.y,
                });
                ctx.ui.setStatus("rich-mouse", JSON.stringify(mouse));
                return { handled: false, render: false };
              };
            }
            choice.onSelectionChange = (item) => {
              ctx.ui.setStatus(
                "rich-change",
                JSON.stringify({ value: item.value, changes: ++changes }),
              );
            };
            choice.onSelect = (item) =>
              done({ value: item.value, text: input.getValue(), changes });
            choice.onCancel = () => done();
            root.addChild(choice);
            const settings = new SettingsList(
              [
                {
                  id: "rich:mode",
                  label: "Rich preference",
                  currentValue: "quiet:original",
                  values: ["quiet:original", "loud:original"],
                },
              ],
              4,
              {
                ...settingsTheme,
                value: (value) =>
                  value === "quiet:original"
                    ? "\x1b[38;2;18;130;90mQuiet\x1b[39m mode"
                    : "\x1b[38;2;113;54;95mLoud\x1b[39m \x1b[3mmode\x1b[23m",
              },
              (id, value) =>
                ctx.ui.setStatus("rich-setting", JSON.stringify({ id, value })),
              () => done(),
            );
            root.addChild(settings);
            return root;
          },
        );
        ctx.ui.setStatus("rich-result", JSON.stringify(result ?? null));
      } finally {
        unsubscribe?.();
      }
    },
  });
  pi.registerCommand("dialog-text-probe", {
    handler: async (args, ctx) => {
      const title = "\x1b[38;2;40;90;140mStyled dialog\x1b[0m";
      let value;
      if (args === "editor") value = await ctx.ui.editor(title, "first");
      else if (args === "confirm")
        value = await ctx.ui.confirm(
          title,
          "\x1b[3mConfirm text\x1b[0m <script>literal</script>",
        );
      else if (args === "input")
        value = await ctx.ui.input(
          title,
          "\x1b[38;2;80;130;30mStyled hint\x1b[0m",
        );
      else
        value = await ctx.ui.select(title, [
          "\x1b[38;2;150;30;60mChoice\x1b[0m",
          "\x1b[38;2;30;130;60mChoice\x1b[0m",
          "\x1b]8;;https://example.com/dialog\x1b\\Read help\x1b]8;;\x1b\\",
        ]);
      ctx.ui.setStatus(
        "dialog-text-result",
        JSON.stringify({ value: value ?? null }),
      );
    },
  });
  pi.registerCommand("dialog-timeout-probe", {
    handler: async (args, ctx) => {
      const kind = args || "input";
      const options = {
        timeout:
          kind === "negative" ? -100 : kind === "reconnect" ? 6500 : 2500,
      };
      const value =
        kind === "select"
          ? await ctx.ui.select("Timed selection", ["First", "Second"], options)
          : kind === "confirm"
            ? await ctx.ui.confirm(
                "Timed confirmation",
                "Confirm this choice",
                options,
              )
            : await ctx.ui.input("Timed input", "Your answer", options);
      ctx.ui.setStatus(
        "dialog-timeout-result",
        JSON.stringify({ kind, value: value ?? null }),
      );
    },
  });
  pi.registerCommand("text-surface-probe", {
    description:
      "Shared text mapping for status, working text and widget arrays",
    handler: async (args, ctx) => {
      if (args === "clear") {
        ctx.ui.setStatus("surface-text", undefined);
        ctx.ui.setWidget("surface-above", undefined);
        ctx.ui.setWidget("surface-below", undefined);
        ctx.ui.setWorkingMessage(undefined);
        ctx.ui.setWorkingIndicator(undefined);
        return;
      }
      if (args === "indicator") {
        ctx.ui.setWorkingMessage("\x1b[38;2;31;82;133mWorking text\x1b[0m");
        ctx.ui.setWorkingIndicator({
          frames: [
            "\x1b[38;2;19;120;70mFrame A\x1b[0m",
            "\x1b[3;38;2;140;60;100mFrame B\x1b[0m",
          ],
          intervalMs: 300,
        });
        return;
      }
      if (args.startsWith("thinking")) {
        ctx.ui.setHiddenThinkingLabel(
          args === "thinking-empty"
            ? ""
            : args === "thinking-reset"
              ? undefined
              : "\x1b[3;38;2;80;110;140mPrivate reasoning\x1b[0m",
        );
        return;
      }
      if (args === "component") {
        ctx.ui.setWidget(
          "surface-above",
          () => new Text("Component widget", 0, 0),
        );
        return;
      }
      if (args === "update") {
        ctx.ui.setStatus("surface-text", "Plain status");
        ctx.ui.setWidget("surface-above", ["Moved plain widget"], {
          placement: "belowEditor",
        });
        ctx.ui.setWidget("surface-below", undefined);
        ctx.ui.setWorkingMessage("Plain working");
        return;
      }
      ctx.ui.setStatus(
        "surface-text",
        "\x1b[1;38;2;18;130;90mReady\x1b[0m normal <script>status text</script> \x1b]8;;https://example.com/status\x1b\\Status link\x1b]8;;\x1b\\\x1b]2;Ignored title\x07",
      );
      ctx.ui.setWidget("surface-above", [
        "\x1b[3;38;2;44;95;146mAbove widget",
        "Continued color\x1b[0m plain widget",
      ]);
      ctx.ui.setWidget(
        "surface-below",
        [
          "\x1b[38;2;113;54;95mBelow widget\x1b[39m \x1b]8;;https://example.com/widget\x1b\\Widget link\x1b]8;;\x1b\\",
        ],
        { placement: "belowEditor" },
      );
      ctx.ui.setWorkingMessage("\x1b[38;2;31;82;133mWorking text\x1b[39m");
    },
  });
  pi.registerCommand("control-style-probe", {
    description: "Shared native control labels and original theme functions",
    handler: async (args, ctx) => {
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const color = (red, green, blue) => (text) =>
          `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`;
        const root = new Box(1, 0);
        const loader = new CancellableLoader(
          tui,
          color(41, 142, 93),
          color(31, 82, 133),
          "Original loading",
          { frames: ["\x1b[38;2;41;142;93m*\x1b[39m"] },
        );
        loader.onAbort = () => done("aborted");
        const input = new Input({
          prompt: color(18, 130, 90)("Control update"),
          placeholder: "Original placeholder",
          placeholderStyle: (text) =>
            `\x1b[3;38;2;91;101;111m${text.replace("Original", "ORIGINAL")}\x1b[23;39m`,
        });
        input.onSubmit = (text) => {
          loader.setMessage(text);
          ctx.ui.setStatus("control-input", text);
          tui.requestRender();
        };
        root.addChild(input);
        const choice = new SelectList(
          [
            {
              value: "alpha",
              label: "Alpha",
              description: "Alpha description",
            },
            {
              value: "beta",
              label: "\x1b[38;2;113;54;95mBeta\x1b[39m",
              description: "Beta description",
            },
          ],
          4,
          {
            ...listTheme,
            selectedText: (text) =>
              `\x1b[${args === "hidden" ? "8;" : ""}1;38;2;44;95;146m${text.replace("Alpha", "ALPHA")}\x1b[22;28;39m`,
            noMatch: color(147, 58, 69),
          },
        );
        if (args === "listbox")
          choice.handleMouse = () => ({ handled: false, render: false });
        choice.onSelectionChange = (item) =>
          ctx.ui.setStatus("control-selected", item.value);
        choice.onSelect = (item) => {
          ctx.ui.setStatus("control-confirmed", item.value);
          choice.setFilter("absent");
          tui.requestRender();
        };
        root.addChild(choice);
        const settings = new SettingsList(
          [
            {
              id: "mode:choice",
              label: "Preference",
              currentValue: "quiet",
              values: ["quiet", "loud"],
              description: "Preference description",
            },
            {
              id: "read:only",
              label: "Read only",
              currentValue: "fixed",
              description: "Read-only description",
            },
          ],
          5,
          {
            ...settingsTheme,
            label: (text, selected) => color(selected ? 72 : 102, 83, 94)(text),
            value: (text, selected) =>
              `${selected ? "\x1b[1m" : ""}${color(105, 116, 127)(text.replace("quiet", "QUIET").replace("loud", "LOUD"))}\x1b[22m`,
            description: color(128, 99, 70),
            hint: color(147, 58, 69),
          },
          (id, value) => ctx.ui.setStatus("control-setting", `${id}=${value}`),
          () => done("closed"),
          { enableSearch: true },
        );
        root.addChild(settings);
        root.addChild(new DynamicBorder(color(100, 111, 122)));
        const editor = new Editor(tui, {
          borderColor: color(123, 84, 45),
          selectList: listTheme,
        });
        editor.setText("Original editor");
        root.addChild(editor);
        root.addChild(loader);
        return root;
      });
      ctx.ui.setStatus("control-result", result);
    },
  });
  pi.registerCommand("markdown-style-probe", {
    description:
      "Generic Markdown semantic components and original theme functions",
    handler: async (_args, ctx) => {
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const color = (red, green, blue) => (text) =>
          `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`;
        const richTheme = {
          ...markdownTheme,
          heading: (text) =>
            color(
              18,
              130,
              90,
            )(text.replace("Semantic title", "SEMANTIC TITLE")),
          code: color(44, 55, 66),
          link: color(23, 45, 67),
          linkUrl: color(71, 81, 91),
          quote: color(77, 88, 99),
          quoteBorder: color(101, 102, 103),
          listBullet: color(104, 105, 106),
          codeBlockBorder: color(110, 111, 112),
          hr: color(107, 108, 109),
          bold: (text) => `\x1b[1m${text}\x1b[22m`,
          italic: (text) => `\x1b[3m${text}\x1b[23m`,
          underline: (text) => `\x1b[4m${text}\x1b[24m`,
          strikethrough: (text) => `\x1b[9m${text}\x1b[29m`,
          highlightCode: (code, lang) =>
            code
              .split("\n")
              .map((line) =>
                color(113, 114, 115)(lang === "js" ? line.toUpperCase() : line),
              ),
        };
        const root = new Box(1, 0);
        const markdown = new Markdown(
          "# Semantic title\n\nOriginal **bold** and `inline` and ~~strike~~. [Clickable](https://example.com/markdown)\n\n" +
            "\x1b[38;2;21;43;65mInline ANSI\x1b[39m\n\n" +
            "> Quote **nested**\n\n7) First item\n8) Second item\n\n" +
            "| Header | Other |\n| :--- | ---: |\n| Cell | Value |\n\n" +
            "```js\nlet value = 1;\n```\n\n---\n\n" +
            "\\(\\alpha\\)\n\n<script>literal markdown</script>",
          0,
          0,
          richTheme,
          undefined,
          { preserveOrderedListMarkers: true },
        );
        root.addChild(markdown);
        root.addChild(
          new Markdown("Default `reset code` restored", 0, 0, richTheme, {
            bold: true,
            italic: true,
            color: color(75, 85, 95),
          }),
        );
        const input = new Input({ prompt: "Markdown update" });
        input.onSubmit = (text) => {
          markdown.setText(`# ${text}`);
          tui.requestRender();
        };
        root.addChild(input);
        const close = new SelectList(
          [{ value: "close", label: "Close Markdown" }],
          3,
          listTheme,
        );
        close.onSelect = () => done("closed");
        root.addChild(close);
        return root;
      });
      ctx.ui.setStatus("markdown-result", result);
    },
  });
  pi.registerCommand("text-style-probe", {
    description: "Standard text styling and background callbacks",
    handler: async (_args, ctx) => {
      const result = await withListeners(ctx.ui, (tui, theme, _keys, done) => {
        const root = new Box(
          1,
          1,
          (text) => `\x1b[48;2;20;30;40m${text}\x1b[49m`,
        );
        const text = new Text(
          "\x1b[1;3;4;9;38;2;18;130;90;48;5;24mStyled message\x1b[0m Plain text\n" +
            "\x1b[38;2;23;45;67m\x1b]8;id=pi;https://example.com/pi?x=1&y=2\x07Pi link\x1b]8;;\x07 After link\x1b[39m\n" +
            "\x1b[2;7mReverse dim\x1b[27;22m\n" +
            "\x1b[1;1;3;3;4;4mNested styles\x1b[22;23;24m Reset once\n" +
            "\x1b[38:2::10:20:30;4:3;58:5:196;53;9mExtended underline\x1b[0m\n" +
            "\x1b[53mOverline\x1b[55m Plain decoration\n\x1b[0m" +
            "<script>visible text</script>\x1b[2J\x1b]0;ignored title\x07",
          1,
          1,
          (value) => `\x1b[48;2;31;41;51m${value}\x1b[49m`,
        );
        const input = new Input({ prompt: "Text update" });
        input.onSubmit = (value) => {
          text.setText(theme.fg("accent", value));
          tui.requestRender();
        };
        const close = new SelectList(
          [{ value: "close", label: "Close styled text" }],
          3,
          listTheme,
        );
        close.onSelect = () => done("closed");
        root.addChild(text);
        root.addChild(
          new TruncatedText(
            "\x1b[38;5;196mTruncated styling remains on the first line\x1b[39m\nHidden second line",
          ),
        );
        root.addChild(
          new Markdown(
            "Markdown default style",
            1,
            1,
            {
              ...markdownTheme,
              bold: (value) => `\x1b[1m${value}\x1b[22m`,
              italic: (value) => `\x1b[3m${value}\x1b[23m`,
            },
            {
              color: (value) => `\x1b[38;2;75;85;95m${value}\x1b[39m`,
              bgColor: (value) => `\x1b[48;2;205;215;225m${value}\x1b[49m`,
              bold: true,
              italic: true,
            },
          ),
        );
        root.addChild(input);
        root.addChild(close);
        return root;
      });
      ctx.ui.setStatus("styled-result", result);
    },
  });
  pi.registerCommand("component-listener-probe", {
    description: "Input listeners on a standard Text component",
    handler: async (_args, ctx) => {
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const label = new Text("Listener ready");
        let debug = 0;
        presentationDebug(tui, () => {
          label.setText(`Debug callback: ${++debug}`);
          tui.requestRender();
        });
        presentationInput(tui, (data) => {
          if (isKeyRelease(data)) return undefined;
          if (data === "q") {
            done(`Original listener result: ${debug}`);
            return { consume: true };
          }
          if (data === "d") return { data: "\u001b[100;6u" };
          label.setText(`Listener received: ${data}`);
          tui.requestRender();
          return { consume: true };
        });
        return label;
      });
      ctx.ui.setStatus("component-listener", result);
    },
  });
  let globalInput;
  pi.registerShortcut("ctrl+alt+j", {
    handler: (ctx) => {
      if (!globalInput) return;
      globalInput.shortcuts++;
      globalInput.report();
      ctx.ui.setStatus("global-input-shortcut", String(globalInput.shortcuts));
    },
  });
  pi.registerCommand("global-input-probe", {
    handler: (_args, ctx) => {
      globalInput?.cleanup();
      ctx.ui.setEditorText("");
      const state = { events: [], debug: 0, duplicates: 0, shortcuts: 0 };
      const report = () =>
        ctx.ui.setStatus(
          "global-input",
          JSON.stringify({
            events: state.events,
            debug: state.debug,
            duplicates: state.duplicates,
            shortcuts: state.shortcuts,
          }),
        );
      state.report = report;
      const record = (origin, data) => {
        state.events.push(
          `${origin}:${isKeyRelease(data) ? "release" : "press"}:${parseKey(data) ?? data}`,
        );
        report();
      };
      const headerListener = (data) => {
        record("header", data);
        if (matchesKey(data, "g")) return { data: "H" };
        if (matchesKey(data, "d")) return { data: "\x1b[100;6u" };
        if (matchesKey(data, "s")) return { data: "\x1b[106;7u" };
      };
      const footerListener = (data) => {
        record("footer", data);
        if (data === "H") return { data: "G" };
      };
      const duplicate = () => {
        state.duplicates++;
        report();
      };
      const off = ctx.ui.onTerminalInput((data) => record("context", data));
      ctx.ui.setHeader((tui) => {
        state.header = tui;
        tui.addInputListener(headerListener);
        return new Text("Global input header");
      });
      ctx.ui.setFooter((tui) => {
        state.footer = tui;
        tui.addInputListener(footerListener);
        tui.addInputListener(duplicate);
        tui.addInputListener(duplicate);
        state.onDebug = function () {
          if (
            this === tui ||
            Object.getPrototypeOf(this) !== Object.getPrototypeOf(tui)
          )
            throw new Error("Global debug renderer receiver changed");
          state.debug++;
          report();
        };
        tui.onDebug = state.onDebug;
        return new Text("Global input footer");
      });
      state.removeHeaderListener = () =>
        state.footer.removeInputListener(headerListener);
      state.retireHeader = () => ctx.ui.setHeader(undefined);
      state.cleanup = () => {
        off();
        state.header?.removeInputListener(headerListener);
        state.footer?.removeInputListener(footerListener);
        state.footer?.removeInputListener(duplicate);
        if (state.footer && globalInput === state)
          state.footer.onDebug = undefined;
        ctx.ui.setHeader(undefined);
        ctx.ui.setFooter(undefined);
      };
      globalInput = state;
      report();
    },
  });
  pi.registerCommand("global-input-retire", {
    handler: () => globalInput.retireHeader(),
  });
  pi.registerCommand("global-input-remove", {
    handler: () => globalInput.removeHeaderListener(),
  });
  pi.registerCommand("global-input-cleanup", {
    handler: () => {
      globalInput?.cleanup();
      globalInput = undefined;
    },
  });
  pi.registerCommand("global-input-open", {
    handler: async (args, ctx) => {
      const mode = args.trim();
      let result;
      if (mode === "dialog")
        result = await ctx.ui.input("Shared native dialog", "");
      else
        result = await ctx.ui.custom((_tui, _theme, _keys, done) => {
          if (mode === "terminal") {
            let value = "";
            return {
              render: () => [`Shared terminal: ${value || "(empty)"}`],
              invalidate() {},
              handleInput(data) {
                if (isKeyRelease(data)) return;
                if (matchesKey(data, "escape")) return done(value);
                if (matchesKey(data, "enter")) return done(value);
                value += data;
              },
            };
          }
          const input = new Input({ prompt: "Shared mapped input" });
          input.onSubmit = done;
          return input;
        });
      ctx.ui.setStatus("global-input-result", `${mode}:${result}`);
    },
  });

  let phaseShortcutCount = 0;
  pi.registerShortcut("ctrl+alt+k", {
    description: "Keyboard phase shortcut probe",
    handler: (ctx) =>
      ctx.ui.setStatus("keyboard-phase-shortcut", String(++phaseShortcutCount)),
  });
  pi.registerCommand("keyboard-phase-probe", {
    handler: async (args, ctx) => {
      const mode = args.trim() || "native";
      const records = { global: [], factory: [], received: [], values: [] };
      const event = (data) => ({
        key: parseKey(data) ?? data,
        phase: isKeyRelease(data)
          ? "release"
          : isKeyRepeat(data)
            ? "repeat"
            : "press",
      });
      let inputs = [];
      const report = () => {
        records.values = inputs.map((input) => input.getValue());
        ctx.ui.setStatus("keyboard-phases", JSON.stringify(records));
      };
      const off = ctx.ui.onTerminalInput((data) => {
        records.global.push(event(data));
      });
      try {
        const result = await withListeners(
          ctx.ui,
          (tui, _theme, _keys, done) => {
            class PhaseInput extends Input {
              wantsKeyRelease = mode !== "ordinary";
              handleInput(data) {
                records.received.push({
                  ...event(data),
                  target: inputs.indexOf(this),
                });
                if (isKeyRelease(data)) {
                  report();
                  return;
                }
                if (matchesKey(data, "escape")) {
                  done(records);
                  return;
                }
                super.handleInput(data);
                report();
              }
            }
            inputs = [
              new PhaseInput({ prompt: "Phase source" }),
              new PhaseInput({ prompt: "Phase destination" }),
            ];
            const root =
              mode === "terminal"
                ? {
                    wantsKeyRelease: true,
                    body: inputs[0],
                    render() {
                      return [
                        "Keyboard phases",
                        `Value: ${inputs[0].getValue() || "(empty)"}`,
                      ];
                    },
                    invalidate() {},
                    handleInput(data) {
                      inputs[0].handleInput(data);
                    },
                  }
                : new Container();
            if (mode !== "terminal")
              inputs.forEach((input) => root.addChild(input));
            presentationInput(tui, (data) => {
              records.factory.push(event(data));
              queueMicrotask(report);
              if (isKeyRelease(data) && matchesKey(data, "c"))
                return { consume: true };
              if (isKeyRelease(data) && matchesKey(data, "r"))
                return { data: "R" };
              if (!isKeyRelease(data) && matchesKey(data, "s"))
                return { data: "\x1b[115;1:3u" };
              if (
                isKeyRelease(data) &&
                matchesKey(data, "f") &&
                mode !== "terminal"
              )
                tui.setFocus(inputs[1]);
            });
            tui.setFocus(inputs[0]);
            report();
            return root;
          },
        );
        ctx.ui.setStatus("keyboard-phase-result", JSON.stringify(result));
      } finally {
        off();
      }
    },
  });
  pi.registerCommand("component-listener-focus-probe", {
    description:
      "A listener redirects an input carrying browser control context",
    handler: async (_args, ctx) => {
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const root = new Container();
        const first = new Input({ prompt: "Listener source" });
        const second = new Input({ prompt: "Listener destination" });
        first.setValue("source");
        second.setValue("destination");
        second.onSubmit = (value) => done(`${first.getValue()}|${value}`);
        presentationInput(tui, (data) => {
          if (!matchesKey(data, "f2")) return undefined;
          tui.setFocus(second);
          return { data: "X" };
        });
        root.addChild(first);
        root.addChild(second);
        tui.setFocus(first);
        return root;
      });
      ctx.ui.setStatus("component-listener-focus", result);
    },
  });
  pi.registerCommand("component-listener-mutation-probe", {
    description:
      "Original listener text and caret changes survive browser context",
    handler: async (_args, ctx) => {
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const input = new Input({ prompt: "Listener mutation" });
        input.setValue("before");
        input.onSubmit = done;
        presentationInput(tui, (data) => {
          const mode = matchesKey(data, "f2")
            ? "continue"
            : matchesKey(data, "f3")
              ? "consume"
              : matchesKey(data, "f4")
                ? "empty"
                : undefined;
          if (!mode) return undefined;
          input.setValue(mode);
          input.handleInput("\u0005");
          if (mode === "consume") return { consume: true };
          return { data: mode === "empty" ? "" : "!" };
        });
        return input;
      });
      ctx.ui.setStatus("component-listener-mutation", result);
    },
  });
  pi.registerCommand("component-focus-probe", {
    description: "Original programmatic component focus",
    handler: async (_args, ctx) => {
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const root = new VStack();
        const first = new Input({ prompt: "First field" });
        const second = new Input({ prompt: "Second field" });
        first.onSubmit = (value) => {
          if (value === "show") {
            root.clear();
            root.addChild(first);
            root.addChild(second);
          } else if (value !== "stay")
            tui.setFocus(value === "clear" ? null : second);
          tui.requestRender();
        };
        second.onSubmit = (value) => {
          if (value !== "hide") return done(value);
          second.setValue("");
          root.clear();
          root.addChild(first);
          root.addChild(second, { basis: 0 });
          tui.requestRender();
        };
        root.addChild(first);
        root.addChild(second);
        tui.setFocus(second);
        return root;
      });
      ctx.ui.setStatus("component-focus", result);
    },
  });
  pi.registerCommand("component-theme-cache-probe", {
    description: "Original cached widget observes SDK theme invalidation",
    handler: (args, ctx) => {
      if (args === "remove") return ctx.ui.setWidget("theme-cache", undefined);
      ctx.ui.setWidget("theme-cache", () => {
        const label = new Text(
          `Cached theme: ${ctx.ui.theme.name}:${ctx.ui.theme.appearance}`,
        );
        const invalidate = label.invalidate.bind(label);
        label.invalidate = () => {
          label.setText(
            `Cached theme: ${ctx.ui.theme.name}:${ctx.ui.theme.appearance}`,
          );
          invalidate();
        };
        return label;
      });
    },
  });
  pi.registerCommand("component-invalidate-probe", {
    description: "Original root cache invalidation",
    handler: async (_args, ctx) => {
      await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        let value = "Initial cache";
        const root = new Container();
        const label = new Text(value);
        const invalidate = label.invalidate.bind(label);
        label.invalidate = () => {
          label.setText(value);
          invalidate();
        };
        const input = new Input();
        input.onSubmit = (text) => {
          if (text === "close") return done();
          value = text;
          tui.invalidate();
          input.setValue("");
          tui.renderNow();
        };
        root.addChild(label);
        root.addChild(input);
        return root;
      });
    },
  });
  let registeredTui;
  pi.registerCommand("registered-tui-resume", {
    description: "Resume the original registered TUI fixture",
    handler: () => registeredTui?.start(),
  });
  pi.registerCommand("registered-tui-probe", {
    description:
      "Original TUI registered children and hosted component lifecycle",
    handler: async (mode, ctx) => {
      const counts = { field: 0, wrapper: 0, label: 0, root: 0, inputs: 0 };
      const report = () =>
        ctx.ui.setStatus("registered-tui", JSON.stringify(counts));
      const result = await withListeners(
        ctx.ui,
        (tui, _theme, _keys, done) => {
          registeredTui = tui;
          const application = [...tui.children];
          const root = new Container();
          const label = new Text("Registered branch", 0, 0);
          const field = new Input({ prompt: "Registered field" });
          field.dispose = () => {
            counts.field++;
            report();
          };
          if (mode === "immutable") {
            Object.defineProperty(field, "dispose", {
              value: field.dispose,
              configurable: false,
              writable: false,
            });
            const handleInput = field.handleInput;
            field.handleInput = (data) => {
              counts.inputs++;
              handleInput.call(field, data);
              report();
            };
          }
          label.dispose = () => {
            counts.label++;
            report();
          };
          const wrapper =
            mode === "terminal"
              ? {
                  render: () => [`Registered terminal: ${field.getValue()}`],
                  invalidate() {},
                  handleInput(data) {
                    counts.inputs++;
                    field.handleInput(data);
                    report();
                  },
                  dispose() {
                    counts.wrapper++;
                    field.dispose();
                    report();
                  },
                }
              : {
                  body: field,
                  render: (width) => field.render(width),
                  invalidate: () => field.invalidate(),
                  handleInput(data) {
                    counts.inputs++;
                    field.handleInput(data);
                    report();
                  },
                  dispose() {
                    counts.wrapper++;
                    field.dispose();
                    report();
                  },
                };
          tui.addChild(label);
          tui.addChild(wrapper);
          if (mode === "duplicates") tui.addChild(wrapper);
          root.addChild(new Text("Hosted registration root", 0, 0));
          if (mode === "shared") root.addChild(wrapper);
          if (mode === "immutable") root.addChild(field);
          const command = new Input({ prompt: "Registration command" });
          command.onSubmit = (value) => {
            command.setValue("");
            if (value === "remove") tui.removeChild(wrapper);
            else if (value === "add") tui.addChild(wrapper);
            else if (value === "direct")
              tui.children = [...application, label, wrapper];
            else if (value === "clear") tui.clear();
            else if (value === "focus")
              tui.setFocus(mode === "terminal" ? wrapper : field);
            else if (value === "pause") {
              field.setValue("Paused original state");
              tui.stop();
            } else return done(value);
            report();
            tui.renderNow();
          };
          root.addChild(command);
          root.dispose = () => {
            tui.children = application;
            counts.root++;
            if (mode !== "immutable")
              for (const child of root.children) child.dispose?.();
            report();
          };
          tui.setFocus(mode === "terminal" ? wrapper : field);
          report();
          return root;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "60%",
            anchor: "top-right",
            nonCapturing: true,
          },
        },
      );
      report();
      ctx.ui.setStatus("registered-tui-result", `${mode}:${result}`);
    },
  });
  pi.registerCommand("component-cleanup-probe", {
    description:
      "Original component cleanup errors retain the result and child cleanup",
    handler: async (_args, ctx) => {
      let disposals = 0;
      const result = await withListeners(
        ctx.ui,
        (_tui, _theme, _keys, done) => {
          const root = new Container();
          const input = new Input();
          input.onSubmit = (value) => done(value);
          input.dispose = () => {
            disposals++;
          };
          root.addChild(new Text("Cleanup error probe"));
          root.addChild(input);
          root.dispose = () => {
            throw new Error("Original component cleanup failed");
          };
          return root;
        },
      );
      ctx.ui.setStatus("component-cleanup", `${result}:${disposals}`);
    },
  });
  pi.registerCommand("component-appearance-probe", {
    description: "Original TUI color query and appearance subscription",
    handler: async (_args, ctx) => {
      let calls = 0;
      await withListeners(ctx.ui, async (tui, _theme, _keys, done) => {
        const colors = await tui.queryTerminalColors({ timeoutMs: 1000 });
        const label = new Text(`Color query: ${JSON.stringify(colors)}`);
        const input = new Input();
        const root = new Container();
        root.addChild(label);
        root.addChild(input);
        const off = tui.onTerminalColorSchemeChange((scheme) => {
          label.setText(`Appearance: ${scheme}; callbacks: ${++calls}`);
          ctx.ui.setStatus("component-appearance", `${scheme}:${calls}`);
          tui.requestRender();
        });
        tui.setTerminalColorSchemeNotifications(true);
        input.onSubmit = (value) => {
          if (value === "disable")
            tui.setTerminalColorSchemeNotifications(false);
          else if (value === "enable")
            tui.setTerminalColorSchemeNotifications(true);
          else if (value === "unsubscribe") off();
          else done(value);
          input.setValue("");
          tui.renderNow();
        };
        return root;
      });
    },
  });
  let lastWindowTerminal;
  pi.registerCommand("mapped-window", {
    description: "Original component window title and progress",
    handler: async (args, ctx) => {
      if (args !== "fail")
        ctx.ui.setWidget("window-progress", (tui) => {
          lastWindowTerminal = tui.terminal;
          tui.terminal.setProgress(true);
          const text = new Text("Component window progress");
          text.dispose = () => tui.terminal.setProgress(false);
          return text;
        });
      const result = await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        tui.terminal.setProgress(true);
        if (args === "fail") throw new Error("Window fixture failure");
        tui.terminal.setTitle("Mapped component window");
        const input = new Input({ prompt: "Window title" });
        input.onSubmit = (title) => {
          tui.terminal.setTitle(title);
          tui.terminal.setProgress(false);
          done(title);
        };
        input.dispose = () => tui.terminal.setProgress(false);
        return input;
      });
      ctx.ui.setStatus("window-result", result ?? "cancelled");
    },
  });
  pi.registerCommand("mapped-window-clear", {
    description:
      "Release shared progress and retain current-generation terminal callbacks",
    handler: (_args, ctx) => {
      ctx.ui.setWidget("window-progress", undefined);
      lastWindowTerminal?.setTitle("Retained window title");
      lastWindowTerminal?.setProgress(true);
      lastWindowTerminal?.setProgress(false);
      ctx.ui.setTitle("SDK window title");
    },
  });
  let sharedTui;
  pi.registerCommand("shared-tui-probe", {
    handler: (args, ctx) => {
      sharedTui?.cleanup();
      const state = { hooks: 0, events: [] };
      state.first = new Input({ prompt: "共享输入 A" });
      state.second = new Input({ prompt: "共享输入 B" });
      state.label = new Text("Shared runtime footer");
      state.report = () =>
        ctx.ui.setStatus(
          "shared-tui",
          JSON.stringify({
            same: !!state.header && state.header === state.footer,
            terminalSame:
              !!state.header &&
              state.header.terminal === state.footer?.terminal,
            first: state.first.getValue(),
            second: state.second.getValue(),
            hooks: state.hooks,
            events: state.events,
          }),
        );
      ctx.ui.setHeader((tui) => {
        state.header = tui;
        const root = new Container();
        root.addChild(new Text("Shared runtime header"));
        root.addChild(state.first);
        tui.setFocus(state.first);
        return args.trim() === "terminal"
          ? Object.freeze({
              render: (width) => root.render(width),
              invalidate: () => root.invalidate(),
              handleInput: (data) => state.first.handleInput(data),
            })
          : root;
      });
      ctx.ui.setFooter((tui) => {
        state.footer = tui;
        const root = new Container();
        root.addChild(state.label);
        root.addChild(state.second);
        state.report();
        return root;
      });
      state.cleanup = () => {
        state.off?.();
        state.overlay?.hide();
        if (state.registered) state.header?.removeChild(state.registered);
        state.header?.start();
        state.header?.terminal.setTitle("Pi Desktop");
        ctx.ui.setHeader(undefined);
        ctx.ui.setFooter(undefined);
        state.header?.requestRender();
      };
      sharedTui = state;
    },
  });
  pi.registerCommand("shared-tui-action", {
    handler: (args, ctx) => {
      const state = sharedTui;
      if (args === "transfer")
        state.off ??= state.header.addInputListener((data) => {
          state.hooks++;
          state.events.push({
            key: parseKey(data),
            phase: isKeyRelease(data) ? "release" : "press",
          });
          if (data === "x") {
            state.header.setFocus(state.second);
            return { data: "y" };
          }
        });
      else if (args === "register") {
        state.registered = new Text("Shared runtime registration");
        state.header.addChild(state.registered);
        state.header.renderNow();
      } else if (args === "retire") ctx.ui.setHeader(undefined);
      else if (args === "refresh") {
        state.label.setText("Updated from retained runtime");
        state.header.renderNow();
      } else if (args === "stop") state.header.stop();
      else if (args === "start") state.header.start();
      else if (args === "overlay") {
        state.off?.();
        state.off = undefined;
        const input = new Input({ prompt: "共享覆盖层" });
        input.onSubmit = (value) => {
          ctx.ui.setStatus("shared-tui-result", value);
          state.overlay.hide();
        };
        state.overlay = state.header.showOverlay(input, { width: 40 });
      }
      state.report();
    },
  });
  pi.registerCommand("shared-tui-cleanup", {
    handler: () => {
      sharedTui?.cleanup();
      sharedTui = undefined;
    },
  });
  let terminalState;
  pi.registerCommand("terminal-state-probe", {
    handler: (args, ctx) => {
      terminalState?.cleanup();
      const state = { events: [], colors: undefined };
      const flags = (tui) => ({
        cursor: tui?.getShowHardwareCursor(),
        shrink: tui?.getClearOnShrink(),
      });
      state.report = () =>
        ctx.ui.setStatus(
          "terminal-state",
          JSON.stringify({
            events: state.events,
            colors: state.colors,
            header: flags(state.header),
            footer: flags(state.footer),
          }),
        );
      ctx.ui.setHeader((tui) => {
        state.header = tui;
        state.offHeader = tui.onTerminalColorSchemeChange((scheme) => {
          state.events.push(`header:${scheme}`);
          state.report();
        });
        tui.setTerminalColorSchemeNotifications(true);
        const text = new Text("Shared terminal header");
        return args.trim() === "terminal"
          ? {
              render: () => [`Shared terminal cursor${CURSOR_MARKER}`],
              invalidate() {},
            }
          : text;
      });
      ctx.ui.setFooter((tui) => {
        state.footer = tui;
        state.offFooter = tui.onTerminalColorSchemeChange((scheme) => {
          state.events.push(`footer:${scheme}`);
          state.report();
        });
        const text = new Text("Shared terminal footer");
        const render = text.render.bind(text);
        text.render = (width) => {
          text.setText(
            `Shared terminal footer: cursor=${tui.getShowHardwareCursor()}, shrink=${tui.getClearOnShrink()}`,
          );
          return render(width);
        };
        state.report();
        return text;
      });
      state.cleanup = () => {
        state.offHeader?.();
        state.offFooter?.();
        state.footer?.setTerminalColorSchemeNotifications(false);
        state.footer?.setShowHardwareCursor(false);
        state.footer?.setClearOnShrink(false);
        state.footer?.terminal.setProgress(false);
        state.footer?.terminal.setTitle("Pi Desktop");
        ctx.ui.setHeader(undefined);
        ctx.ui.setFooter(undefined);
      };
      terminalState = state;
    },
  });
  pi.registerCommand("terminal-state-action", {
    handler: async (args, ctx) => {
      const state = terminalState;
      if (args === "enable") {
        state.header.setShowHardwareCursor(true);
        state.header.setClearOnShrink(true);
        state.header.requestRender();
      } else if (args === "silence")
        state.footer.setTerminalColorSchemeNotifications(false);
      else if (args === "listen")
        state.header.setTerminalColorSchemeNotifications(true);
      else if (args === "progress") {
        state.header.terminal.setProgress(true);
        state.footer.terminal.setProgress(false);
      } else if (args === "retire") {
        ctx.ui.setHeader(undefined);
        state.header.terminal.setTitle("Retained terminal state");
        state.header.terminal.setProgress(true);
        state.header.setShowHardwareCursor(false);
        state.header.setClearOnShrink(false);
      } else if (args === "query") {
        state.colors = await state.header.queryTerminalColors({
          timeoutMs: 1000,
        });
      }
      state.report();
    },
  });
  pi.registerCommand("terminal-state-cleanup", {
    handler: () => {
      terminalState?.cleanup();
      terminalState = undefined;
    },
  });
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setHeader(() => new Text("Component library fixture"));
    ctx.ui.setFooter(
      (_tui, _theme, data) =>
        new (class extends Text {
          render(width) {
            this.setText(
              `Branch: ${data.getGitBranch() ?? "none"} | ${[...data.getExtensionStatuses()].map(([key, value]) => `${key}=${value}`).join(" | ")}`,
            );
            return super.render(width);
          }
        })(),
    );
  });
  pi.registerCommand("mapped-form", {
    description: "Standard component form",
    handler: async (_args, ctx) => {
      const result = await withListeners(ctx.ui, (tui, _theme, keys, done) => {
        const root = new Container();
        const status = new Text("Original factory");
        const input = new (class extends Input {
          handleInput(data) {
            if (
              this.getValue() === "shortcut-probe" &&
              ["\x01", "\x1b[1;2D"].includes(data)
            ) {
              this.setValue("shortcut handled");
              return;
            }
            if (
              keys.matches(data, "tui.editor.deleteCharBackward") ||
              keys.matches(data, "tui.editor.deleteCharForward")
            ) {
              ctx.ui.setStatus("form-input-delete", this.getValue());
              if (this.getValue() === "protected") return;
            }
            super.handleInput(data);
          }
        })({ prompt: "Name", placeholder: "Task name" });
        input.onSubmit = (value) => {
          status.setText(`Input submitted: ${value}`);
          tui.requestRender();
        };
        const editor = new Editor(tui, {
          borderColor: identity,
          selectList: listTheme,
        });
        editor.onSubmit = (value) => {
          status.setText(`Editor submitted: ${value}`);
          tui.requestRender();
        };
        const select = new SelectList(
          [
            { value: "low", label: "Low", description: "Low priority" },
            { value: "high", label: "High", description: "High priority" },
          ],
          5,
          listTheme,
        );
        select.onSelect = (item) =>
          done({
            name: input.getValue(),
            notes: editor.getText(),
            priority: item.value,
          });
        select.onSelectionChange = (item) => {
          ctx.ui.setStatus("selection", item.value);
        };
        select.onCancel = () => done();
        const box = new Box(1, 0);
        box.addChild(
          new HStack(
            [
              { component: input, grow: 1, minSize: 10 },
              {
                component: new TruncatedText("Standard components"),
                basis: 20,
                visible: (viewport) => viewport.width >= 80,
              },
            ],
            { gap: 2, align: "start" },
          ),
        );
        const lines = new VStack(
          [
            new Markdown("**Native mapping**", 0, 0, markdownTheme),
            new Spacer(1),
            ...Array.from(
              { length: 30 },
              (_, index) => new Text(`Row ${index + 1}`),
            ),
          ],
          { gap: 0 },
        );
        const scroll = new ScrollView(lines, {
          follow: "end",
          scrollbar: "auto",
          overscroll: "contain",
        });
        const region = new MouseRegion(new Text("Pointer area"), (event) => {
          ctx.ui.setStatus("pointer", JSON.stringify(event));
          return { handled: true };
        });
        root.addChild(status);
        root.addChild(new DynamicBorder(identity));
        root.addChild(box);
        root.addChild(editor);
        root.addChild(select);
        root.addChild(region);
        root.addChild(scroll);
        root.addChild(
          new Image(
            png,
            "image/png",
            { fallbackColor: identity },
            { filename: "fixture.png" },
          ),
        );
        let rootDisposals = 0,
          inputDisposals = 0;
        input.dispose = () =>
          ctx.ui.setStatus("input-disposed", String(++inputDisposals));
        root.dispose = () => {
          input.dispose();
          ctx.ui.setStatus("root-disposed", String(++rootDisposals));
        };
        ctx.ui.setStatus(
          "factory-keys",
          String(keys.getKeys("app.model.select").length > 0),
        );
        return root;
      });
      ctx.ui.setStatus("form-result", JSON.stringify(result ?? null));
    },
  });
  pi.registerCommand("mapped-settings", {
    description: "Standard settings",
    handler: async (_args, ctx) => {
      await withListeners(
        ctx.ui,
        (_tui, _theme, _keys, done) =>
          new SettingsList(
            [
              {
                id: "mode:choice",
                label: "Mode",
                currentValue: "compact",
                values: ["compact", "expanded"],
              },
              {
                id: "nested:choice",
                label: "Nested",
                currentValue: "one",
                submenu: (_current, close) => {
                  const select = new SelectList(
                    [
                      { value: "one", label: "One" },
                      { value: "two", label: "Two" },
                    ],
                    5,
                    listTheme,
                  );
                  select.onSelect = (item) => close(item.value);
                  select.onCancel = () => close();
                  return select;
                },
              },
              {
                id: "unsupported",
                label: "Unsupported",
                currentValue: "",
                submenu: () => ({
                  render: () => ["custom drawing"],
                  invalidate() {},
                }),
              },
            ],
            10,
            settingsTheme,
            (id, value) => ctx.ui.setStatus("setting-result", `${id}=${value}`),
            () => done(),
            { enableSearch: true },
          ),
      );
    },
  });
  pi.registerCommand("mapped-overlays", {
    description: "Direct nested TUI overlays",
    handler: async (_args, ctx) => {
      const result = await withListeners(
        ctx.ui,
        async (tui, _theme, _keys, done) => {
          const first = new Input({ prompt: "First nested input" });
          const firstHandle = tui.showOverlay(first, {
            width: "75%",
            maxHeight: 10,
            anchor: "top-left",
            margin: 2,
          });
          const answers = await new Promise((resolve) => {
            first.onSubmit = (firstValue) => {
              const second = new Input({ prompt: "Second nested input" });
              const secondHandle = tui.showOverlay(second, {
                width: "65%",
                maxHeight: 10,
                anchor: "bottom-right",
                margin: 2,
              });
              second.onSubmit = (secondValue) => {
                secondHandle.hide();
                firstHandle.hide();
                resolve({ first: firstValue, second: secondValue });
              };
            };
          });
          const parent = new Input({ prompt: "Parent confirmation" });
          parent.onSubmit = (confirmation) =>
            done({ ...answers, confirmation });
          return parent;
        },
      );
      ctx.ui.setStatus("nested-overlay-result", JSON.stringify(result ?? null));
    },
  });
  pi.registerCommand("mapped-pointer", {
    description: "Standard component pointer semantics",
    handler: async (_args, ctx) => {
      ctx.ui.setFooter(() => new Text("Pointer component workflow", 0, 0));
      await withListeners(ctx.ui, (_tui, _theme, _keys, done) => {
        const root = new Container();
        const records = [],
          parentEvents = [],
          childEvents = [],
          ignoredEvents = [];
        const captured = new (class extends Text {
          focused = false;
          handleMouse(event) {
            records.push({
              type: event.type,
              x: event.x,
              y: event.y,
              outside:
                event.x < 0 ||
                event.y < 0 ||
                event.x >= event.width ||
                event.y >= event.height,
            });
            ctx.ui.setStatus(
              "mapped-pointer-events",
              JSON.stringify(records.slice(-8)),
            );
            return {
              handled: true,
              capture: event.type === "press",
              focus: event.type === "press",
              render: false,
            };
          }
          handleInput(data) {
            ctx.ui.setStatus("mapped-pointer-key", data);
          }
        })("Captured pointer", 0, 0);
        const bubble = new MouseRegion(
          new MouseRegion(new Text("Bubbling pointer", 0, 0), (event) => {
            childEvents.push(event.type);
            ctx.ui.setStatus(
              "mapped-pointer-child",
              JSON.stringify(childEvents.slice(-8)),
            );
            return undefined;
          }),
          (event) => {
            parentEvents.push(event.type);
            ctx.ui.setStatus(
              "mapped-pointer-parent",
              JSON.stringify(parentEvents.slice(-8)),
            );
            return { handled: true };
          },
        );
        const ignored = new MouseRegion(
          new Text("Ignored pointer", 0, 0),
          (event) => {
            ignoredEvents.push(event.type);
            ctx.ui.setStatus(
              "mapped-pointer-ignored",
              JSON.stringify(ignoredEvents.slice(-8)),
            );
            return undefined;
          },
        );
        const close = new SelectList(
          [{ value: "close", label: "Close pointer workflow" }],
          3,
          listTheme,
        );
        close.onSelect = close.onCancel = () => done();
        root.addChild(new Text("Pointer mapping", 0, 0));
        root.addChild(captured);
        root.addChild(bubble);
        root.addChild(ignored);
        root.addChild(close);
        return root;
      });
    },
  });
  pi.registerCommand("mapped-native-pointer", {
    description: "Custom mouse handlers on standard native form components",
    handler: async (_args, ctx) => {
      ctx.ui.setFooter(() => new Text("Native pointer workflow", 0, 0));
      await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
        const root = new Container();
        const record = (key, event) => {
          const events = (histories[key] ??= []);
          events.push(event.type);
          ctx.ui.setStatus(key, JSON.stringify(events.slice(-20)));
        };
        const histories = {};
        const input = new (class extends Input {
          handleMouse(event) {
            record("native-input-pointer", event);
            if (event.type === "press" && event.button === "right") {
              this.setValue("Original mouse override");
              super.handleInput("\x1b[F");
              return { handled: true, focus: true, render: false };
            }
            if (event.type === "wheel") {
              super.handleInput("\x1b[D");
              return { handled: true, focus: true, render: false };
            }
            return super.handleMouse(event);
          }
        })({ prompt: "Pointer name" });
        input.setValue("Native input selection");
        let submissions = 0;
        input.onSubmit = () =>
          ctx.ui.setStatus("native-input-submit", String(++submissions));
        const editor = new (class extends Editor {
          handleMouse(event) {
            record("native-editor-pointer", event);
            if (event.type === "wheel") {
              this.setText("Original editor mouse override");
              return { handled: true, render: false };
            }
            return super.handleMouse(event);
          }
        })(tui, { borderColor: identity, selectList: listTheme });
        editor.setText("Native textarea selection");
        const select = new (class extends SelectList {
          handleMouse(event) {
            record("native-select-pointer", event);
            return super.handleMouse(event);
          }
        })(
          [
            { value: "low", label: "Pointer low" },
            { value: "high", label: "Pointer high" },
            ...Array.from({ length: 30 }, (_, index) => ({
              value: `extra-${index + 1}`,
              label: `Pointer option ${index + 1}`,
            })),
          ],
          5,
          listTheme,
        );
        let changes = 0,
          selections = 0;
        select.onSelectionChange = (item) =>
          ctx.ui.setStatus(
            "native-select-change",
            JSON.stringify({ value: item.value, count: ++changes }),
          );
        select.onSelect = (item) =>
          ctx.ui.setStatus(
            "native-select-submit",
            JSON.stringify({ value: item.value, count: ++selections }),
          );
        const close = new SelectList(
          [{ value: "close", label: "Close native pointer workflow" }],
          3,
          listTheme,
        );
        close.onSelect = close.onCancel = () => done();
        root.addChild(input);
        root.addChild(editor);
        root.addChild(select);
        root.addChild(close);
        return root;
      });
    },
  });
  pi.registerCommand("mapped-native-regions", {
    description: "Standard native controls inside original mouse containers",
    handler: async (_args, ctx) => {
      await withListeners(ctx.ui, (_tui, _theme, _keys, done) => {
        const history = {};
        const record = (key, event) => {
          (history[key] ??= []).push(event.type);
          ctx.ui.setStatus(key, JSON.stringify(history[key].slice(-30)));
        };
        const root = new (class extends Container {
          handleMouse(event) {
            record("native-container-pointer", event);
            return super.handleMouse(event);
          }
        })();
        const input = new (class extends Input {
          handleMouse(event) {
            record("native-capture-pointer", event);
            if (event.type === "press" && event.button === "middle")
              return {
                handled: true,
                capture: true,
                focus: true,
                render: false,
              };
            if (event.type === "drag" && event.button === "middle") {
              if (
                event.x < 0 ||
                event.y < 0 ||
                event.x >= event.width ||
                event.y >= event.height
              ) {
                this.setValue("Native captured outside");
                super.handleInput("\x1b[F");
              }
              return { handled: true, render: false };
            }
            return super.handleMouse(event);
          }
        })({ prompt: "Nested pointer name" });
        input.setValue("Native nested selection");
        const inner = new MouseRegion(input, (event) => {
          record("native-inner-region", event);
          return undefined;
        });
        const box = new Box(2, 1);
        box.addChild(new Text("Native nested pointer", 0, 0));
        box.addChild(inner);
        root.addChild(
          new MouseRegion(box, (event) => {
            record("native-outer-region", event);
            if (event.type === "wheel") {
              input.setValue("Parent wheel override");
              input.handleInput("\x1b[F");
              return { handled: true, render: false };
            }
          }),
        );
        const settings = new (class extends SettingsList {
          handleMouse(event) {
            record("native-settings-pointer", event);
            return super.handleMouse(event);
          }
        })(
          [
            {
              id: "mode:choice",
              label: "Mode",
              currentValue: "compact",
              values: ["compact", "expanded"],
            },
            {
              id: "nested:choice",
              label: "Nested",
              currentValue: "one",
              submenu: (value, close) => {
                const list = new SelectList(
                  [
                    { value: "one", label: "Nested one" },
                    { value: "two", label: "Nested two" },
                  ],
                  5,
                  listTheme,
                );
                list.setSelectedIndex(value === "two" ? 1 : 0);
                list.onSelect = (item) => close(item.value);
                list.onCancel = () => close();
                return list;
              },
            },
          ],
          5,
          settingsTheme,
          (id, value) => {
            ctx.ui.setStatus(
              "native-settings-change",
              JSON.stringify({
                id,
                value,
                count: (history.changes = (history.changes ?? 0) + 1),
              }),
            );
          },
          () => done(),
          { enableSearch: true },
        );
        root.addChild(settings);
        return root;
      });
    },
  });
  pi.registerCommand("mapped-layout-pointer", {
    description: "Original pointer handlers in horizontal and clipped layouts",
    handler: async (_args, ctx) => {
      await withListeners(ctx.ui, (_tui, _theme, _keys, done) => {
        const records = {};
        const record = (key, event) => {
          (records[key] ??= []).push({
            type: event.type,
            x: event.x,
            y: event.y,
            width: event.width,
            height: event.height,
          });
          ctx.ui.setStatus(key, JSON.stringify(records[key].slice(-20)));
        };
        const root = new (class extends Container {
          handleMouse(event) {
            record("layout-root-pointer", event);
            return super.handleMouse(event);
          }
        })();
        const field = (name) =>
          new (class extends Input {
            constructor() {
              super({ prompt: `${name} column` });
              this.setValue(`${name} value`);
            }
            handleMouse(event) {
              record(`layout-${name}-pointer`, event);
              if (event.type === "wheel") {
                this.setValue(`${name} original wheel`);
                super.handleInput("\x1b[F");
                return { handled: true, render: false };
              }
              return super.handleMouse(event);
            }
          })();
        const left = field("Left"),
          right = field("Right");
        root.addChild(
          new HStack(
            [
              { component: left, grow: 1, minSize: 8 },
              { component: right, grow: 1, minSize: 8 },
            ],
            { gap: 2, align: "center" },
          ),
        );
        const shared = new Text("Shared layout target", 0, 0);
        shared.handleMouse = (event) => {
          record("layout-shared-pointer", event);
          return { handled: true, render: false };
        };
        root.addChild(
          new HStack(
            [
              { component: shared, grow: 1 },
              { component: shared, grow: 1 },
            ],
            { gap: 2 },
          ),
        );
        const scroll = new ScrollView(
          new VStack(
            Array.from({ length: 12 }, (_, index) => {
              const child = new Text(`Clipped layout row ${index + 1}`, 0, 0);
              child.handleMouse = (event) => {
                record(`layout-row-${index + 1}-pointer`, event);
                ctx.ui.setStatus(
                  "layout-scroll-state",
                  JSON.stringify({
                    top: scroll.scrollTop,
                    viewport: scroll.viewportHeight,
                  }),
                );
                return { handled: true, render: false };
              };
              return child;
            }),
            { gap: 2 },
          ),
        );
        root.addChild(scroll);
        const close = new SelectList(
          [{ value: "close", label: "Close layout pointer workflow" }],
          3,
          listTheme,
        );
        close.onSelect = close.onCancel = () => done();
        root.addChild(close);
        return root;
      });
    },
  });
  pi.registerCommand("mapped-bordered-loader", {
    description: "SDK loader composition",
    handler: async (_args, ctx) => {
      await withListeners(ctx.ui, (tui, theme, _keys, done) => {
        const loader = new BorderedLoader(tui, theme, "Mapped SDK loader");
        loader.onAbort = () => {
          ctx.ui.setStatus(
            "bordered-loader-aborted",
            String(loader.signal.aborted),
          );
          done();
        };
        return loader;
      });
    },
  });
  for (const cancellable of [false, true])
    pi.registerCommand(cancellable ? "mapped-cancel-loader" : "mapped-loader", {
      description: "Standard loader",
      handler: async (_args, ctx) => {
        await withListeners(ctx.ui, (tui, _theme, _keys, done) => {
          const loader = cancellable
            ? new CancellableLoader(tui, identity, identity, "Original loader")
            : new Loader(tui, identity, identity, "Original loader");
          if (cancellable) {
            loader.onAbort = () => {
              ctx.ui.setStatus("loader-aborted", String(loader.signal.aborted));
              done();
            };
            loader.signal.addEventListener("abort", () =>
              ctx.ui.setStatus("loader-signal", "aborted"),
            );
          }
          return loader;
        });
      },
    });
  pi.registerCommand("mapped-editor", {
    description: "Standard custom editor",
    handler: async (_args, ctx) => {
      ctx.ui.setEditorComponent(
        (tui, theme, keys) =>
          new (class extends CustomEditor {
            constructor() {
              super(tui, theme, keys);
              this.onChange = (value) =>
                ctx.ui.setStatus("editor-change", value);
            }
            handleInput(data) {
              if (
                keys.matches(data, "tui.editor.deleteCharBackward") ||
                keys.matches(data, "tui.editor.deleteCharForward")
              ) {
                ctx.ui.setStatus("editor-delete", this.getText());
                if (this.getText() === "protected") return;
              }
              super.handleInput(data === "!" ? "mapped" : data);
            }
          })(),
      );
    },
  });
  pi.registerCommand("mapped-unsupported", {
    description: "Render-only boundary",
    handler: async (_args, ctx) => {
      let value = "";
      const result = await withListeners(
        ctx.ui,
        (tui, _theme, _keys, done) => ({
          render: () => ["custom character art: " + value],
          handleInput(data) {
            if (data === "\r") {
              done(value);
              return;
            }
            value += data;
            ctx.ui.setStatus("terminal-fallback", value);
            tui.requestRender();
          },
          invalidate() {},
        }),
      );
      ctx.ui.setStatus("terminal-fallback-result", result);
    },
  });
  pi.registerMessageRenderer(
    "mapped-message",
    (message) => new Text(`Original message: ${message.content}`),
  );
  pi.registerCommand("mapped-message", {
    description: "Standard message renderer",
    handler: async () =>
      pi.sendMessage({
        customType: "mapped-message",
        content: "library renderer",
        display: true,
      }),
  });
}
