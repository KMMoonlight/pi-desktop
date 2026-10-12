import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

test("completed native tool views and Markdown survive editor updates but invalidate on theme, width and expansion", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const append = (message: any) =>
      host.session.sessionManager.appendMessage(message);
    const usage = {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    append({
      role: "user",
      content: "Read the fixture",
      timestamp: Date.now(),
    });
    append({
      role: "assistant",
      content: [
        { type: "text", text: "# History\n\nOriginal body." },
        {
          type: "toolCall",
          id: "cached-read",
          name: "read",
          arguments: { path: "fixture.txt" },
        },
      ],
      api: "openai-completions",
      provider: "desktop-test",
      model: "desktop-test",
      stopReason: "toolUse",
      timestamp: Date.now(),
      usage,
    });
    append({
      role: "toolResult",
      toolCallId: "cached-read",
      toolName: "read",
      content: [{ type: "text", text: "Result line.\n".repeat(30) }],
      isError: false,
      timestamp: Date.now(),
    });
    host.session.agent.state.messages =
      host.session.sessionManager.buildSessionContext().messages;
    const read = () => host.snapshot();
    let first = read();
    const surface = (s: ReturnType<typeof read>) =>
      s.desktopSurfaces.find((s) => s.id === "render:result:cached-read");
    for (let i = 0; i < 50 && !surface(first); i++) {
      await new Promise((r) => setTimeout(r, 10));
      first = read();
    }
    assert.ok(surface(first));
    const second = read();
    assert.equal(surface(second)!.view, surface(first)!.view);
    assert.equal(
      second.messages.find((m) => m.role === "assistant")!.markdown![0],
      first.messages.find((m) => m.role === "assistant")!.markdown![0],
    );
    host.desktopUI.setEditorText("unrelated typing");
    assert.equal(surface(read())!.view, surface(first)!.view);
    host.setToolExpanded("cached-read", true);
    await new Promise((r) => setTimeout(r, 30));
    const expanded = read();
    assert.notEqual(surface(expanded)!.view, surface(first)!.view);
    host.desktopUI.setViewport(65, 30);
    const resized = read();
    assert.notEqual(surface(resized)!.view, surface(expanded)!.view);
    await host.action({ action: "theme.set", args: { theme: "dark" } });
    const dark = read();
    assert.notEqual(surface(dark)!.view, surface(resized)!.view);
    assert.notEqual(
      dark.messages.find((m) => m.role === "assistant")!.markdown![0],
      second.messages.find((m) => m.role === "assistant")!.markdown![0],
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("default desktop working animation does not schedule full native renders while extensions retain native ticks", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    await host.action({
      action: "prompt",
      args: { message: "application-status-gate" },
    });
    await new Promise((r) => setTimeout(r, 150));
    host.snapshot();
    const scope = host.desktopUI.terminalRuntime.capture();
    const status = (scope.application as any).status;
    assert.equal(status.kind, "working");
    let renders = 0;
    const original = scope.tui.requestRender;
    scope.tui.requestRender = () => {
      renders++;
    };
    try {
      status.updateDisplay();
      assert.equal(renders, 0);
      ui.setEditorComponent(
        (tui, theme, keys) => new host.sdk.sdk.CustomEditor(tui, theme, keys),
      );
      status.updateDisplay();
      assert.ok(renders > 0);
    } finally {
      scope.tui.requestRender = original;
    }
    await host.action({ action: "abort" });
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
