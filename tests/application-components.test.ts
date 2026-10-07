import test from "node:test";
import assert from "node:assert/strict";
import {
  AssistantMessageComponent,
  UserMessageComponent,
  FooterComponent,
  CustomEditor,
  BashExecutionComponent,
  CompactionSummaryMessageComponent,
  BranchSummaryMessageComponent,
  SkillInvocationMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { loadComponentRuntime } from "../backend/component-runtime.ts";
import { loadTuiApi } from "../backend/tui-api.ts";
import { createFixture } from "./fixture.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    assert.ok(
      Date.now() < deadline,
      "Native application transition did not settle",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture() {
  const files = await createFixture();
  const host = new DesktopHost(files.agentDir);
  await host.initialize(files.cwd);
  host.snapshot();
  const scope = host.desktopUI.terminalRuntime.capture();
  const children = (root: object) => Reflect.get(root, "children") as object[];
  const chat = () => children(children(scope.tui.children[0]!)[2]!);
  return {
    host,
    files,
    scope,
    children,
    chat,
    async close() {
      await host.dispose();
      await files.close();
    },
  };
}

test("builtin messages use original SDK components, retain streamed identity and honor direct native changes", async () => {
  const f = await fixture();
  try {
    const streamed: AssistantMessageComponent[] = [];
    const unsubscribe = f.host.session.subscribe((event) => {
      if (event.type !== "message_update") return;
      f.host.snapshot();
      const component = f
        .chat()
        .find((value) => value instanceof AssistantMessageComponent);
      if (component instanceof AssistantMessageComponent)
        streamed.push(component);
    });
    await f.host.action({
      action: "prompt",
      args: { message: "Native application response" },
    });
    await until(() => !f.host.snapshot().busy);
    unsubscribe();
    const components = f.chat();
    const user = components.find(
      (value) => value instanceof UserMessageComponent,
    );
    const assistant = components.find(
      (value) => value instanceof AssistantMessageComponent,
    );
    assert.ok(user instanceof UserMessageComponent);
    assert.ok(assistant instanceof AssistantMessageComponent);
    assert.ok(streamed.length > 0);
    assert.ok(streamed.every((value) => value === assistant));
    assert.ok(
      user.render(100).join("\n").includes("Native application response"),
    );
    const message = f.host.session.messages.find(
      (value) => value.role === "assistant",
    );
    assert.ok(message?.role === "assistant");
    const before = JSON.stringify(f.host.session.messages);
    assistant.updateContent({
      ...message,
      content: [{ type: "text", text: "Direct native content" }],
    });
    assistant.setOutputPad(4);
    f.host.snapshot();
    assert.equal(
      f.chat().find((value) => value instanceof AssistantMessageComponent),
      assistant,
    );
    assert.equal(Reflect.get(assistant, "outputPad"), 4);
    assert.ok(
      assistant.render(100).join("\n").includes("Direct native content"),
    );
    assert.equal(JSON.stringify(f.host.session.messages), before);
  } finally {
    await f.close();
  }
});

test("native footer and replacement factories share original provider identity and generation cleanup", async () => {
  const f = await fixture();
  try {
    const application = f.scope.application!;
    const original = f.children(f.scope.tui.children[6]!)[0];
    assert.ok(original instanceof FooterComponent);
    assert.equal(original, application.footer);
    assert.equal(Reflect.get(original, "footerData"), application.footerData);
    const ui = f.host.session.extensionRunner.getUIContext();
    ui.setStatus("native-status", "Native footer status");
    ui.setStatus("working", "Explicit footer value");
    ui.setWorkingMessage("Independent indicator message");
    f.host.snapshot();
    assert.equal(
      application.footerData.getExtensionStatuses().get("working"),
      "Explicit footer value",
    );
    assert.ok(original.render(120).join("\n").includes("Native footer status"));
    let calls = 0;
    const dispose = application.footerData.dispose.bind(application.footerData);
    application.footerData.dispose = () => {
      calls++;
      dispose();
    };
    const providers: unknown[] = [];
    for (const id of ["footer-one", "footer-two"])
      await f.host.desktopUI.mount(
        (_tui: unknown, _theme: unknown, data: unknown) => {
          providers.push(data);
          return new FooterComponent(f.host.session, application.footerData);
        },
        "footer",
        id,
      );
    assert.deepEqual(providers, [
      application.footerData,
      application.footerData,
    ]);
    f.host.desktopUI.close("footer-one");
    f.host.desktopUI.close("footer-two");
    assert.equal(calls, 0);
    ui.setStatus("native-status", undefined);
    f.host.snapshot();
    assert.equal(
      application.footerData.getExtensionStatuses().has("native-status"),
      false,
    );
    assert.equal(f.children(f.scope.tui.children[6]!)[0], original);
    await f.host.dispose();
    assert.equal(calls, 1);
    await f.host.dispose();
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});

test("original working and retry indicators move between editor and status roots and stop on retirement", async () => {
  const f = await fixture();
  try {
    const runtime = await loadComponentRuntime();
    const ui = f.host.session.extensionRunner.getUIContext();
    const editor = f.host.desktopUI.nativeComponent("editor") as CustomEditor;
    await f.host.action({
      action: "prompt",
      args: { message: "slow-response" },
    });
    await until(() => f.host.session.isStreaming);
    ui.setWorkingMessage("Native active state");
    ui.setWorkingIndicator({ frames: ["first", "second"], intervalMs: 500 });
    f.host.snapshot();
    const status = Reflect.get(editor, "workingStatusIndicator");
    assert.ok(status instanceof runtime.status.WorkingStatusIndicator);
    assert.equal(Reflect.get(status, "intervalMs"), 500);
    assert.ok(editor.render(100).join("\n").includes("Native active state"));
    assert.deepEqual(f.children(f.scope.tui.children[2]!), []);
    ui.setEditorComponent(
      (tui, theme, keys) =>
        new CustomEditor(tui, theme, keys, { embedWorkingStatus: false }),
    );
    await until(
      () =>
        f.host.desktopUI.nativeComponent("editor") !== editor &&
        !!f.host.desktopUI.nativeComponent("editor"),
    );
    f.host.snapshot();
    assert.equal(Reflect.get(editor, "workingStatusIndicator"), undefined);
    assert.equal(f.children(f.scope.tui.children[2]!)[0], status);
    ui.setEditorComponent(undefined);
    await until(() => f.host.desktopUI.nativeComponent("editor") === editor);
    f.host.snapshot();
    assert.equal(Reflect.get(editor, "workingStatusIndicator"), status);
    f.scope.application!.event({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 3000,
      errorMessage: "fixture",
    });
    ui.setWorkingVisible(false);
    f.host.snapshot();
    const retry = Reflect.get(editor, "workingStatusIndicator");
    assert.ok(retry instanceof runtime.status.RetryStatusIndicator);
    assert.equal(Reflect.get(status, "intervalId"), null);
    f.scope.application!.event({
      type: "auto_retry_end",
      success: true,
      attempt: 1,
    });
    f.host.snapshot();
    assert.equal(Reflect.get(retry, "intervalId"), null);
    assert.equal(Reflect.get(editor, "workingStatusIndicator"), undefined);
    await f.host.action({ action: "abort" });
    await until(() => !f.host.snapshot().busy);
  } finally {
    await f.close();
  }
});

test("summary, skill and bash messages retain original SDK behavior and container array identity", async () => {
  const f = await fixture();
  try {
    const chat = f.chat();
    f.host.session.agent.state.messages = [
      {
        role: "compactionSummary",
        summary: "Native compacted context",
        tokensBefore: 3000,
        timestamp: 1,
      },
      {
        role: "branchSummary",
        summary: "Native branch context",
        fromId: "origin",
        timestamp: 2,
      },
      {
        role: "user",
        content:
          '<skill name="native" location="/native/SKILL.md">\nNative skill content\n</skill>\n\nSkill follow-up',
        timestamp: 3,
      },
      {
        role: "bashExecution",
        command: "fixture command",
        output: "Native command output",
        exitCode: 0,
        cancelled: false,
        truncated: false,
        timestamp: 4,
      },
    ];
    f.host.snapshot();
    assert.equal(f.chat(), chat);
    assert.deepEqual(
      chat.map((value) => value.constructor),
      [
        CompactionSummaryMessageComponent,
        BranchSummaryMessageComponent,
        SkillInvocationMessageComponent,
        UserMessageComponent,
        BashExecutionComponent,
      ],
    );
    const bash = chat.at(-1) as BashExecutionComponent;
    assert.equal(bash.getCommand(), "fixture command");
    assert.equal(bash.getOutput(), "Native command output");
    const summary = chat[0] as CompactionSummaryMessageComponent;
    summary.setExpanded(true);
    f.host.snapshot();
    assert.equal(Reflect.get(summary, "expanded"), true);
    const snapshot = f.host.snapshot();
    assert.equal(snapshot.messages.length, 4);
  } finally {
    await f.close();
  }
});

test("native message markdown caches follow SDK settings while preserving direct content and component identity", async () => {
  const f = await fixture();
  try {
    const api = await loadTuiApi();
    await f.host.session.prompt("Native markdown cache");
    f.host.snapshot();
    const user = f
      .chat()
      .find((value) => value instanceof UserMessageComponent);
    const assistant = f
      .chat()
      .find((value) => value instanceof AssistantMessageComponent);
    assert.ok(user instanceof UserMessageComponent);
    assert.ok(assistant instanceof AssistantMessageComponent);
    const message = f.host.session.messages.find(
      (value) => value.role === "assistant",
    );
    assert.ok(message?.role === "assistant");
    assistant.updateContent({
      ...message,
      content: [{ type: "text", text: "```text\nNative cached code\n```" }],
    });
    assistant.setOutputPad(4);
    const before = JSON.stringify(f.host.session.messages);
    const code = () =>
      assistant
        .render(100)
        .map((line) => api.stripTerminalSequences(line))
        .find((line) => line.includes("Native cached code"))!;
    const first = code().indexOf("Native cached code");
    f.host.sdk.settingsManager.applyOverrides({
      markdown: { codeBlockIndent: "        " },
    });
    f.host.snapshot();
    assert.equal(code().indexOf("Native cached code"), first + 6);
    assert.equal(
      f.chat().find((value) => value instanceof AssistantMessageComponent),
      assistant,
    );
    assert.equal(Reflect.get(assistant, "outputPad"), 4);
    assert.equal(JSON.stringify(f.host.session.messages), before);
    f.host.snapshot();
    assert.equal(code().indexOf("Native cached code"), first + 6);
  } finally {
    await f.close();
  }
});

test("first SDK branch summary and manual compaction mount their original status indicators and clean up", async () => {
  const f = await fixture();
  const original = f.host.session.agent.streamFunction;
  let release: (() => void) | undefined;
  try {
    const runtime = await loadComponentRuntime();
    await f.host.session.prompt("First native branch turn");
    await f.host.session.prompt("Second native branch turn");
    const target = f.host.session.sessionManager
      .getEntries()
      .find(
        (entry) => entry.type === "message" && entry.message.role === "user",
      )!;
    async function inspect(
      operation: () => Promise<unknown>,
      kind: "branchSummary" | "compaction",
    ) {
      let entered = false;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.host.session.agent.streamFunction = async (...args) => {
        entered = true;
        await gate;
        return original(...args);
      };
      const pending = operation();
      // Attach rejection handling before waiting, while preserving errors below.
      void pending.catch(() => {});
      try {
        await until(() => entered);
        assert.equal(f.host.session.isCompacting, true);
        f.host.snapshot();
        const editor = f.host.desktopUI.nativeComponent("editor")!;
        const status = Reflect.get(editor, "workingStatusIndicator");
        assert.equal(status.kind, kind);
        assert.ok(
          status instanceof
            (kind === "branchSummary"
              ? runtime.status.BranchSummaryStatusIndicator
              : runtime.status.CompactionStatusIndicator),
        );
        release!();
        await pending;
        f.host.snapshot();
        assert.equal(Reflect.get(status, "intervalId"), null);
        assert.equal(Reflect.get(editor, "workingStatusIndicator"), undefined);
      } finally {
        release!();
        f.host.session.agent.streamFunction = original;
        await pending;
      }
    }
    await inspect(
      () => f.host.session.navigateTree(target.id, { summarize: true }),
      "branchSummary",
    );
    assert.ok(
      f.chat().some((value) => value instanceof BranchSummaryMessageComponent),
    );
    await f.host.session.prompt("First native compaction turn");
    await f.host.session.prompt("Second native compaction turn");
    f.host.sdk.settingsManager.applyOverrides({
      compaction: { keepRecentTokens: 1, reserveTokens: 100 },
    });
    await inspect(() => f.host.session.compact(), "compaction");
    assert.ok(
      f
        .chat()
        .some((value) => value instanceof CompactionSummaryMessageComponent),
    );
  } finally {
    release?.();
    f.host.session.agent.streamFunction = original;
    await f.close();
  }
});
