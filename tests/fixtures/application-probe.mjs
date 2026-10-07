const states = new WeakMap();
const children = (object) => Reflect.get(object, "children") ?? [];
export default async function (
  { host, sdk, desktop, session },
  { action = "inspect" } = {},
) {
  const scope = desktop.terminalRuntime.capture(),
    application = scope.application;
  let state = states.get(host);
  if (!state || state.scope !== scope)
    states.set(
      host,
      (state = {
        scope,
        defaultFooter: application.footer,
        defaultEditor: desktop.nativeComponent("editor"),
        providers: [],
      }),
    );
  const ui = session.extensionRunner.getUIContext();
  if (action === "custom-footer") {
    let component;
    ui.setFooter((_tui, _theme, provider) => {
      state.providers.push(provider);
      return (component = new sdk.FooterComponent(session, provider));
    });
    const deadline = Date.now() + 10000;
    while (!component || desktop.nativeComponent("footer") !== component) {
      if (Date.now() > deadline)
        throw new Error("Original footer did not mount");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (action === "restore-footer") ui.setFooter(undefined);
  if (action === "status") {
    ui.setStatus("native-application", "Native footer status");
    ui.setWorkingMessage("Native application working");
    ui.setWorkingIndicator({ frames: ["one", "two"], intervalMs: 300 });
  }
  if (action === "hide") ui.setWorkingVisible(false);
  if (action === "show") ui.setWorkingVisible(true);
  if (action === "plain-editor" || action === "restore-editor") {
    let component;
    ui.setEditorComponent(
      action === "restore-editor"
        ? undefined
        : (tui, theme, keys) =>
            (component = new sdk.CustomEditor(tui, theme, keys, {
              embedWorkingStatus: false,
            })),
    );
    const deadline = Date.now() + 10000;
    while (
      action === "restore-editor"
        ? desktop.nativeComponent("editor") !== state.defaultEditor
        : !component || desktop.nativeComponent("editor") !== component
    ) {
      if (Date.now() > deadline)
        throw new Error("Original editor did not mount");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  host.snapshot();
  const tui = scope.tui,
    chat = children(children(tui.children[0])[2]),
    editor = desktop.nativeComponent("editor");
  const status =
    Reflect.get(editor, "workingStatusIndicator") ??
    children(tui.children[2]).find((component) => "kind" in component);
  if (action === "mutate") {
    const assistant = chat.find(
      (component) => component instanceof sdk.AssistantMessageComponent,
    );
    if (!assistant) throw new Error("Original assistant is unavailable");
    assistant.setOutputPad(4);
    host.snapshot();
  }
  return {
    messages: chat.map((component) => component.constructor.name),
    nativeAssistantPadding: chat
      .filter((component) => component instanceof sdk.AssistantMessageComponent)
      .map((component) => Reflect.get(component, "outputPad")),
    footerOriginal: children(tui.children[6]).includes(state.defaultFooter),
    footerClass: state.defaultFooter.constructor.name,
    footerRestored: application.footer === state.defaultFooter,
    providersShared: state.providers.every(
      (provider) => provider === application.footerData,
    ),
    providerCount: state.providers.length,
    footerText: application.footer.render(120).join("\n"),
    statuses: Object.fromEntries(application.footerData.getExtensionStatuses()),
    workingKind: status?.kind,
    workingInEditor: !!Reflect.get(editor, "workingStatusIndicator"),
    workingInStatus: children(tui.children[2]).some(
      (component) => component === status,
    ),
    indicatorInterval: status && Reflect.get(status, "intervalMs"),
    originalDefaultEditor: editor === state.defaultEditor,
  };
}
