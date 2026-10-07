import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

async function until(check: () => boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Official workflow did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const currentDialog = (host: DesktopHost) =>
  host.desktopUI.surfaces.find((surface) => surface.slot === "dialog");
async function runPrompt(host: DesktopHost, message: string) {
  await host.action({ action: "prompt", args: { message } });
  await until(() => !host.snapshot().busy);
}
async function openTodos(host: DesktopHost) {
  await host.action({ action: "prompt", args: { message: "/todos" } });
  await until(() => currentDialog(host)?.title === "Todos");
  const view = currentDialog(host)!.view;
  if (view.kind !== "column") throw new Error("Expected native todo list");
  const table = view.children.find((child) => child.kind === "table");
  if (!table || table.kind !== "table")
    throw new Error("Expected native table");
  await host.action({
    action: "desktop.action",
    args: { id: currentDialog(host)!.id, action: "close" },
  });
  await until(() => !host.snapshot().busy);
  return table.rows;
}

test(
  "official todo UI follows original tool state across branches, reload and session replacement",
  { timeout: 60000 },
  async () => {
    const fixture = await createFixture({ officialWorkflows: ["todo"] });
    const host = new DesktopHost(fixture.agentDir, { legacyExampleAdapters: true });
    try {
      await host.initialize(fixture.cwd);
      assert.deepEqual(await openTodos(host), []);
      await runPrompt(host, "official-todo-add first");
      const checkpoint = host
        .snapshot()
        .messages.find(
          (message) =>
            message.role === "toolResult" && message.toolName === "todo",
        )!.entryId;
      const path = host.snapshot().sessionFile;
      await runPrompt(host, "official-todo-add second");
      await runPrompt(host, "official-todo-toggle");
      assert.deepEqual(await openTodos(host), [
        ["1", "First task", "Completed"],
        ["2", "Second task", "Open"],
      ]);
      await runPrompt(host, "official-todo-list");
      await until(() =>
        host.desktopUI.surfaces.some(
          (surface) =>
            surface.slot === "tool" && surface.view.kind === "column",
        ),
      );
      await host.action({
        action: "session.navigate",
        args: { id: checkpoint },
      });
      assert.deepEqual(await openTodos(host), [["1", "First task", "Open"]]);
      await host.action({ action: "resources.reload" });
      assert.deepEqual(await openTodos(host), [["1", "First task", "Open"]]);
      await runPrompt(host, "official-todo-toggle");
      assert.deepEqual(await openTodos(host), [
        ["1", "First task", "Completed"],
      ]);
      await host.action({
        action: "session.navigate",
        args: { id: checkpoint },
      });
      assert.deepEqual(await openTodos(host), [["1", "First task", "Open"]]);
      // Pi restores the last appended entry, so append on the selected branch before reopening.
      await runPrompt(host, "official-todo-list");
      await host.action({ action: "session.new" });
      assert.deepEqual(await openTodos(host), []);
      await host.action({ action: "session.switch", args: { path } });
      assert.deepEqual(await openTodos(host), [["1", "First task", "Open"]]);
      await runPrompt(host, "official-todo-clear");
      assert.deepEqual(await openTodos(host), []);
      await runPrompt(host, "official-todo-add first");
      assert.deepEqual(await openTodos(host), [["1", "First task", "Open"]]);
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "official Q&A runs work inside its original factory and aborts the actual model request",
  { timeout: 60000 },
  async () => {
    const fixture = await createFixture({
      officialWorkflows: ["qna"],
      extractionDelayMs: 1500,
    });
    const host = new DesktopHost(fixture.agentDir, { legacyExampleAdapters: true });
    const events: any[] = [];
    host.on("event", (event) => events.push(event));
    try {
      await host.initialize(fixture.cwd);
      await runPrompt(host, "/qna");
      assert.ok(
        events.some(
          (event) =>
            event.type === "notice" &&
            event.message === "No assistant messages found",
        ),
      );
      assert.equal(fixture.requests.length, 0);
      await runPrompt(host, "prepare-extraction");
      await host.action({ action: "prompt", args: { message: "/qna" } });
      await until(() => currentDialog(host)?.title === "Q&A");
      assert.ok(
        JSON.stringify(currentDialog(host)!.view).includes(
          "Extracting questions using desktop-test",
        ),
      );
      await until(() => !host.snapshot().busy);
      assert.ok(
        events.some(
          (event) =>
            event.type === "editor" &&
            event.text === "Q: Which desktop controls should be used?\nA: ",
        ),
      );
      const extraction = fixture.requests.find((request) =>
        JSON.stringify(request.messages).includes(
          "You are a question extractor",
        ),
      );
      assert.ok(extraction);
      assert.ok(
        JSON.stringify(extraction.messages).includes("SDK desktop verified."),
      );
      const editorEvents = events.filter(
        (event) => event.type === "editor",
      ).length;

      await host.action({ action: "prompt", args: { message: "/qna" } });
      await until(() => currentDialog(host)?.title === "Q&A");
      await until(
        () =>
          fixture.requests.filter((request) =>
            JSON.stringify(request.messages).includes(
              "You are a question extractor",
            ),
          ).length === 2,
      );
      await host.action({
        action: "desktop.action",
        args: { id: currentDialog(host)!.id, action: "cancel" },
      });
      await until(
        () => !host.snapshot().busy && fixture.abortedRequests.length > 0,
      );
      assert.equal(
        events.filter((event) => event.type === "editor").length,
        editorEvents,
      );
      assert.ok(
        events.some(
          (event) => event.type === "notice" && event.message === "Cancelled",
        ),
      );
      await host.action({ action: "prompt", args: { message: "/qna" } });
      await until(() => currentDialog(host)?.title === "Q&A");
      await until(
        () =>
          fixture.requests.filter((request) =>
            JSON.stringify(request.messages).includes(
              "You are a question extractor",
            ),
          ).length === 3,
      );
      await host.action({ action: "abort" });
      await until(
        () => !host.snapshot().busy && fixture.abortedRequests.length > 1,
      );
      assert.equal(currentDialog(host), undefined);
      assert.equal(
        events.filter((event) => event.type === "editor").length,
        editorEvents,
      );
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);

test(
  "official status messages retain metadata, expansion and persistence in native rendering",
  { timeout: 30000 },
  async () => {
    const fixture = await createFixture({
      officialWorkflows: ["message-renderer"],
    });
    const host = new DesktopHost(fixture.agentDir, { legacyExampleAdapters: true });
    try {
      await host.initialize(fixture.cwd);
      await runPrompt(host, "prepare-status-session");
      await runPrompt(host, "/status warn Provider is busy");
      await until(() =>
        host.desktopUI.surfaces.some((surface) => surface.slot === "message"),
      );
      const rendered = () =>
        host.desktopUI.surfaces.find((surface) => surface.slot === "message")!
          .view;
      assert.deepEqual(rendered(), {
        kind: "text",
        text: "[WARN] Provider is busy",
      });
      const message = host.session.messages.find(
        (item) => item.role === "custom",
      );
      assert.equal((message?.details as { level: string }).level, "warn");
      await host.action({ action: "display.tools", args: { expanded: true } });
      await until(() => {
        const view = rendered();
        return (
          view.kind === "text" &&
          view.text.includes(String.fromCharCode(10) + "at ")
        );
      });
      const path = host.snapshot().sessionFile;
      await host.action({ action: "session.new" });
      assert.equal(
        host.desktopUI.surfaces.some((surface) => surface.slot === "message"),
        false,
      );
      await host.action({ action: "session.switch", args: { path } });
      await until(() =>
        host.desktopUI.surfaces.some((surface) => surface.slot === "message"),
      );
      assert.ok(JSON.stringify(rendered()).includes("[WARN] Provider is busy"));
    } finally {
      await host.dispose();
      await fixture.close();
    }
  },
);
