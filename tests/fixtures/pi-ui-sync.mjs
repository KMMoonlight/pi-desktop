import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default async function ({ session, host }, args) {
  if (args.action === "keys") {
    const path = join(host.agentDir, "keybindings.json");
    const keys = JSON.parse(await readFile(path, "utf8"));
    keys["tui.altScreen.top"] = "ctrl+alt+up";
    keys["tui.altScreen.bottom"] = "ctrl+alt+down";
    await writeFile(path, JSON.stringify(keys));
    return;
  }
  const usage = {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  for (let i = 0; i < 8; i++) {
    session.sessionManager.appendMessage({
      role: "user",
      content: `原生滚动测试 ${i}`,
      timestamp: Date.now(),
    });
    session.sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: `第 ${i} 轮测试内容。\n\n`.repeat(12) }],
      api: "openai-completions",
      provider: "desktop-test",
      model: "desktop-test",
      stopReason: "stop",
      timestamp: Date.now(),
      usage,
    });
  }
  session.agent.state.messages =
    session.sessionManager.buildSessionContext().messages;
}
