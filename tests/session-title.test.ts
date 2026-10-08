import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for title state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function reply(
  host: DesktopHost,
  message = "请帮我优化登录页面的表单间距和按钮布局",
) {
  await host.action({ action: "prompt", args: { message } });
  await until(() => !host.snapshot().busy);
}

test("titles summarize the actual conversation, persist to history and preserve manual names", async () => {
  const fixture = await createFixture({ titleResponses: ["“优化登录页布局”"] });
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    assert.equal(host.snapshot().sessionName, undefined);
    assert.equal(fixture.titleRequests.length, 0);
    await reply(host);
    await until(() => host.snapshot().sessionName === "优化登录页布局");
    const snapshot = host.snapshot();
    const request = fixture.titleRequests[0];
    assert.ok(JSON.stringify(request.messages).includes("表单间距"));
    assert.ok(
      JSON.stringify(request.messages).includes("SDK desktop verified."),
    );
    assert.ok(!request.tools?.length);
    assert.equal(
      snapshot.messages.length,
      2,
      "Naming must not add transcript messages",
    );
    assert.ok(
      (await readFile(snapshot.sessionFile!, "utf8")).includes(
        "优化登录页布局",
      ),
    );
    const history = (await host.action({
      action: "sessions.list",
      args: { all: true },
    })) as { id: string; name?: string }[];
    assert.equal(
      history.find((item) => item.id === snapshot.sessionId)?.name,
      "优化登录页布局",
    );
    await host.action({ action: "session.new" });
    await host.action({
      action: "session.switch",
      args: { path: snapshot.sessionFile },
    });
    assert.equal(host.snapshot().sessionName, "优化登录页布局");
    await host.action({ action: "session.name", args: { name: "手动名称" } });
    await reply(host, "继续完善错误提示");
    assert.equal(host.snapshot().sessionName, "手动名称");
    assert.equal(fixture.titleRequests.length, 1);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("background naming stays idle and a late result cannot overwrite a manual rename", async () => {
  const fixture = await createFixture({ titleDelayMs: 600 });
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await reply(host);
    await until(() => fixture.titleRequests.length === 1);
    assert.equal(host.snapshot().busy, false);
    await host.action({
      action: "session.name",
      args: { name: "保留这个名称" },
    });
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal(host.snapshot().sessionName, "保留这个名称");
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("switching cancels stale titles and opening an old unnamed conversation generates its title", async () => {
  const fixture = await createFixture({ titleDelayMs: 400 });
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await reply(host);
    await until(() => fixture.titleRequests.length === 1);
    const path = host.snapshot().sessionFile;
    await host.action({ action: "session.new" });
    const emptyId = host.snapshot().sessionId;
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(host.snapshot().sessionId, emptyId);
    assert.equal(host.snapshot().sessionName, undefined);
    assert.equal(host.snapshot().messages.length, 0);
    await host.action({ action: "session.switch", args: { path } });
    await until(() => host.snapshot().sessionName === "Desktop verification");
    assert.equal(fixture.titleRequests.length, 2);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("failed naming does not break replies and retries after the next completed reply", async () => {
  const fixture = await createFixture({ titleFailures: 1 });
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await reply(host);
    await until(() => fixture.titleRequests.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(host.snapshot().sessionName, undefined);
    assert.equal(host.snapshot().busy, false);
    await reply(host, "继续调整布局");
    await until(() => host.snapshot().sessionName === "Desktop verification");
    assert.equal(host.snapshot().messages.length, 4);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("an aborted first reply does not generate a title", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    await host.action({ action: "prompt", args: { message: "slow-response" } });
    await until(() => host.session.isStreaming);
    await host.action({ action: "abort" });
    await until(() => !host.snapshot().busy);
    assert.equal(host.snapshot().sessionName, undefined);
    assert.equal(fixture.titleRequests.length, 0);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
