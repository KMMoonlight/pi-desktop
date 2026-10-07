import test from "node:test";
import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BashExecutionComponent,
  ToolExecutionComponent,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import {
  componentField,
  callComponentMethod,
  loadComponentRuntime,
} from "../backend/component-runtime.ts";
import { createFixture } from "./fixture.ts";
import type { PiComponent } from "../backend/component-runtime.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Native execution did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture(toolDisplay = false) {
  const files = await createFixture({ toolDisplay });
  const host = new DesktopHost(files.agentDir);
  await host.initialize(files.cwd);
  host.snapshot();
  const scope = host.desktopUI.terminalRuntime.capture();
  const children = (value: object): PiComponent[] =>
    componentField(value, "children") as PiComponent[];
  const chat = () => children(children(scope.tui.children[0]!)[2]!);
  const pending = () => children(scope.tui.children[1]!);
  return {
    files,
    host,
    scope,
    chat,
    pending,
    async close() {
      await host.dispose();
      await files.close();
    },
  };
}

test("complete original tool rows own callback children and state without duplicate native application phase roots", async () => {
  const f = await fixture(true);
  try {
    const path = join(f.files.agentDir, "desktop", "seed-tool-display.mjs");
    await cp(
      new URL("./fixtures/tool-display-control.mjs", import.meta.url),
      path,
    );
    await f.host.action({
      action: "sdk.run",
      args: { path, args: { mode: "seed", expanded: false } },
    });
    await until(
      () =>
        f.host
          .snapshot()
          .desktopSurfaces.filter((surface) => surface.slot === "tool")
          .length === 10,
    );
    const rows = f
      .chat()
      .filter((value) => value instanceof ToolExecutionComponent);
    assert.equal(rows.length, 5);
    assert.equal(f.chat().length, 6);
    const row = f.scope.application!.tools.get("display-control")!.original!;
    assert.ok(row instanceof ToolExecutionComponent);
    assert.equal(rows.filter((value) => value === row).length, 1);
    assert.equal(
      componentField(row, "rendererState"),
      f.host.desktopUI.toolState("display-control"),
    );
    const result = componentField(row, "resultRendererComponent");
    const phase = f.host.desktopUI.nativeComponent(
      "render:result:display-control",
    )!;
    assert.equal(componentField(phase, "child"), result);
    const before = JSON.stringify(f.host.session.messages);
    row.setExpanded(true);
    f.host.snapshot();
    assert.equal(
      f.host.desktopUI.toolState("display-control").resultExpanded,
      true,
    );
    assert.equal(componentField(row, "resultRendererComponent"), result);
    assert.equal(componentField(phase, "child"), result);
    assert.equal(JSON.stringify(f.host.session.messages), before);
    assert.equal(
      f.scope.application!.tools.get("display-control")!.original,
      row,
    );
    await f.host.action({ action: "session.new" });
    assert.ok(!f.host.desktopUI.toolState("display-control").component);
  } finally {
    await f.close();
  }
});

test("desktop fallback projects image text without changing the complete native row or SDK result", async () => {
  const f = await fixture(true);
  try {
    const path = join(f.files.agentDir, "desktop", "seed-tool-images.mjs");
    await cp(
      new URL("./fixtures/tool-display-control.mjs", import.meta.url),
      path,
    );
    const image = (await readFile("src-tauri/icons/128x128.png")).toString(
      "base64",
    );
    await f.host.action({
      action: "sdk.run",
      args: { path, args: { mode: "seed", image, expanded: false } },
    });
    await until(
      () =>
        !!f.host.desktopUI.nativeComponent("render:result:display-fallback"),
    );
    const native =
      f.scope.application!.tools.get("display-fallback")!.original!;
    const raw = JSON.stringify(f.host.session.messages);
    const phase = () =>
      f.host.desktopUI.nativeComponent("render:result:display-fallback")!;
    const output = () => phase().render(120).join("\n");
    const result = componentField(native, "result") as Parameters<
      ToolExecutionComponent["updateResult"]
    >[0];
    assert.equal(
      result.content.find((block) => block.type === "image")?.data,
      image,
    );
    const reference = new ToolExecutionComponent(
      "display_fallback",
      "reference",
      componentField(native, "args"),
      { showImages: true },
      {},
      f.scope.tui,
      f.files.cwd,
    );
    reference.updateResult(result);
    assert.equal(
      callComponentMethod(native, "getTextOutput"),
      callComponentMethod(reference, "getTextOutput"),
    );
    assert.match(output(), /4 more lines/);
    native.setExpanded(true);
    await until(() => {
      f.host.snapshot();
      return output().includes("line 14");
    });
    assert.match(output(), /line 14/);
    assert.doesNotMatch(output(), /Image:/i);
    native.setExpanded(false);
    f.host.session.settingsManager.setShowImages(false);
    await until(() => {
      f.host.snapshot();
      return output().includes("5 more lines");
    });
    const box = componentField(native, "contentBox") as PiComponent;
    const children = componentField(box, "children") as PiComponent[];
    assert.equal(
      componentField(phase(), "child"),
      componentField(children[1]!, "child"),
    );
    assert.match(output(), /5 more lines/);
    f.host.session.settingsManager.setShowImages(true);
    await until(() => {
      f.host.snapshot();
      return output().includes("4 more lines");
    });
    assert.match(output(), /4 more lines/);
    assert.equal(
      f.scope.application!.tools.get("display-fallback")!.original,
      native,
    );
    assert.equal(JSON.stringify(f.host.session.messages), raw);
  } finally {
    await f.close();
  }
});

