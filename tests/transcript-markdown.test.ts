import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getPackageDir,
  type MarkdownTransformer,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost, messageView } from "../backend/host.ts";
import {
  loadComponentRuntime,
  componentField,
} from "../backend/component-runtime.ts";
import { createFixture } from "./fixture.ts";
import type { ChatMessage } from "../shared/types.ts";

const mermaid = "```mermaid\nflowchart LR\n Alpha --> Beta\n```";
const body = "  # transcript-fail\n\n" + mermaid + "\n\n**Tail**  ";
const rawAssistant = (content: unknown[]) => ({
  role: "assistant",
  content,
  api: "openai-completions",
  provider: "desktop-test",
  model: "desktop-test",
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: Date.now(),
});
async function setup() {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  await host.initialize(fixture.cwd);
  const api = await loadComponentRuntime();
  const original = (name: string) =>
    import(
      pathToFileURL(
        join(
          getPackageDir(),
          "dist",
          "modes",
          "interactive",
          "components",
          name + ".js",
        ),
      ).href
    );
  return {
    fixture,
    host,
    api,
    original,
    close: async () => {
      await host.dispose();
      await fixture.close();
    },
  };
}
function sources(message: ChatMessage) {
  return message.markdown?.map((item) => item.source);
}
function append(
  host: DesktopHost,
  message: Parameters<
    DesktopHost["session"]["sessionManager"]["appendMessage"]
  >[0],
) {
  host.session.sessionManager.appendMessage(message);
  host.session.agent.state.messages =
    host.session.sessionManager.buildSessionContext().messages;
}

async function expandCompletedThinking(host: DesktopHost) {
  const message = host.snapshot().messages.at(-1)!;
  for (const block of message.markdown ?? [])
    if (message.content[block.blockIndices[0]]?.type === "thinking")
      await host.action({
        action: "transcript.thinking",
        args: { messageId: message.id, blockIndex: block.blockIndices[0], visible: true },
      });
}

test("DOM headings omit terminal prefixes while retaining literal hashes, inline styles and raw source", async () => {
  const { host, close } = await setup();
  try {
    const source = [1, 2, 3, 4, 5, 6].map(depth => `${"#".repeat(depth)} **Title ${depth}** with \`###\``).join("\n\n")
      + "\n\n\\### literal text\n\n```md\n### literal code\n```\n\n---\n\n> ### Quoted title";
    const raw = rawAssistant([{ type: "text", text: source }]);
    append(host, raw as never);
    const view = host.snapshot().messages.at(-1)!;
    const blocks = view.markdown![0].blocks;
    assert.equal(view.markdown![0].source, source);
    const headings = blocks.filter(block => block.kind === "heading");
    assert.equal(headings.length, 6);
    headings.forEach((heading, index) => {
      assert.ok(heading.kind === "heading");
      assert.equal(heading.text, `Title ${index + 1} with ###`);
      assert.equal(heading.runs?.map(run => run.text).join(""), heading.text);
      assert.ok(heading.runs?.some(run => run.style?.color));
      assert.notEqual(heading.runs?.[0].style?.color, heading.runs?.at(-1)?.style?.color);
    });
    assert.ok(blocks.some(block => block.kind === "paragraph" && block.text === "### literal text"));
    assert.ok(blocks.some(block => block.kind === "code" && block.copyText === "### literal code"));
    assert.ok(blocks.some(block => block.kind === "divider"));
    const quote = blocks.find(block => block.kind === "quote");
    const quotedHeading = quote?.children[0];
    assert.ok(quotedHeading?.kind === "heading");
    assert.equal(quotedHeading.text, "Quoted title");
    assert.deepEqual(host.session.messages.at(-1), raw);
  } finally { await close(); }
});

