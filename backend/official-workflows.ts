import {
  BorderedLoader,
  type Extension,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import { encodeDesktopKey } from "../shared/keyboard.ts";
import { createDetachedTui } from "./detached-tui.ts";
import type { DesktopRenderSource, DesktopUIRegistry } from "./desktop-ui.ts";

export type OfficialWorkflowKind = "todo" | "qna" | "message-renderer";
interface Todo {
  id: number;
  text: string;
  done: boolean;
}
interface TodoDetails {
  action: string;
  todos: Todo[];
  nextId: number;
  error?: string;
}
type CustomFactory = Parameters<ExtensionUIContext["custom"]>[0];
type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];
type WorkflowRequest =
  | { kind: "todo"; todos: Todo[]; originalFactory: CustomFactory }
  | {
      kind: "qna";
      context: ExtensionCommandContext;
      originalFactory: CustomFactory;
    };

function withCustom<C extends ExtensionContext>(
  context: C,
  custom: ExtensionUIContext["custom"],
): C {
  const ui = new Proxy(context.ui, {
    get: (target, key, receiver) =>
      key === "custom" ? custom : Reflect.get(target, key, receiver),
  });
  return new Proxy(context, {
    get: (target, key, receiver) =>
      key === "ui" ? ui : Reflect.get(target, key, receiver),
  });
}
function todoTable(todos: Todo[]): DesktopNode {
  return {
    kind: "table",
    columns: ["ID", "Task", "State"],
    rows: todos.map((todo) => [
      String(todo.id),
      todo.text,
      todo.done ? "Completed" : "Open",
    ]),
  };
}
function copyTodos(todos: Todo[]): Todo[] {
  return todos.map((todo) => ({ ...todo }));
}
function withBranchSnapshot(context: ExtensionContext): ExtensionContext {
  const manager = new Proxy(context.sessionManager, {
    get: (target, key, receiver) =>
      key === "getBranch"
        ? () => structuredClone(target.getBranch())
        : Reflect.get(target, key, receiver),
  });
  return new Proxy(context, {
    get: (target, key, receiver) =>
      key === "sessionManager" ? manager : Reflect.get(target, key, receiver),
  });
}
function branchTodos(context: ExtensionContext): Todo[] {
  let todos: Todo[] = [];
  for (const entry of context.sessionManager.getBranch()) {
    if (
      entry.type !== "message" ||
      entry.message.role !== "toolResult" ||
      entry.message.toolName !== "todo"
    )
      continue;
    const details = entry.message.details as TodoDetails | undefined;
    if (details) todos = details.todos;
  }
  return copyTodos(todos);
}
function workflowRenderer(
  source: DesktopRenderSource,
  kind: OfficialWorkflowKind,
): DesktopNode {
  if (kind === "message-renderer") {
    const message = source.value as {
      content: string;
      details?: { level: string; timestamp: number };
    };
    const level = message.details?.level ?? "info";
    const time =
      source.context.expanded && message.details?.timestamp
        ? `\nat ${new Date(message.details.timestamp).toLocaleTimeString()}`
        : "";
    return {
      kind: "text",
      text: `[${level.toUpperCase()}] ${message.content}${time}`,
    };
  }
  const value = (source.value ?? {}) as {
    action?: string;
    text?: string;
    id?: number;
    content?: { type: string; text?: string }[];
    details?: TodoDetails;
  };
  if (source.kind === "toolCall")
    return {
      kind: "text",
      text: [
        "todo",
        value.action,
        value.text,
        value.id === undefined ? undefined : `#${value.id}`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  const details = value.details;
  if (details?.error) return { kind: "text", text: `Error: ${details.error}` };
  if (details?.action === "list" && details.todos.length) {
    const visible = source.context.expanded
      ? details.todos
      : details.todos.slice(0, 5);
    return {
      kind: "column",
      children: [
        todoTable(visible),
        ...(visible.length < details.todos.length
          ? [
              {
                kind: "text" as const,
                text: `${details.todos.length - visible.length} more`,
              },
            ]
          : []),
      ],
    };
  }
  return {
    kind: "text",
    text: (value.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n"),
  };
}

export function registerOfficialWorkflowAdapters(desktop: DesktopUIRegistry) {
  const requests = new WeakSet<object>();
  const renderers = new WeakMap<Function, OfficialWorkflowKind>();
  desktop.registerAdapter({
    id: "pi:official-workflow-ui",
    matches: (source, slot) =>
      slot === "dialog" &&
      typeof source === "object" &&
      source !== null &&
      requests.has(source),
    create: async ({ source: raw, signal, done, invalidate }) => {
      const source = raw as WorkflowRequest;
      if (source.kind === "todo")
        return {
          title: "Todos",
          view: () => ({
            kind: "column",
            children: [
              {
                kind: "text",
                text: `${source.todos.filter((todo) => todo.done).length}/${source.todos.length} completed`,
              },
              todoTable(source.todos),
              {
                kind: "button",
                action: "close",
                label: "Close",
                icon: "close",
              },
            ],
          }),
          handleAction: () => done(),
          handleKey: (event) => {
            if (
              event.key === "Escape" ||
              (event.ctrlKey && event.key.toLowerCase() === "c")
            ) {
              done();
              return true;
            }
            return false;
          },
        };
      const tui = await createDetachedTui(invalidate);
      // This audited factory ignores keybindings and starts the actual model request.
      const loader = await Reflect.apply(source.originalFactory, undefined, [
        tui,
        source.context.ui.theme,
        undefined,
        (value?: string | null) => done(value ?? null),
      ]);
      if (!(loader instanceof BorderedLoader))
        throw new Error("Unsupported Q&A loader implementation");
      const cancel = () => {
        if (!loader.signal.aborted) loader.handleInput("\x1b");
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      return {
        title: "Q&A",
        focusTarget: loader,
        view: () => ({
          kind: "column",
          children: [
            {
              kind: "progress",
              label: `Extracting questions using ${source.context.model?.id ?? ""}`,
            },
            {
              kind: "button",
              action: "cancel",
              label: "Cancel",
              icon: "close",
            },
          ],
        }),
        handleAction: cancel,
        handleKey: (event) => {
          if (
            event.key !== "Escape" &&
            !(event.ctrlKey && event.key.toLowerCase() === "c")
          )
            return false;
          loader.handleInput(encodeDesktopKey(event) ?? "\x1b");
          return true;
        },
        dispose: () => {
          signal.removeEventListener("abort", cancel);
          cancel();
          loader.dispose();
        },
      };
    },
  });
  desktop.registerAdapter({
    id: "pi:official-workflow-renderers",
    matches: (source, slot) =>
      (slot === "tool" || slot === "message") &&
      !!source &&
      renderers.has((source as DesktopRenderSource).renderer),
    create: ({ source: raw }) => {
      let source = raw as DesktopRenderSource;
      const kind = renderers.get(source.renderer)!;
      return {
        view: () => workflowRenderer(source, kind),
        handleAction: () => {},
        update: (next) => {
          source = next;
        },
      };
    },
  });
  return (extension: Extension, kind: OfficialWorkflowKind) => {
    if (kind === "message-renderer") {
      const renderer = extension.messageRenderers.get("status-update");
      if (renderer) renderers.set(renderer, kind);
      return;
    }
    let todos: Todo[] = [];
    if (kind === "todo") {
      const definition = extension.tools.get("todo")?.definition;
      if (!definition) return;
      for (const renderer of [definition.renderCall, definition.renderResult])
        if (renderer) renderers.set(renderer, kind);
      const execute = definition.execute;
      definition.execute = async function (...args) {
        const result = await execute.apply(this, args);
        const details = result.details as TodoDetails | undefined;
        if (details) todos = copyTodos(details.todos);
        // The example mutates Todo objects in place; persisted results need detached snapshots.
        return structuredClone(result);
      };
      for (const event of ["session_start", "session_tree"]) {
        const handlers = extension.handlers.get(event);
        if (handlers)
          extension.handlers.set(
            event,
            handlers.map((handler) => async (...args) => {
              const context = args[1] as ExtensionContext;
              const result = await handler(
                args[0],
                withBranchSnapshot(context),
              );
              todos = branchTodos(context);
              return result;
            }),
          );
      }
    }
    const command = extension.commands.get(kind === "todo" ? "todos" : "qna");
    if (!command) return;
    const handler = command.handler;
    command.handler = function (args, context) {
      const custom: ExtensionUIContext["custom"] = async <T>(
        originalFactory: CustomFactory,
        options?: CustomOptions,
      ) => {
        const source: WorkflowRequest =
          kind === "todo"
            ? { kind, todos: copyTodos(todos), originalFactory }
            : { kind: "qna", context, originalFactory };
        requests.add(source);
        const value = await desktop.custom(source, options);
        return (source.kind === "qna" ? (value ?? null) : value) as T;
      };
      return handler.call(this, args, withCustom(context, custom));
    };
  };
}
