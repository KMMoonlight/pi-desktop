import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { DesktopAdapterContext } from "./desktop-ui.ts";
import { createMappedComponent } from "./component-mapping.ts";
import {
  loadComponentRuntime,
  componentField,
  callComponentMethod,
} from "./component-runtime.ts";
import type { TerminalRuntimeScope } from "./terminal-runtime.ts";
import type { DesktopAutocompleteProvider } from "./autocomplete.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

/** Pi retains the default editor while an extension supplies a replacement. */
export class DefaultEditorSource {
  private editors = new WeakMap<TerminalRuntimeScope, CustomEditor>();

  applySettings(
    scope: TerminalRuntimeScope,
    context: DesktopAdapterContext["sdk"],
  ) {
    const editor = this.editors.get(scope);
    if (!editor) return;
    const keys = componentField(editor, "keybindings") as object;
    callComponentMethod(keys, "reload");
    editor.setPaddingX(context.settingsManager.getEditorPaddingX());
    editor.setAutocompleteMaxVisible(
      context.settingsManager.getAutocompleteMaxVisible(),
    );
  }

  setAutocompleteProvider(
    scope: TerminalRuntimeScope,
    provider: DesktopAutocompleteProvider,
  ) {
    this.editors.get(scope)?.setAutocompleteProvider(provider);
  }

  async create(context: DesktopAdapterContext) {
    const { sdk, terminalRuntime } = context;
    let editor = this.editors.get(terminalRuntime);
    const initializeHistory = !editor;
    if (!editor) {
      const runtime = await loadComponentRuntime();
      editor = new sdk.sdk.CustomEditor(
        terminalRuntime.tui,
        {
          borderColor: (text) =>
            sdk.host.session.extensionRunner
              .getUIContext()
              .theme.fg("border", text),
          selectList: sdk.sdk.getSelectListTheme(),
        },
        runtime.keys.KeybindingsManager.create(sdk.host.agentDir),
        {
          paddingX: sdk.settingsManager.getEditorPaddingX(),
          autocompleteMaxVisible:
            sdk.settingsManager.getAutocompleteMaxVisible(),
          embedWorkingStatus: true,
        },
      );
      this.editors.set(terminalRuntime, editor);
    }
    if (sdk.host.autocompleteProvider)
      editor.setAutocompleteProvider(sdk.host.autocompleteProvider);
    const mapped = await createMappedComponent(
      { ...context, source: editor },
      { initializeHistory },
    );
    const nativeView = mapped.view.bind(mapped);
    const composerView = (node: DesktopNode): DesktopNode => {
      if (node.kind === "textarea") return { ...node, appearance: "composer" };
      if ("children" in node)
        return { ...node, children: node.children.map(composerView) };
      if (node.kind === "region")
        return { ...node, child: composerView(node.child) };
      return node;
    };
    mapped.view = () => composerView(nativeView());
    // Keep the former desktop transport aliases for callers which manipulate
    // the default editor directly. DOM controls use the generic mapping IDs.
    mapped.resolveAction = (alias) => {
      if (alias !== "text" && alias !== "selection") return alias;
      const find = (
        node: ReturnType<typeof mapped.view>,
      ): string | undefined => {
        if (node.kind === "textarea")
          return alias === "selection" ? node.selectionAction : node.action;
        if ("children" in node)
          for (const child of node.children) {
            const action = find(child);
            if (action) return action;
          }
        if (node.kind === "region") return find(node.child);
      };
      return find(mapped.view()) ?? alias;
    };
    return mapped;
  }
}