test("transcript transformations match original Pi role, padding, trim, grouping and failure semantics", async () => {
  const { fixture, host, api, original, close } = await setup();
  try {
    const seen: { source: string; context: unknown }[] = [];
    const transforms: MarkdownTransformer[] = [
      () => {
        throw new Error("ignored extension error");
      },
      (() => ({ invalid: true })) as unknown as MarkdownTransformer,
      (source, context) => {
        seen.push({ source, context });
        return source.replace("transcript-fail", "transformed");
      },
    ];
    host.session.extensionRunner.getMarkdownTransformers = () => transforms;
    host.session.settingsManager.setHideThinkingBlock(false);
    await host.action({ action: "desktop.viewport", args: { width: 42 } });
    append(host, {
      role: "user",
      content: [
        { type: "text", text: "  user\\*" },
        { type: "text", text: " tail  " },
      ],
      timestamp: Date.now(),
    });
    const raw = rawAssistant([
      { type: "thinking", thinking: "  one  " },
      { type: "thinking", thinking: "   " },
      { type: "thinking", thinking: " two " },
      { type: "text", text: "  transcript-fail  " },
      { type: "thinking", thinking: " three " },
    ]);
    append(host, raw as never);
    await expandCompletedThinking(host);
    seen.length = 0;
    const snapshot = host.snapshot();
    assert.deepEqual(
      seen.map((item) => item.source),
      ["  user\\*\n tail  ", "one\n\ntwo", "transcript-fail", "three"],
    );
    assert.deepEqual(
      seen.map((item) => item.context),
      ["user", "assistant-thinking", "assistant", "assistant-thinking"].map(
        (messageType) => ({
          messageType,
          isStreaming: false,
          availableWidth: 40,
        }),
      ),
    );
    const user = snapshot.messages.find((item) => item.role === "user")!;
    const assistant = snapshot.messages.find(
      (item) => item.role === "assistant",
    )!;
    assert.deepEqual(
      assistant.markdown?.map((item) => item.blockIndices),
      [[0, 1, 2], [3], [4]],
    );
    const { UserMessageComponent } = await original("user-message");
    const { AssistantMessageComponent } = await original("assistant-message");
    const nativeUser = new UserMessageComponent(
      "  user\\*\n tail  ",
      api.markdown.getMarkdownTheme(),
      1,
      transforms,
    );
    nativeUser.render(42);
    assert.equal(
      user.markdown?.[0].source,
      componentField(nativeUser.children[0], "cachedTokens") instanceof WeakRef
        ? (
            componentField(nativeUser.children[0], "cachedTokens") as WeakRef<{
              source: string;
            }>
          ).deref()?.source
        : undefined,
    );
    const nativeAssistant = new AssistantMessageComponent(
      raw,
      false,
      api.markdown.getMarkdownTheme(),
      "Thinking",
      1,
      transforms,
    );
    nativeAssistant.render(42);
    const container = componentField(nativeAssistant, "contentContainer") as {
      children: object[];
    };
    const originalSources = container.children.flatMap((child) => {
      const actual = componentField(child, "child") ?? child;
      const ref = componentField(actual as object, "cachedTokens");
      return ref instanceof WeakRef ? [ref.deref().source] : [];
    });
    assert.deepEqual(sources(assistant), originalSources);
    assert.deepEqual(host.session.messages.at(-1), raw);
    const disk = await readFile(host.snapshot().sessionFile!, "utf8");
    assert.ok(disk.includes("transcript-fail"));
    assert.ok(!disk.includes("transformed"));
    host.session.settingsManager.setOutputPad(0);
    await host.action({ action: "desktop.viewport", args: { width: 1 } });
    seen.length = 0;
    host.snapshot();
    assert.ok(
      seen.every(
        (item) =>
          (item.context as { availableWidth: number }).availableWidth === 1,
      ),
    );
    assert.ok(fixture.requests.length === 0);
  } finally {
    await close();
  }
});

test("hidden and expanded consecutive thinking retain original transform timing across reset and session replacement", async () => {
  const { host, close } = await setup();
  try {
    const seen: string[] = [];
    host.session.extensionRunner.getMarkdownTransformers = () => [
      (source, context) => {
        if (context.messageType === "assistant-thinking") seen.push(source);
        return source;
      },
    ];
    host.session.settingsManager.setHideThinkingBlock(true);
    append(
      host,
      rawAssistant([
        { type: "thinking", thinking: " one " },
        { type: "thinking", thinking: " two " },
        { type: "text", text: "tail" },
      ]) as never,
    );
    const message = host.snapshot().messages.at(-1)!;
    assert.equal(seen.length, 0);
    assert.equal(message.markdown?.[0].visible, false);
    await host.action({
      action: "transcript.thinking",
      args: { messageId: message.id, blockIndex: 0, visible: true },
    });
    assert.ok(seen.includes("one\n\ntwo"));
    assert.equal(host.snapshot().messages.at(-1)?.markdown?.[0].visible, true);
    await host.action({ action: "display.thinking", args: { visible: false } });
    assert.equal(host.snapshot().messages.at(-1)?.markdown?.[0].visible, false);
    await host.action({ action: "session.new" });
    assert.deepEqual(host.snapshot().messages, []);
  } finally {
    await close();
  }
});

