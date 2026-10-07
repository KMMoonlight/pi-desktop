const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const calls = (sdk, values) =>
  sdk.sessionManager.appendMessage({
    role: "assistant",
    content: values,
    stopReason: "toolUse",
    api: "openai-completions",
    provider: "desktop-test",
    model: "desktop-test",
    usage,
    timestamp: Date.now(),
  });
const call = (name, id) => ({
  type: "toolCall",
  id,
  name,
  arguments: { value: "Display original argument" },
});
const result = (sdk, name, id, image, error = false) =>
  sdk.sessionManager.appendMessage({
    role: "toolResult",
    toolName: name,
    toolCallId: id,
    content: [
      {
        type: "text",
        text: Array.from(
          { length: 14 },
          (_, i) => `Display ${name} line ${i + 1}`,
        ).join("\n"),
      },
      ...(image ? [{ type: "image", mimeType: "image/png", data: image }] : []),
    ],
    details: { original: true },
    isError: error,
    timestamp: Date.now(),
  });

export default function (sdk, args) {
  if (args.expanded !== undefined)
    sdk.session.extensionRunner.getUIContext().setToolsExpanded(args.expanded);
  if (args.mode === "seed") {
    calls(
      sdk,
      ["fallback", "custom", "control", "self", "unknown"].map((variant) =>
        call(`display_${variant}`, `display-${variant}`),
      ),
    );
    for (const variant of ["fallback", "custom", "control", "self", "unknown"])
      result(
        sdk,
        `display_${variant}`,
        `display-${variant}`,
        variant === "fallback" ? args.image : undefined,
        variant === "fallback",
      );
    sdk.agent.state.messages =
      sdk.sessionManager.buildSessionContext().messages;
  }
  if (args.mode === "append") {
    calls(sdk, [call("display_custom", "display-later")]);
    result(sdk, "display_custom", "display-later");
    sdk.agent.state.messages =
      sdk.sessionManager.buildSessionContext().messages;
  }
  if (args.mode === "partial" || args.mode === "pending") {
    const tools = [
      {
        id: "display-partial",
        name: "display_control",
        arguments: { value: "Partial display argument" },
        ...(args.mode === "partial"
          ? { output: [{ type: "text", text: "Partial display output" }] }
          : {}),
      },
    ];
    Reflect.set(sdk.host, "activeTools", tools);
    Reflect.set(
      sdk.host,
      "toolResults",
      new Map(
        args.mode === "partial"
          ? tools.map((tool) => [
              tool.id,
              { content: tool.output, details: {} },
            ])
          : [],
      ),
    );
  }
  if (args.mode === "complete") {
    calls(sdk, [call("display_control", "display-partial")]);
    result(
      sdk,
      "display_control",
      "display-partial",
      undefined,
      args.error === true,
    );
    sdk.agent.state.messages =
      sdk.sessionManager.buildSessionContext().messages;
    Reflect.set(sdk.host, "activeTools", []);
    Reflect.set(sdk.host, "toolResults", new Map());
  }
  if (args.mode === "state") {
    return Object.fromEntries(
      args.ids.map((id) => {
        const state = sdk.desktop.toolState(id);
        return [
          id,
          {
            callExpanded: state.callExpanded,
            resultExpanded: state.resultExpanded,
            callReceiver: state.callReceiver,
            resultReceiver: state.resultReceiver,
            consumed: state.consumed ?? 0,
            submitted: state.submitted,
            disposed: state.disposed,
          },
        ];
      }),
    );
  }
  if (args.mode === "observeMouse") {
    const original = sdk.desktop.mouse;
    const completed = new Map();
    const observer = async function (...values) {
      const reply = await original.apply(this, values);
      if (values[2].type === "release")
        completed.set(values[0], (completed.get(values[0]) ?? 0) + 1);
      return reply;
    };
    sdk.desktop.mouse = observer;
    sdk.desktop.toolDisplayMouse = { original, observer, completed };
  }
  if (args.mode === "mouseState")
    return Object.fromEntries(sdk.desktop.toolDisplayMouse.completed);
  if (args.mode === "restoreMouse" && sdk.desktop.toolDisplayMouse) {
    const { original, observer } = sdk.desktop.toolDisplayMouse;
    if (sdk.desktop.mouse === observer) sdk.desktop.mouse = original;
    delete sdk.desktop.toolDisplayMouse;
  }
  return {
    sessionFile: sdk.session.sessionFile,
    globalExpanded: sdk.session.extensionRunner
      .getUIContext()
      .getToolsExpanded(),
  };
}
