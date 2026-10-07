import test from "node:test";
import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Official extension did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
function dialog(host: DesktopHost) {
  return host.desktopUI.surfaces.find((surface) => surface.slot === "dialog");
}
async function act(host: DesktopHost, action: string, value?: unknown) {
  await host.action({
    action: "desktop.action",
    args: { id: dialog(host)!.id, action, value },
  });
}
async function prompt(host: DesktopHost, message: string) {
  await host.action({ action: "prompt", args: { message } });
  await until(() => !!dialog(host));
}
function lastResult(host: DesktopHost) {
  return host.session.messages
    .filter((message) => message.role === "toolResult")
    .at(-1);
}
function currentSelection(host: DesktopHost) {
  const view = dialog(host)!.view;
  if (view.kind !== "column") throw new Error("Expected native form");
  const tabs = view.children.find((child) => child.kind === "tabs");
  if (!tabs || tabs.kind !== "tabs") throw new Error("Expected native tabs");
  const select = tabs.tabs
    .find((item) => item.value === tabs.value)
    ?.children.find((child) => child.kind === "select");
  if (!select || select.kind !== "select")
    throw new Error("Expected native selector");
  return select;
}

test(
  "official question preserves parameters, original result formatting, cancellation and abort",
  { timeout: 60000 },
  async () => {
    const fixture = await createFixture({ officialQuestions: true });
    const host = new DesktopHost(fixture.agentDir, {
      legacyExampleAdapters: true,
    });
    try {
      await host.initialize(fixture.cwd);
      await prompt(host, "official-question");
      assert.ok(
        JSON.stringify(dialog(host)!.view).includes(
          "Which interface should be used?",
        ),
      );
      assert.ok(
        JSON.stringify(dialog(host)!.view).includes(
          "Use native desktop controls",
        ),
      );
      await act(host, "selection", "1");
      await act(host, "save");
      await until(() => !host.snapshot().busy);
      assert.equal(lastResult(host)?.role, "toolResult");
      assert.deepEqual(lastResult(host)?.content, [
        { type: "text", text: "User selected: 2. Command line" },
      ]);
      assert.deepEqual(lastResult(host)?.details, {
        question: "Which interface should be used?",
        options: ["Desktop components", "Command line"],
        answer: "Command line",
        wasCustom: false,
      });
      await until(() =>
        host.desktopUI.surfaces.some(
          (surface) =>
            surface.slot === "tool" &&
            JSON.stringify(surface.view).includes(
              "User selected: 2. Command line",
            ),
        ),
      );

      await host.action({ action: "resources.reload" });
      await prompt(host, "official-question-custom");
      await act(host, "selection", "other");
      await assert.rejects(act(host, "save"), /unavailable/);
      await act(host, "answer", "  Native components with callbacks  ");
      await act(host, "save");
      await until(() => !host.snapshot().busy);
      assert.deepEqual(lastResult(host)?.content, [
        { type: "text", text: "User wrote: Native components with callbacks" },
      ]);

      await host.action({ action: "session.new" });
      await prompt(host, "official-question-cancel");
      await host.action({
        action: "desktop.close",
        args: { id: dialog(host)!.id },
      });
      await until(() => !host.snapshot().busy);
      assert.deepEqual(lastResult(host)?.content, [
        { type: "text", text: "User cancelled the selection" },
      ]);

      await prompt(host, "official-question-abort");
      await host.action({ action: "abort" });
      await until(() => !host.snapshot().busy);
      assert.equal(dialog(host), undefined);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "official questionnaire retains values, defaults, partial cancellation and native review",
  { timeout: 60000 },
  async () => {
    const fixture = await createFixture({ officialQuestions: true });
    const host = new DesktopHost(fixture.agentDir, {
      legacyExampleAdapters: true,
    });
    try {
      await host.initialize(fixture.cwd);
      await prompt(host, "official-questionnaire");
      assert.equal(
        currentSelection(host).options.some(
          (option) => option.value === "other",
        ),
        false,
      );
      await act(host, "tab", "2");
      await assert.rejects(act(host, "submit"), /unavailable/);
      await act(host, "tab", "0");
      await act(host, "selection", "other");
      assert.equal(currentSelection(host).value, "0");
      await act(host, "save");
      await act(host, "selection", "other");
      await act(host, "answer", "  Support user extensions  ");
      await act(host, "save");
      await act(host, "submit");
      await until(() => !host.snapshot().busy);
      const result = lastResult(host)!;
      assert.deepEqual(result.content, [
        {
          type: "text",
          text: "Scope: user selected: 1. Desktop app\nQ2: user wrote: Support user extensions",
        },
      ]);
      assert.deepEqual((result.details as { answers: unknown }).answers, [
        {
          id: "scope",
          value: "app",
          label: "Desktop app",
          wasCustom: false,
          index: 1,
        },
        {
          id: "notes",
          value: "Support user extensions",
          label: "Support user extensions",
          wasCustom: true,
        },
      ]);

      await prompt(host, "official-questionnaire-partial");
      await act(host, "save");
      await host.action({
        action: "desktop.close",
        args: { id: dialog(host)!.id },
      });
      await until(() => !host.snapshot().busy);
      assert.deepEqual(lastResult(host)?.content, [
        { type: "text", text: "User cancelled the questionnaire" },
      ]);
      assert.equal(
        (lastResult(host)?.details as { cancelled: boolean }).cancelled,
        true,
      );
      assert.equal(
        (lastResult(host)?.details as { answers: unknown[] }).answers.length,
        1,
      );
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "a changed extension with an official tool name does not receive a guessed conversion",
  { timeout: 30000 },
  async () => {
    const fixture = await createFixture({ officialQuestions: true });
    await appendFile(
      join(fixture.agentDir, "extensions", "official-question.ts"),
      "\n// Changed extension source\n",
    );
    const host = new DesktopHost(fixture.agentDir, {
      legacyExampleAdapters: true,
    });
    try {
      await host.initialize(fixture.cwd);
      await host.action({
        action: "prompt",
        args: { message: "official-question" },
      });
      await until(() => !!dialog(host));
      const view = dialog(host)!.view;
      assert.equal(view.kind, "terminal");
      assert.ok(view.kind === "terminal");
      await act(host, view.action, { data: "\r" });
      await until(() => !host.snapshot().busy);
      assert.equal(dialog(host), undefined);
      assert.equal(lastResult(host)?.isError, false);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);
