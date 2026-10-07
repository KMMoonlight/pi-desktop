const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const assistant = (content, stopReason = "stop", errorMessage) => ({
  role: "assistant",
  content,
  stopReason,
  ...(errorMessage !== undefined ? { errorMessage } : {}),
  api: "openai-completions",
  provider: "desktop-test",
  model: "desktop-test",
  usage,
  timestamp: Date.now(),
});

export default async function (sdk, args) {
  if (args.expanded !== undefined)
    sdk.session.extensionRunner.getUIContext().setToolsExpanded(args.expanded);
  if (args.visible !== undefined)
    sdk.settingsManager.setShowImages(args.visible);
  if (args.width !== undefined)
    sdk.settingsManager.setImageWidthCells(args.width);
  if (args.mode === "notices") {
    for (const [reason, error, tools] of [
      ["length", undefined, false],
      ["length", "ignored detail", true],
      ["aborted", "Request was aborted", false],
      ["aborted", "Policy custom abort", false],
      ["aborted", "Tool owns abort", true],
      ["error", undefined, false],
      ["error", "Policy custom error", false],
      ["error", "Tool owns error", true],
      ["stop", "No completion error", false],
    ]) {
      const content = [
        {
          type: "text",
          text: `Policy status ${reason}: ${error ?? "default"}`,
        },
      ];
      if (tools)
        content.push({
          type: "toolCall",
          id: `status-${reason}`,
          name: "policy_none",
          arguments: {},
        });
      sdk.sessionManager.appendMessage(assistant(content, reason, error));
    }
    sdk.agent.state.messages =
      sdk.sessionManager.buildSessionContext().messages;
  }
  if (args.mode === "images") {
    const image = { type: "image", mimeType: "image/png", data: args.image };
    sdk.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Policy attachment" }, image],
      timestamp: Date.now(),
    });
    for (const name of ["policy_default", "policy_rendered"]) {
      const id = `policy-${name}`;
      sdk.sessionManager.appendMessage(
        assistant([{ type: "toolCall", id, name, arguments: {} }]),
      );
      sdk.sessionManager.appendMessage({
        role: "toolResult",
        toolCallId: id,
        toolName: name,
        content: [{ type: "text", text: `Policy output ${name}` }, image],
        isError: false,
        timestamp: Date.now(),
      });
    }
    sdk.agent.state.messages =
      sdk.sessionManager.buildSessionContext().messages;
  }
  if (args.mode === "partial" || args.mode === "clearPartial") {
    const activeTools =
      args.mode === "partial"
        ? ["policy_default", "policy_rendered"].map((name) => ({
            id: `partial-${name}`,
            name,
            arguments: {},
            output: [
              { type: "text", text: "Partial policy output" },
              { type: "image", mimeType: "image/png", data: args.image },
            ],
          }))
        : [];
    Reflect.set(sdk.host, "activeTools", activeTools);
    Reflect.set(
      sdk.host,
      "toolResults",
      new Map(
        activeTools.map((tool) => [
          tool.id,
          { content: tool.output, details: {} },
        ]),
      ),
    );
  }
  return {
    visible: sdk.settingsManager.getShowImages(),
    width: sdk.settingsManager.getImageWidthCells(),
    sessionFile: sdk.session.sessionFile,
  };
}
