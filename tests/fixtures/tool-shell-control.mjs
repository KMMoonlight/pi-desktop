const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
export default async function (sdk, args) {
  if (args.expanded !== undefined)
    sdk.session.extensionRunner.getUIContext().setToolsExpanded(args.expanded);
  if (args.mode === "seed") {
    for (const variant of [
      "default_failure",
      "self_failure",
      "self_missing",
      "self_control",
      "self_empty",
    ]) {
      const name = `shell_${variant}`,
        id = `shell-${variant}`;
      sdk.sessionManager.appendMessage({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id,
            name,
            arguments: { value: "Shell argument", multiline: "first\nsecond" },
          },
        ],
        stopReason: "toolUse",
        api: "openai-completions",
        provider: "desktop-test",
        model: "desktop-test",
        usage,
        timestamp: Date.now(),
      });
      sdk.sessionManager.appendMessage({
        role: "toolResult",
        toolCallId: id,
        toolName: name,
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 14 },
              (_, i) => `Shell fallback line ${i + 1}`,
            ).join("\n"),
          },
          ...(args.image
            ? [{ type: "image", mimeType: "image/png", data: args.image }]
            : []),
        ],
        details: { original: true },
        isError: variant.includes("failure"),
        timestamp: Date.now(),
      });
    }
    sdk.agent.state.messages =
      sdk.sessionManager.buildSessionContext().messages;
  }
  if (args.mode === "partial" || args.mode === "clearPartial") {
    const tools =
      args.mode === "partial"
        ? [
            {
              id: "shell-partial",
              name: "shell_self_failure",
              arguments: { value: "Partial argument" },
              output: [{ type: "text", text: "Shell partial fallback" }],
            },
          ]
        : [];
    Reflect.set(sdk.host, "activeTools", tools);
    Reflect.set(
      sdk.host,
      "toolResults",
      new Map(
        tools.map((tool) => [tool.id, { content: tool.output, details: {} }]),
      ),
    );
  }
  if (args.mode === "state")
    return Object.fromEntries(
      args.ids.map((id) => {
        const state = sdk.desktop.toolState(id);
        return [
          id,
          {
            callReceiver: state.callReceiver,
            resultReceiver: state.resultReceiver,
            callLast: state.callLast,
            resultLast: state.resultLast,
            submitted: state.submitted,
          },
        ];
      }),
    );
  return { sessionFile: sdk.session.sessionFile };
}
