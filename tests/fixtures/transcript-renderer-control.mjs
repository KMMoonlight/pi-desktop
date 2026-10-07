export default function (sdk, args) {
  if (args.outputPad !== undefined)
    sdk.settingsManager.setOutputPad(args.outputPad);
  if (args.codeBlockIndent !== undefined)
    sdk.settingsManager.applyOverrides({
      codeBlockIndent: args.codeBlockIndent,
    });
  if (args.expanded !== undefined)
    sdk.session.extensionRunner.getUIContext().setToolsExpanded(args.expanded);
  if (args.mode === "seed") {
    sdk.sessionManager.appendMessage({
      role: "user",
      content: "Transcript renderer fixture",
      timestamp: Date.now(),
    });
    for (const customType of [
      "receiver-message",
      "undefined-message",
      "throwing-message",
      "absent-message",
      "hidden-message",
    ]) {
      sdk.sessionManager.appendMessage({
        role: "custom",
        customType,
        content:
          customType === "throwing-message"
            ? [
                { type: "text", text: "Array fallback first" },
                { type: "image", mimeType: "image/png", data: args.image },
                { type: "text", text: "Array fallback second" },
              ]
            : `**Original ${customType}**\n\n\`\`\`js\nconst message = true;\n\`\`\``,
        display: customType !== "hidden-message",
        details: { label: "initial" },
        timestamp: Date.now(),
      });
      sdk.sessionManager.appendCustomEntry(
        customType.replace("message", "entry"),
        { label: `${customType.replace("message", "entry")} data` },
      );
    }
    for (const label of ["Collision first", "Collision second"])
      sdk.sessionManager.appendMessage({
        role: "custom",
        customType: "collision-message",
        content: label,
        details: { label },
        timestamp: 1000,
        display: true,
      });
    for (let index = 0; index < 2; index++)
      sdk.sessionManager.appendMessage({
        role: "custom",
        customType: "duplicate-message",
        content: "Duplicate raw message",
        timestamp: 2000,
        display: true,
      });
    sdk.agent.state.messages =
      sdk.sessionManager.buildSessionContext().messages;
  }
  if (args.mode === "mutate") {
    const message = sdk.session.messages.find(
      (message) =>
        message.role === "custom" && message.customType === "receiver-message",
    );
    message.details.label = args.label;
  }
  if (args.mode === "invalidate") sdk.desktop.invalidate();
  return {
    sessionFile: sdk.session.sessionFile,
    outputPad: sdk.settingsManager.getOutputPad(),
  };
}