test("built-in Mermaid precedes extensions and matches original mode, width, unsupported and warning behavior", async () => {
  const { host, api, original, close } = await setup();
  try {
    const { createMermaidMarkdownTransformer } = await original("mermaid");
    const { createMarkdownTransform } = await original("markdown-transform");
    const theme = host.session.extensionRunner.getUIContext().theme;
    const observed: string[] = [];
    const transforms: MarkdownTransformer[] = [
      (source) => {
        observed.push(source);
        return source.replace("transcript-fail", "transformed");
      },
    ];
    host.session.extensionRunner.getMarkdownTransformers = () => transforms;
    for (const mode of ["off", "final", "streaming"] as const) {
      host.session.settingsManager.setMermaidRenderingMode(mode);
      for (const width of [120, 2]) {
        await host.action({ action: "desktop.viewport", args: { width } });
        for (const isStreaming of [false, true]) {
          for (const source of [
            body,
            "```mermaid\nunsupported nonsense\n```",
            "```mermaid\nflowchart LR\n A-->B\n B -->\n C -->\n```",
          ]) {
            const raw = rawAssistant([{ type: "text", text: source }]);
            if (isStreaming)
              Reflect.set(host, "streaming", messageView(raw, "streaming"));
            else append(host, raw as never);
            observed.length = 0;
            const snapshot = host.snapshot();
            const message = isStreaming
              ? snapshot.streaming!
              : snapshot.messages.at(-1)!;
            const builtin = createMermaidMarkdownTransformer({
              getMode: () => mode,
              theme,
            });
            const expected = createMarkdownTransform("assistant", isStreaming, [
              builtin,
              ...transforms,
            ])(source.trim(), Math.max(1, width - 2));
            assert.equal(
              message.markdown?.[0].source,
              expected.replace(/\x1b\[[0-9;]*m/g, ""),
            );
            if (
              source.includes("C -->") &&
              width === 120 &&
              mode !== "off" &&
              !isStreaming
            ) {
              assert.match(
                message.markdown![0].source,
                /Mermaid diagram not rendered:.*\(\+1 more\)/,
              );
              assert.ok(
                message.markdown![0].blocks.some(
                  (block) =>
                    block.kind === "code" && block.language === "mermaid",
                ),
              );
            }
            if (
              width === 120 &&
              mode !== "off" &&
              (!isStreaming || mode === "streaming") &&
              source === body
            ) {
              assert.ok(
                observed.some(
                  (text) => text.includes("┌") && !text.includes("```mermaid"),
                ),
              );
              const block = message.markdown?.[0].blocks.find(
                (item) => item.kind === "paragraph" && item.preformatted,
              );
              assert.ok(block?.kind === "paragraph");
              assert.ok(
                block.text.includes("Alpha") && block.text.includes("Beta"),
              );
              assert.ok(block.runs?.some((run) => run.style?.color));
            }
            Reflect.set(host, "streaming", undefined);
          }
        }
      }
    }
    assert.equal(api.markdown.createMarkdownTransform, createMarkdownTransform);
    assert.equal(
      api.markdown.createMermaidMarkdownTransformer,
      createMermaidMarkdownTransformer,
    );
  } finally {
    await close();
  }
});

test("rendered transformations leave original conversation, persistence and later provider input intact", async () => {
  const { fixture, host, close } = await setup();
  try {
    host.session.extensionRunner.getMarkdownTransformers = () => [
      (source) =>
        source
          .replaceAll("SDK", "DISPLAY-ONLY")
          .replaceAll("first input", "DISPLAY-USER"),
    ];
    await host.action({ action: "prompt", args: { message: "first input" } });
    const deadline = Date.now() + 15000;
    while (host.snapshot().busy) {
      assert.ok(Date.now() < deadline);
      await new Promise((done) => setTimeout(done, 20));
    }
    const first = host.snapshot();
    assert.ok(
      first.messages.at(-1)?.markdown?.[0].source.includes("DISPLAY-ONLY"),
    );
    assert.ok(first.messages.at(-1)?.content[0].text?.includes("SDK"));
    await host.action({ action: "prompt", args: { message: "second input" } });
    while (host.snapshot().busy) {
      assert.ok(Date.now() < deadline);
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.ok(
      JSON.stringify(fixture.requests[1]).includes("SDK desktop verified."),
    );
    assert.ok(!JSON.stringify(fixture.requests[1]).includes("DISPLAY-ONLY"));
    const disk = await readFile(first.sessionFile!, "utf8");
    assert.ok(!disk.includes("DISPLAY-ONLY") && !disk.includes("DISPLAY-USER"));
    await host.action({ action: "session.new" });
    await host.action({
      action: "session.switch",
      args: { path: first.sessionFile },
    });
    assert.ok(
      host.snapshot().messages[0].content[0].text?.includes("first input"),
    );
  } finally {
    await close();
  }
});

test("streamed thinking collapses on completion and manual expansion remains independent for equal timestamps", async () => {
  const { host, close } = await setup();
  try {
    host.session.settingsManager.setHideThinkingBlock(true);
    const raw = rawAssistant([
      { type: "thinking", thinking: "stream reasoning" },
      { type: "text", text: mermaid },
    ]);
    Reflect.set(host, "streaming", messageView(raw, "streaming"));
    host.snapshot();
    await host.action({
      action: "transcript.thinking",
      args: { messageId: "streaming", blockIndex: 0, visible: true },
    });
    assert.equal(host.snapshot().streaming?.markdown?.[0].visible, true);
    append(host, raw as never);
    Reflect.set(host, "streaming", undefined);
    assert.equal(host.snapshot().messages.at(-1)?.markdown?.[0].visible, false);
    await expandCompletedThinking(host);
    assert.equal(host.snapshot().messages.at(-1)?.markdown?.[0].visible, true);
    append(host, {
      ...raw,
      content: [{ type: "thinking", thinking: "different reasoning" }],
    } as never);
    const messages = host.snapshot().messages;
    assert.equal(messages.at(-2)?.markdown?.[0].visible, true);
    assert.equal(messages.at(-1)?.markdown?.[0].visible, false);
    const before = messages.at(-2)?.markdown?.[1].blocks;
    host.session.extensionRunner.getUIContext().setTheme("dark");
    assert.notDeepEqual(
      host.snapshot().messages.at(-2)?.markdown?.[1].blocks,
      before,
    );
  } finally {
    await close();
  }
});

test("measured transcript text and thinking columns reach original transformers independently of terminal viewport and padding", async () => {
  const { host, close } = await setup();
  try {
    host.session.settingsManager.setHideThinkingBlock(false);
    append(host, { role: "user", content: "user", timestamp: Date.now() });
    append(
      host,
      rawAssistant([
        { type: "thinking", thinking: "thought" },
        { type: "text", text: "response" },
      ]) as never,
    );
    const seen: {
      messageType: string;
      availableWidth: number;
      isStreaming: boolean;
    }[] = [];
    host.session.extensionRunner.getMarkdownTransformers = () => [
      (source, context) => {
        seen.push(context);
        return source;
      },
    ];
    await expandCompletedThinking(host);
    const initial = host.snapshot();
    const args = {
      backendId: initial.backendId,
      sessionId: initial.sessionId,
      widths: { text: 83, thinking: 74 },
    };
    assert.deepEqual(await host.action({ action: "transcript.layout", args }), {
      accepted: true,
    });
    for (const padding of [0, 1] as const) {
      host.session.settingsManager.setOutputPad(padding);
      await host.action({ action: "desktop.viewport", args: { width: 999 } });
      seen.length = 0;
      host.snapshot();
      assert.deepEqual(seen, [
        { messageType: "user", isStreaming: false, availableWidth: 83 },
        {
          messageType: "assistant-thinking",
          isStreaming: false,
          availableWidth: 74,
        },
        { messageType: "assistant", isStreaming: false, availableWidth: 83 },
      ]);
    }
    Reflect.set(
      host,
      "streaming",
      messageView(
        rawAssistant([
          { type: "thinking", thinking: "stream thought" },
          { type: "text", text: "stream text" },
        ]),
        "streaming",
      ),
    );
    seen.length = 0;
    host.snapshot();
    assert.deepEqual(seen.slice(-2), [
      {
        messageType: "assistant-thinking",
        isStreaming: true,
        availableWidth: 74,
      },
      { messageType: "assistant", isStreaming: true, availableWidth: 83 },
    ]);
    Reflect.set(host, "streaming", undefined);
  } finally {
    await close();
  }
});

test("transcript layouts reject retired backend/session measurements and malformed geometry without changing original rendering", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    assert.deepEqual(
      await host.action({
        action: "transcript.layout",
        args: { widths: { text: 20, thinking: 18 } },
      }),
      { accepted: false },
    );
    await host.initialize(fixture.cwd);
    const initial = host.snapshot();
    const args = {
      backendId: initial.backendId,
      sessionId: initial.sessionId,
      widths: { text: 20, thinking: 18 },
    };
    append(host, rawAssistant([{ type: "text", text: "response" }]) as never);
    const seen: number[] = [];
    host.session.extensionRunner.getMarkdownTransformers = () => [
      (source, context) => {
        seen.push(context.availableWidth);
        return source;
      },
    ];
    assert.deepEqual(await host.action({ action: "transcript.layout", args }), {
      accepted: true,
    });
    for (const invalid of [0, -1, 1.5, NaN, Infinity, "30", undefined, 10001])
      assert.deepEqual(
        await host.action({
          action: "transcript.layout",
          args: { ...args, widths: { text: invalid, thinking: 18 } },
        }),
        { accepted: false },
      );
    assert.deepEqual(
      await host.action({
        action: "transcript.layout",
        args: { ...args, backendId: "retired" },
      }),
      { accepted: false },
    );
    assert.deepEqual(
      await host.action({
        action: "transcript.layout",
        args: { ...args, sessionId: "retired" },
      }),
      { accepted: false },
    );
    seen.length = 0;
    host.snapshot();
    assert.deepEqual(seen, [20]);
    await host.action({ action: "session.new" });
    assert.deepEqual(await host.action({ action: "transcript.layout", args }), {
      accepted: false,
    });
    append(
      host,
      rawAssistant([{ type: "text", text: "new response" }]) as never,
    );
    host.session.extensionRunner.getMarkdownTransformers = () => [
      (source, context) => {
        seen.push(context.availableWidth);
        return source;
      },
    ];
    seen.length = 0;
    host.snapshot();
    assert.deepEqual(seen, [118]);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("Mermaid width fallback uses measured message content while original thinking keeps its own narrow context", async () => {
  const { host, close } = await setup();
  try {
    host.session.settingsManager.setHideThinkingBlock(false);
    append(
      host,
      rawAssistant([
        { type: "thinking", thinking: mermaid },
        { type: "text", text: mermaid },
      ]) as never,
    );
    await expandCompletedThinking(host);
    const initial = host.snapshot();
    const args = { backendId: initial.backendId, sessionId: initial.sessionId };
    await host.action({
      action: "transcript.layout",
      args: { ...args, widths: { text: 1, thinking: 1 } },
    });
    assert.ok(
      host
        .snapshot()
        .messages.at(-1)
        ?.markdown?.[1].blocks.some(
          (block) => block.kind === "code" && block.language === "mermaid",
        ),
    );
    await host.action({
      action: "transcript.layout",
      args: { ...args, widths: { text: 100, thinking: 1 } },
    });
    const presentations = host.snapshot().messages.at(-1)!.markdown!;
    assert.ok(
      presentations[1].blocks.some(
        (block) => block.kind === "paragraph" && block.preformatted,
      ),
    );
    assert.ok(
      presentations[0].blocks.some(
        (block) => block.kind === "code" && block.language === "mermaid",
      ),
    );
  } finally {
    await close();
  }
});
