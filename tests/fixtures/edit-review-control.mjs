import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const refresh = (sdk) => {
  sdk.agent.state.messages = sdk.sessionManager.buildSessionContext().messages;
};
const appendCall = (sdk, id, args) =>
  sdk.sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", name: "edit", id, arguments: args }],
    stopReason: "toolUse",
    api: "openai-completions",
    provider: "desktop-test",
    model: "desktop-test",
    usage,
    timestamp: Date.now(),
  });
const appendResult = (sdk, id, result, isError = false) =>
  sdk.sessionManager.appendMessage({
    role: "toolResult",
    toolName: "edit",
    toolCallId: id,
    ...result,
    isError,
    timestamp: Date.now(),
  });

export default async function (sdk, args) {
  const base = join(
    sdk.sessionManager.getCwd(),
    "services",
    "control-plane",
    "src",
    "web",
  );
  const path = join(base, args.mode === "error" ? "missing.tsx" : "ui.tsx");
  const edit = {
    path,
    edits: [
      {
        oldText: "export type Status = 'loading';",
        newText:
          "export type Status = 'ready';\nexport const label = '你好，Pi';",
      },
    ],
  };
  if (args.mode === "seed") {
    const results = [];
    for (const [index, filename] of [
      "ui.tsx",
      "page-primitives.tsx",
    ].entries()) {
      const target = join(base, filename);
      await mkdir(dirname(target), { recursive: true });
      const before = [
        'import { useState } from "react";',
        "",
        "export type Status = 'loading';",
        "",
        "export function Page() {",
        "\tconst [status] = useState<Status>('loading');",
        `\treturn <main data-status={status}>${"长路径与代码保持等宽 · ".repeat(20)}</main>;`,
        "}",
        "",
      ].join("\n");
      await writeFile(target, before);
      const input = {
        ...edit,
        path: target,
        ...(index === 1
          ? {
              edits: [
                {
                  oldText: edit.edits[0].oldText,
                  newText: "export type Status = 'ready';",
                },
              ],
            }
          : {}),
      };
      const id = `edit-review-${index}`;
      appendCall(sdk, id, input);
      const result = await sdk.session
        .getToolDefinition("edit")
        .execute(id, input);
      appendResult(sdk, id, result);
      results.push({ path: target, diff: result.details.diff });
    }
    refresh(sdk);
    return results;
  }
  if (args.mode === "pending" || args.mode === "error") {
    await mkdir(base, { recursive: true });
    if (args.mode === "pending")
      await writeFile(path, "export type Status = 'loading';\n");
    const id = "edit-review-live";
    appendCall(sdk, id, edit);
    refresh(sdk);
    Reflect.set(sdk.host, "activeTools", [
      { id, name: "edit", arguments: edit },
    ]);
    Reflect.set(
      sdk.host,
      "toolRenderPhases",
      new Map([
        [
          id,
          {
            argsComplete: true,
            executionStarted: true,
            isPartial: true,
            isError: false,
          },
        ],
      ]),
    );
    return { path };
  }
  if (args.mode === "complete" || args.mode === "fail") {
    const id = "edit-review-live";
    const input = {
      ...edit,
      path: args.mode === "fail" ? join(base, "missing.tsx") : path,
    };
    let result,
      isError = false;
    try {
      result = await sdk.session.getToolDefinition("edit").execute(id, input);
    } catch (error) {
      result = { content: [{ type: "text", text: error.message }] };
      isError = true;
    }
    appendResult(sdk, id, result, isError);
    refresh(sdk);
    Reflect.set(sdk.host, "activeTools", []);
    Reflect.set(sdk.host, "toolRenderPhases", new Map());
    return { path: input.path, diff: result.details?.diff };
  }
  if (args.mode === "content") return readFile(path, "utf8");
  if (args.mode === "clear") {
    Reflect.set(sdk.host, "activeTools", []);
    Reflect.set(sdk.host, "toolRenderPhases", new Map());
  }
}