function operation(chunks: string[]) {
  let release!: () => void;
  let entered = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operations: NonNullable<
    Parameters<AgentSession["executeBash"]>[2]
  >["operations"] = {
    async exec(_command, _cwd, options) {
      entered = true;
      for (const chunk of chunks) options.onData(Buffer.from(chunk));
      await Promise.race([
        gate,
        new Promise<void>((resolve) =>
          options.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        ),
      ]);
      return { exitCode: options.signal?.aborted ? 130 : 0 };
    },
  };
  return { operations, release, entered: () => entered };
}

test("direct SDK concurrent bash calls retain separate live originals, chunk callbacks and persisted identity", async () => {
  const f = await fixture();
  const first = operation(["first\r\n", "continued"]),
    second = operation(["second\n"]);
  try {
    const observed: string[] = [];
    const a = f.host.session.executeBash(
      "same command",
      (chunk) => observed.push(chunk),
      { operations: first.operations, id: "first" },
    );
    const b = f.host.session.executeBash("same command", undefined, {
      operations: second.operations,
      excludeFromContext: true,
    });
    await until(() => first.entered() && second.entered());
    f.host.snapshot();
    const live = f
      .chat()
      .filter((value) => value instanceof BashExecutionComponent);
    assert.equal(live.length, 2);
    assert.notEqual(live[0], live[1]);
    assert.equal(
      (live[0] as BashExecutionComponent).getOutput(),
      "first\ncontinued",
    );
    assert.equal((live[1] as BashExecutionComponent).getOutput(), "second\n");
    assert.ok(observed.join("").includes("continued"));
    second.release();
    await b;
    first.release();
    await a;
    f.host.snapshot();
    const final = f
      .chat()
      .filter((value) => value instanceof BashExecutionComponent);
    assert.equal(final.length, 2);
    assert.equal(final[0], live[1]);
    assert.equal(final[1], live[0]);
    assert.ok(
      final.every(
        (value) =>
          componentField(
            componentField(value, "loader") as PiComponent,
            "intervalId",
          ) === null,
      ),
    );
    assert.equal(
      f.host.session.messages.filter(
        (message) => message.role === "bashExecution",
      ).length,
      2,
    );
  } finally {
    first.release();
    second.release();
    await f.close();
  }
});

test("SDK bash recorded during assistant streaming promotes its same original from pending to chat", async () => {
  const f = await fixture();
  const bash = operation(["deferred native output"]);
  try {
    const prompt = f.host.session.prompt("application-status-gate");
    await until(() => f.host.session.isStreaming);
    const execution = f.host.session.executeBash("pending command", undefined, {
      operations: bash.operations,
    });
    await until(bash.entered);
    f.host.snapshot();
    const original = f
      .pending()
      .find((value) => value instanceof BashExecutionComponent)!;
    assert.ok(original instanceof BashExecutionComponent);
    assert.ok(!f.chat().includes(original));
    bash.release();
    await execution;
    f.host.snapshot();
    assert.ok(f.pending().includes(original));
    assert.equal(
      componentField(
        componentField(original, "loader") as PiComponent,
        "intervalId",
      ),
      null,
    );
    await f.host.session.abort();
    await prompt;
    f.host.snapshot();
    assert.equal(
      f.pending().filter((value) => value instanceof BashExecutionComponent)
        .length,
      0,
    );
    assert.equal(f.chat().filter((value) => value === original).length, 1);
  } finally {
    bash.release();
    await f.close();
  }
});

test("Bash cancellation and generation retirement stop original loaders and restore public instance methods", async () => {
  const f = await fixture();
  const op = operation(["cancel native output"]);
  const session = f.host.session;
  const prototypeExecute = Object.getPrototypeOf(session).executeBash;
  try {
    const execution = session.executeBash("cancel command", undefined, {
      operations: op.operations,
    });
    await until(op.entered);
    f.host.snapshot();
    const original = f
      .chat()
      .find((value) => value instanceof BashExecutionComponent)!;
    session.abortBash();
    const result = await execution;
    assert.equal(result.cancelled, true);
    f.host.snapshot();
    assert.equal(f.chat().filter((value) => value === original).length, 1);
    await f.host.dispose();
    assert.equal(
      componentField(
        componentField(original, "loader") as PiComponent,
        "intervalId",
      ),
      null,
    );
    assert.equal(session.executeBash, prototypeExecute);
    assert.equal(
      Object.getOwnPropertyDescriptor(session, "recordBashResult"),
      undefined,
    );
  } finally {
    op.release();
    await f.close();
  }
});

test("native notices use original ThemedText and Spacer, preserve chronological placement and never persist", async () => {
  const f = await fixture();
  try {
    const runtime = await loadComponentRuntime();
    const before = JSON.stringify(f.host.session.messages);
    f.host.notice("first native notice");
    f.host.notice("replaced native notice");
    f.host.snapshot();
    const text = f
      .chat()
      .find((value) => value instanceof runtime.notice.ThemedText)!;
    assert.ok(text instanceof runtime.notice.ThemedText);
    assert.equal(f.chat().length, 2);
    assert.ok(text.render(100).join("\n").includes("replaced native notice"));
    assert.equal(JSON.stringify(f.host.session.messages), before);
    await f.host.session.prompt("following native notice");
    f.host.snapshot();
    assert.equal(f.chat()[1], text);
    f.host.notice("native warning", "warning");
    f.host.notice("native error", "error");
    f.host.snapshot();
    assert.equal(
      f.chat().filter((value) => value instanceof runtime.notice.ThemedText)
        .length,
      3,
    );
    assert.ok(
      f.chat().at(-1)!.render(100).join("\n").includes("Error: native error"),
    );
    assert.equal(
      f.host.session.messages.filter((message) => message.role === "user")
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});
