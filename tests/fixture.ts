import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPackageDir, VERSION } from "@earendil-works/pi-coding-agent";
// Network policy workers opt in explicitly; ordinary fixtures stay local.
process.env.PI_DESKTOP_SKIP_STARTUP_POLICIES ??= "1";

export async function createFixture(
  options: {
    officialQuestions?: boolean;
    officialWorkflows?: ("todo" | "qna" | "message-renderer")[];
    extractionDelayMs?: number;
    titleDelayMs?: number;
    titleResponses?: string[];
    titleFailures?: number;
    officialEditor?: boolean;
    componentLibrary?: boolean;
    terminalSupport?: boolean;
    transcriptMarkdown?: boolean;
    transcriptPolicy?: boolean;
    toolContext?: boolean;
    toolShell?: boolean;
    toolDisplay?: boolean;
    transcriptRenderers?: boolean;
    modelTools?: Record<
      string,
      { name: string; args: Record<string, unknown> }
    >;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "pi-desktop-test-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  if (options.toolDisplay)
    await cp(
      new URL("./fixtures/tool-display-extension.mjs", import.meta.url),
      join(agentDir, "extensions", "renamed-tool-display.ts"),
    );
  if (options.transcriptRenderers)
    await cp(
      new URL("./fixtures/transcript-renderer-extension.mjs", import.meta.url),
      join(agentDir, "extensions", "renamed-transcript-renderers.ts"),
    );
  if (options.toolShell) {
    await cp(
      new URL("./fixtures/tool-shell-extension.mjs", import.meta.url),
      join(agentDir, "extensions", "renamed-tool-shell.ts"),
    );
  }
  if (options.toolContext) {
    await cp(
      new URL("./fixtures/tool-context-extension.mjs", import.meta.url),
      join(agentDir, "extensions", "user-tool-context.ts"),
    );
  }
  if (options.transcriptPolicy)
    await cp(
      new URL("./fixtures/transcript-policy-extension.mjs", import.meta.url),
      join(agentDir, "extensions", "user-policy-tools.ts"),
    );
  if (options.transcriptMarkdown)
    await cp(
      new URL("./fixtures/transcript-markdown.mjs", import.meta.url),
      join(agentDir, "extensions", "transcript-markdown.ts"),
    );
  if (options.terminalSupport) {
    await cp(
      new URL("./fixtures/terminal.mjs", import.meta.url),
      join(agentDir, "extensions", "terminal-probe.ts"),
    );
    await cp(
      join(getPackageDir(), "examples", "extensions", "interactive-shell.ts"),
      join(agentDir, "extensions", "official-interactive-shell.ts"),
    );
  }
  if (options.componentLibrary)
    await cp(
      new URL("./fixtures/component-library.mjs", import.meta.url),
      join(agentDir, "extensions", "user-component-library.ts"),
    );
  if (
    options.officialQuestions ||
    options.officialWorkflows?.length ||
    options.officialEditor
  ) {
    for (const name of [
      ...(options.officialQuestions ? ["question", "questionnaire"] : []),
      ...(options.officialWorkflows ?? []),
      ...(options.officialEditor ? ["modal-editor"] : []),
    ])
      await cp(
        join(getPackageDir(), "examples", "extensions", `${name}.ts`),
        join(agentDir, "extensions", `official-${name}.ts`),
      );
  }
  await writeFile(join(cwd, "test-note.txt"), "Real file attachment content.");
  const requests: Record<string, any>[] = [];
  const titleRequests: Record<string, any>[] = [];
  const abortedRequests: Record<string, any>[] = [];
  const server = createServer(async (req, res) => {
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = "";
    for await (const part of req) body += part;
    const payload = JSON.parse(body);
    const titleRequest = payload.messages.some(
      (message: any) => message.role === "system" &&
        JSON.stringify(message.content).includes("You generate concise conversation titles."),
    );
    if (titleRequest) {
      titleRequests.push(payload);
      if (options.titleDelayMs)
        await new Promise(resolve => setTimeout(resolve, options.titleDelayMs));
      if (res.destroyed) return;
      if (titleRequests.length <= (options.titleFailures ?? 0)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: { message: "Title unavailable" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const title = options.titleResponses?.[titleRequests.length - 1] ?? "Desktop verification";
      res.end(`data: ${JSON.stringify({
        id: "chatcmpl-title",
        object: "chat.completion.chunk",
        created: 1,
        model: "desktop-test",
        choices: [{ index: 0, delta: { role: "assistant", content: title }, finish_reason: "stop" }],
      })}\n\ndata: [DONE]\n\n`);
      return;
    }
    requests.push(payload);
    let finished = false;
    res.once("close", () => {
      if (!finished) abortedRequests.push(payload);
    });
    const messages: any[] = payload.messages;
    const lastUser = messages.reduce(
      (last, m, index) => (m.role === "user" ? index : last),
      -1,
    );
    const prompt = JSON.stringify(messages[lastUser]?.content);
    const extraction = messages.some(
      (message) =>
        message.role === "system" &&
        JSON.stringify(message.content).includes(
          "You are a question extractor",
        ),
    );
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-desktop",
          object: "chat.completion.chunk",
          created: 1,
          model: "desktop-test",
          choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`,
      );
    emit({ role: "assistant", content: "" });
    if (prompt.includes("thinking-label-probe"))
      emit({ reasoning_content: "Reasoning fixture content." });
    const delay = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        res.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    if (prompt.includes("activity-loop-probe")) {
      const completedTools = messages.slice(lastUser + 1).filter(m => m.role === "tool").length;
      emit({ reasoning_content: completedTools === 0 ? "先读取项目中的说明，检查已有内容。" : completedTools < 3 ? "继续检查路径，并确认异常情况。" : "检查完成，整理结果并说明缺失的文件。" });
      await delay(900);
      if (res.destroyed) return;
      if (completedTools < 3) {
        const paths = completedTools === 0 ? ["test-note.txt", "test-note.txt"] : ["missing-note.txt"];
        emit({ tool_calls: paths.map((path, index) => ({
          index,
          id: `activity-read-${completedTools + index}`,
          type: "function",
          function: { name: "read", arguments: JSON.stringify({ path }) },
        })) });
        emit({}, "tool_calls");
      } else {
        emit({ content: "### 已完成检查。\n\n读取了项目说明；另外一个文件不存在，可确认路径后重试。\n\n---\n\n可以继续检查其他文件。" });
        emit({}, "stop");
      }
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 80, completion_tokens: completedTools === 0 ? 20 : completedTools < 3 ? 30 : 50 } })}\n\n`);
      res.end("data: [DONE]\n\n");
      finished = true;
      return;
    }
    if (prompt.includes("application-status-gate")) {
      // Keep this workflow's real SDK response active until explicit abort,
      // independently of browser/native transport and editor mount duration.
      await new Promise<void>((resolve) => {
        if (res.destroyed) resolve();
        else res.once("close", resolve);
      });
      return;
    }
    if (prompt.includes("slow-response") || extraction) {
      await delay(extraction ? (options.extractionDelayMs ?? 400) : 3000);
      if (res.destroyed) return;
    }
    const hasTool = messages.slice(lastUser + 1).some((m) => m.role === "tool");
    const configuredTool = Object.entries(options.modelTools ?? {}).find(
      ([trigger]) => prompt.includes(trigger),
    )?.[1];
    if (
      options.toolContext &&
      prompt.includes("context-lifecycle-") &&
      !hasTool
    ) {
      const mode =
        ["success", "error", "nested", "abort"].find((mode) =>
          prompt.includes(`context-lifecycle-${mode}`),
        ) ?? "success";
      emit({
        tool_calls: [
          {
            index: 0,
            id: `call-context-${requests.length}`,
            type: "function",
            function: { name: "context_tool", arguments: '{"value":"par' },
          },
        ],
      });
      while (!res.destroyed) {
        try {
          await readFile(join(cwd, ".context-stream-release"));
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      if (res.destroyed) return;
      emit({
        tool_calls: [
          {
            index: 0,
            function: {
              arguments: `tial-arguments","mode":"${mode}"}`,
            },
          },
        ],
      });
      emit({}, "tool_calls");
    } else if (configuredTool && !hasTool) {
      emit({
        tool_calls: [
          {
            index: 0,
            id: `call-configured-${requests.length}`,
            type: "function",
            function: {
              name: configuredTool.name,
              arguments: JSON.stringify(configuredTool.args),
            },
          },
        ],
      });
      emit({}, "tool_calls");
    } else if (extraction) {
      emit({ content: "Q: Which desktop controls should be used?\nA: " });
      emit({}, "stop");
    } else if (
      options.officialWorkflows?.includes("todo") &&
      prompt.includes("official-todo-") &&
      !hasTool
    ) {
      const action =
        ["add", "toggle", "clear", "list"].find((candidate) =>
          prompt.includes(`official-todo-${candidate}`),
        ) ?? "list";
      emit({
        tool_calls: [
          {
            index: 0,
            id: `call-todo-${requests.length}`,
            type: "function",
            function: {
              name: "todo",
              arguments: JSON.stringify({
                action,
                ...(action === "add"
                  ? {
                      text: prompt.includes("second")
                        ? "Second task"
                        : "First task",
                    }
                  : {}),
                ...(action === "toggle" ? { id: 1 } : {}),
              }),
            },
          },
        ],
      });
      emit({}, "tool_calls");
    } else if (
      options.officialQuestions &&
      prompt.includes("official-question") &&
      !hasTool
    ) {
      const questionnaire = prompt.includes("official-questionnaire");
      emit({
        tool_calls: [
          {
            index: 0,
            id: `call-official-${requests.length}`,
            type: "function",
            function: {
              name: questionnaire ? "questionnaire" : "question",
              arguments: JSON.stringify(
                questionnaire
                  ? {
                      questions: [
                        {
                          id: "scope",
                          label: "Scope",
                          prompt: "Which scope?",
                          allowOther: false,
                          options: [
                            {
                              value: "app",
                              label: "Desktop app",
                              description: "Native desktop controls",
                            },
                            { value: "cli", label: "Command line" },
                          ],
                        },
                        {
                          id: "notes",
                          prompt: "Any additional requirements?",
                          options: [{ value: "none", label: "None" }],
                        },
                      ],
                    }
                  : {
                      question: "Which interface should be used?",
                      options: [
                        {
                          label: "Desktop components",
                          description: "Use native desktop controls",
                        },
                        { label: "Command line" },
                      ],
                    },
              ),
            },
          },
        ],
      });
      emit({}, "tool_calls");
    } else if (prompt.includes("reply-polish-probe")) {
      emit({ reasoning_content: "The user is asking for a clear desktop interface. I should keep the reasoning readable and align it with the response.\n\n先确认任务，再组织回答，避免重复的装饰和多余缩进。" });
      await delay(1000);
      if (res.destroyed) return;
      emit({ content: "你好！有什么可以帮你的吗？\n\n我可以协助你审查界面、调整布局，或继续完善这个桌面应用。" });
      emit({}, "stop");
    } else if (prompt.includes("streaming-final-usage-probe")) {
      emit({ reasoning_content: "Check the response before answering. " });
      await delay(150);
      emit({ reasoning_content: "Keep the live rate visible without intermediate usage. " });
      await delay(150);
      emit({ content: "Streaming without intermediate token counts. " });
      await delay(1800);
      if (res.destroyed) return;
      emit({ content: "Complete." });
      emit({}, "stop");
    } else if (prompt.includes("streaming-metrics-probe")) {
      emit({ content: "Streaming " });
      await delay(100);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 80, completion_tokens: 6, total_tokens: 86 } })}\n\n`);
      emit({ content: "metrics " });
      await delay(1800);
      if (res.destroyed) return;
      emit({ content: "complete." });
      emit({}, "stop");
    } else if (prompt.includes("presentation-code-probe")) {
      emit({
        content:
          '## Review result\n\n```typescript\nconst message = "你好，Pi";\nconsole.log(message);\n```\n\n| Item | Result |\n| --- | --- |\n| Copy | Ready |\n',
      });
      emit({}, "stop");
    } else if (prompt.includes("transcript-layout-probe")) {
      emit({ reasoning_content: "transcript-layout-probe thinking" });
      emit({
        content:
          "# transcript-layout-probe\n\n```mermaid\nflowchart LR\n A[Sixteen letters A] --> B[Sixteen letters B]\n```\n",
      });
      await delay(1200);
      if (res.destroyed) return;
      emit({ content: "\nCompleted layout." });
      emit({}, "stop");
    } else if (prompt.includes("transcript-mermaid-probe")) {
      emit({ reasoning_content: "  First reasoning.  " });
      emit({
        content:
          "# transcript-fail\n\n```mermaid\nflowchart LR\n Alpha --> Beta\n```\n",
      });
      await delay(1500);
      if (res.destroyed) return;
      emit({ content: "\n**Final tail.**" });
      emit({}, "stop");
    } else if (prompt.includes("run-tool") && !hasTool) {
      emit({
        tool_calls: [
          {
            index: 0,
            id: "call-read",
            type: "function",
            function: {
              name: "read",
              arguments: JSON.stringify({ path: "test-note.txt" }),
            },
          },
        ],
      });
      emit({}, "tool_calls");
    } else {
      for (const content of [
        "SDK ",
        "desktop ",
        hasTool ? "tool verified." : "verified.",
      ]) {
        if (res.destroyed) return;
        emit({ content });
        await delay(25);
      }
      emit({}, "stop");
    }
    const usage = prompt.includes("reply-polish-probe")
      ? { prompt_tokens: 1500, completion_tokens: 2800, total_tokens: 4300, prompt_tokens_details: { cached_tokens: 400 } }
      : { prompt_tokens: 80, completion_tokens: 12, total_tokens: 92 };
    res.write(
      `data: ${JSON.stringify({ id: "chatcmpl-desktop", object: "chat.completion.chunk", choices: [], usage })}\n\n`,
    );
    finished = true;
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "desktop-test",
      defaultModel: "desktop-test",
      // Existing component tests compare regular-mode Container rendering.
      // Renderer-mode tests explicitly cover fullscreen and the SDK default.
      tuiMode: "regular",
      retry: { enabled: false },
      compaction: { enabled: false },
      modelCatalog: { autoUpdate: false },
      enableInstallTelemetry: false,
      lastChangelogVersion: VERSION,
      externalEditor: `"${process.execPath}" "${join(agentDir, "desktop", "fixture external editor.mjs")}"`,
    }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "desktop-test": {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: "openai-completions",
          apiKey: "test-only",
          models: [
            {
              id: "desktop-test",
              name: "Desktop Test",
              reasoning: false,
              input: ["text", "image"],
              contextWindow: 128000,
              maxTokens: 4096,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    join(agentDir, "extensions", "desktop-test.js"),
    `export default function (pi) {
    let unsubscribe;
    pi.registerShortcut("ctrl+alt+u", { description: "Native shortcut", handler: (ctx) => ctx.ui.setEditorText("Shortcut handled") });
    pi.registerCommand("desktop-input", { handler: async (_, ctx) => {
      unsubscribe?.();
      unsubscribe = ctx.ui.onTerminalInput((data) => data === "x" ? { consume: true } : data === "y" ? { data: "Z" } : undefined);
      ctx.ui.setEditorText("");
    } });
    pi.registerCommand("desktop-input-off", { handler: async () => { unsubscribe?.(); } });
    pi.registerMessageRenderer("native-message", function fixtureMessageRenderer() { return undefined; });
    pi.registerEntryRenderer("native-entry", function fixtureEntryRenderer() { return undefined; });
    pi.registerCommand("desktop-renderers", { handler: async () => {
      pi.sendMessage({ customType: "native-message", content: "Raw extension message", display: true });
      pi.appendEntry("native-entry", { note: "Persistent native entry" });
    } });
    pi.registerCommand("desktop-dialog", { description: "Test standard extension UI", handler: async (_, ctx) => {
      const confirmed = await ctx.ui.confirm("Extension confirmation", "Continue?");
      const value = confirmed ? await ctx.ui.input("Extension input", "Value") : undefined;
      ctx.ui.setEditorText(value ?? "cancelled");
      ctx.ui.setStatus("fixture", "dialog-completed");
      ctx.ui.setWidget("fixture", ["Desktop extension widget"]);
    } });
    pi.registerCommand("desktop-custom", { handler: async (_, ctx) => { await ctx.ui.custom(() => ({})); } });
    pi.registerCommand("desktop-native-form", { handler: async (_, ctx) => {
      const result = await ctx.ui.custom(function fixtureNativeForm(tui, theme, keys, done) {
        return { render: () => ["Legacy extension form"], invalidate() {}, handleInput(data) { if (data === "\\r") done({ title: "Review", priority: "normal", enabled: true }); } };
      });
      ctx.ui.setStatus("native-form", result ? result.title + ":" + result.priority : "cancelled");
      if (result) ctx.ui.setEditorText(result.title);
    } });
    pi.registerCommand("desktop-native-overlay", { handler: async (_, ctx) => {
      await ctx.ui.custom(function fixtureNativeForm() { return { render: () => [], invalidate() {} }; }, {
        overlay: true, overlayOptions: { width: "45%", minWidth: 48, maxHeight: "70%", anchor: "top-right", margin: 1 }
      });
    } });
  }`,
  );
  await mkdir(join(agentDir, "desktop"), { recursive: true });
  await cp(
    new URL("./fixtures/application-probe.mjs", import.meta.url),
    join(agentDir, "desktop", "application-probe.mjs"),
  );
  for (const name of [
    "native-execution-probe",
    "tool-display-control",
    "runtime-continuity-probe",
    "renderer-modes-probe",
    "conversation-notices-probe",
    "application-content-probe",
    "managed-tools-probe",
    "startup-probe",
    "startup-policy-probe",
    "invocation-options-probe",
  ])
    await cp(
      new URL(`./fixtures/${name}.mjs`, import.meta.url),
      join(agentDir, "desktop", `${name}.mjs`),
    );
  await writeFile(
    join(agentDir, "desktop", "authorization-events.mjs"),
    "export default function ({host}, {event}) { host.emitEvent(event); }",
  );
  await cp(
    new URL("./fixtures/sdk-themes.mjs", import.meta.url),
    join(agentDir, "desktop", "sdk-themes.mjs"),
  );
  await cp(
    new URL("./fixtures/auth-provider.mjs", import.meta.url),
    join(agentDir, "desktop", "auth-provider.mjs"),
  );
  await writeFile(
    join(agentDir, "desktop", "clear-model.mjs"),
    `export default ({ session }) => { session.agent.state.model = undefined; };`,
  );
  await writeFile(
    join(agentDir, "desktop", "fixture external editor.mjs"),
    `
    import { readFile, writeFile } from "node:fs/promises";
    const path = process.argv.at(-1);
    const initial = await readFile(path, "utf8");
    if (initial === "wait-external") setInterval(() => {}, 1000);
    else if (initial === "fail-external") { console.error("Dialog editor fixture failure"); process.exitCode = 7; }
    else await writeFile(path, initial + "\\nExternal editor result");
  `,
  );
  await writeFile(
    join(agentDir, "desktop", "enable-modal-editor.mjs"),
    `
    import { cp } from "node:fs/promises";
    import { join } from "node:path";
    export default async ({ sdk, host, session }) => {
      await cp(join(sdk.getPackageDir(), "examples", "extensions", "modal-editor.ts"), join(host.agentDir, "extensions", "official-modal-editor.ts"));
      await session.reload();
    }
  `,
  );
  await writeFile(
    join(agentDir, "desktop", "editor-action.mjs"),
    `
    import { writeFile } from "node:fs/promises";
    import { join } from "node:path";
    let unsubscribeComposition;
    let unsubscribeStream;
    let compositionRecords = [];
    export default async ({ host, session }, { action, text, bindings }) => {
      if (action === "bindings") {
        await writeFile(join(host.agentDir, "keybindings.json"), JSON.stringify(bindings));
        await host.action({ action: "resources.reload" });
      }
      const ui = session.extensionRunner.getUIContext();
      if (action === "pasteStreamHook") {
        unsubscribeStream?.();
        unsubscribeStream = text ? ui.onTerminalInput((data) => {
          if (data === "1") return { data: "\\x1b[200~A" };
          if (data === "2") return { data: "\\tB" + (text === "editor" ? "\\r" : "") + "C\\x1b[20" };
          if (data === "3") return { data: "1~" };
        }) : undefined;
      }
      if (action === "compositionHook") {
        unsubscribeComposition?.();
        compositionRecords = [];
        unsubscribeComposition = text ? ui.onTerminalInput((data) => {
          compositionRecords.push(data);
          if (data.startsWith("\\x1b[200~") && data.includes("line one\\nline two")) {
            if (text === "consumeBulk") return { consume: true };
            if (text === "replaceBulk") return { data: "\\x1b[200~changed one\\nchanged two\\x1b[201~" };
          }
          if (data === "\\u4e2d\\u6587") return text === "consume" ? { consume: true } : { data: "transformed" };
        }) : undefined;
      }
      if (action === "compositionRecords") return compositionRecords;
      if (action === "paste") ui.pasteToEditor(text);
      if (action === "text") ui.setEditorText(text);
      if (action === "restore") ui.setEditorComponent(undefined);
      return ui.getEditorText();
    }
  `,
  );
  await writeFile(
    join(agentDir, "desktop", "authority-action.mjs"),
    `export default (_context, args) => {
      const probe = globalThis[Symbol.for("pi-desktop.authority-probe")];
      if (!probe) throw new Error("Original SDK authority probe is not mounted");
      return args.read ? probe.read() : probe.mutate(args);
    };`,
  );
  await writeFile(
    join(agentDir, "desktop", "disable-modal-editor.mjs"),
    `
    import { rm } from "node:fs/promises";
    import { join } from "node:path";
    export default async ({ host, session }) => {
      await rm(join(host.agentDir, "extensions", "official-modal-editor.ts"));
      await session.reload();
    }
  `,
  );
  await writeFile(
    join(agentDir, "desktop", "clipboard-fixture.mjs"),
    `
    export default ({ host }, { text, image }) => {
      host.setClipboard({ getText: async () => text ?? null, getImage: async () => image ? Buffer.from(image, "base64") : null, setText: async (text) => host.emitEvent({ type: "activity", name: "clipboard_fixture_written", data: text }) });
    }
  `,
  );
  await writeFile(
    join(agentDir, "desktop", "runtime.mjs"),
    `
    export function configureDesktop({ desktop }) {
      desktop.registerAdapter({
        id: "fixture-transcript",
        matches: (source) => source?.renderer?.name === "fixtureMessageRenderer" || source?.renderer?.name === "fixtureEntryRenderer",
        create: ({ source }) => {
          let current = source;
          return { view: () => ({ kind: "text", text: current.kind === "message" ? "Native message renderer" : "Native entry renderer" }), update: (value) => { current = value; }, handleAction() {} };
        }
      });
      desktop.registerAdapter({
        id: "fixture-native-form",
        matches: (source, slot) => slot === "dialog" && source?.name === "fixtureNativeForm",
        create: ({ done }) => {
          let title = "Review", priority = "normal", enabled = true;
          return {
            title: "Extension task",
            view: () => ({ kind: "column", children: [
              { kind: "input", action: "title", label: "Task name", value: title },
              { kind: "select", action: "priority", label: "Priority", value: priority, options: [{ value: "normal", label: "Normal" }, { value: "high", label: "High" }] },
              { kind: "toggle", action: "enabled", label: "Enabled", value: enabled },
              { kind: "row", children: [
                { kind: "button", action: "submit", label: "Apply task", icon: "check" },
                { kind: "button", action: "cancel", label: "Cancel", icon: "close" },
                { kind: "button", action: "disabled", label: "Unavailable", disabled: true }
              ] }
            ] }),
            handleAction: ({ action, value }) => {
              if (action === "title") title = String(value);
              if (action === "priority") priority = String(value);
              if (action === "enabled") enabled = !!value;
              if (action === "submit") done({ title, priority, enabled });
              if (action === "cancel") done();
            }
          };
        }
      });
    }
  `,
  );
  return {
    root,
    cwd,
    agentDir,
    requests,
    titleRequests,
    abortedRequests,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    },
  };
}
