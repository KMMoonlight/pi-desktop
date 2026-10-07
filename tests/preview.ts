import { createFixture } from "./fixture.ts";

const fixture = await createFixture({
  officialQuestions: true,
  officialWorkflows: ["todo", "qna", "message-renderer"],
  extractionDelayMs: 1200,
  componentLibrary: true,
  terminalSupport: true,
  transcriptMarkdown: true,
  transcriptPolicy: true,
  toolContext: true,
  toolShell: true,
  toolDisplay: true,
  transcriptRenderers: true,
});
process.env.PI_DESKTOP_AGENT_DIR = fixture.agentDir;
process.env.PI_DESKTOP_LEGACY_EXAMPLE_ADAPTERS ??= "1";
process.env.PI_CODING_AGENT_DIR = fixture.agentDir;
process.env.PI_DESKTOP_CWD = fixture.cwd;
await import("../backend/server.ts");
process.on("exit", () => {
  void fixture.close();
});
