const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const paragraphs = (count, prefix) =>
  Array.from(
    { length: count },
    (_, index) =>
      `${prefix} ${index}: Output continues with enough text to make the conversation scroll.`,
  ).join("\n\n");
export default function (sdk, args) {
  if (args.mode === "seed" || args.mode === "turn") {
    sdk.sessionManager.appendMessage({
      role: "user",
      content:
        args.mode === "seed" ? "Scroll history" : "Continue the next turn",
      timestamp: Date.now(),
    });
    if (args.mode === "seed")
      sdk.sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: paragraphs(40, "History") }],
        api: "openai-completions",
        provider: "desktop-test",
        model: "desktop-test",
        stopReason: "stop",
        timestamp: Date.now(),
        usage,
      });
    sdk.agent.state.messages =
      sdk.sessionManager.buildSessionContext().messages;
  }
  if (args.mode === "stream")
    Reflect.set(sdk.host, "streaming", {
      id: "scroll-stream",
      role: "assistant",
      content: [{ type: "text", text: paragraphs(args.count, "Streaming") }],
      timestamp: 1,
    });
  if (args.mode === "clear") Reflect.set(sdk.host, "streaming", undefined);
  return { path: sdk.session.sessionFile };
}
