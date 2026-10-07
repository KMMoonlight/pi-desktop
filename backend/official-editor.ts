import type {
  Extension,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { DesktopUIRegistry } from "./desktop-ui.ts";
import { createNativeEditor } from "./native-editor.ts";

type EditorFactory = NonNullable<
  Parameters<ExtensionUIContext["setEditorComponent"]>[0]
>;

export function registerOfficialEditorAdapter(desktop: DesktopUIRegistry) {
  const factories = new WeakSet<EditorFactory>();
  desktop.registerAdapter({
    id: "pi:official-modal-editor",
    matches: (source, slot) =>
      slot === "editor" &&
      typeof source === "function" &&
      factories.has(source as EditorFactory),
    create: ({ sdk }) => createNativeEditor(sdk, true),
  });
  return (extension: Extension) => {
    const handlers = extension.handlers.get("session_start");
    if (!handlers) return;
    extension.handlers.set(
      "session_start",
      handlers.map((handler) => (event, context) => {
        const current = context as ExtensionContext;
        const ui = new Proxy(current.ui, {
          get: (target, key, receiver) =>
            key === "setEditorComponent"
              ? (factory: EditorFactory | undefined) => {
                  if (factory) factories.add(factory);
                  target.setEditorComponent(factory);
                }
              : Reflect.get(target, key, receiver),
        });
        const next = new Proxy(current, {
          get: (target, key, receiver) =>
            key === "ui" ? ui : Reflect.get(target, key, receiver),
        });
        return handler(event, next as ExtensionContext);
      }),
    );
  };
}
