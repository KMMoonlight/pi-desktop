import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ProjectTrustStore,
  SessionManager,
  type ProjectTrustContext,
} from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopEvent, DialogRequest } from "../shared/types.ts";

async function prepare(
  options: { handler?: string; policy?: "ask" | "always" | "never" } = {},
) {
  const fixture = await createFixture();
  const project = join(fixture.cwd, ".pi");
  const loaded = join(fixture.root, "project-loaded.txt");
  const events = join(fixture.root, "trust-events.jsonl");
  const factories = join(fixture.root, "global-factories.txt");
  await mkdir(join(project, "extensions"), { recursive: true });
  await writeFile(
    join(project, "settings.json"),
    JSON.stringify({ theme: "dark" }),
  );
  await writeFile(
    join(project, "extensions", "project-marker.ts"),
    `import {appendFileSync} from "node:fs";
export default pi => {
  appendFileSync(${JSON.stringify(loaded)}, "loaded\\n");
  pi.on("project_trust", () => { throw new Error("project handler must not decide its own trust"); });
};`,
  );
  await writeFile(
    join(fixture.agentDir, "extensions", "project-policy.ts"),
    `import {appendFileSync} from "node:fs";
export default pi => {
  appendFileSync(${JSON.stringify(factories)}, "factory\\n");
  pi.on("project_trust", async (event, ctx) => {
    appendFileSync(${JSON.stringify(events)}, JSON.stringify({cwd:event.cwd, contextCwd:ctx.cwd, mode:ctx.mode, hasUI:ctx.hasUI}) + "\\n");
    ${options.handler ?? 'return {trusted:"undecided"};'}
  });
};`,
  );
  if (options.policy) {
    const path = join(fixture.agentDir, "settings.json");
    const settings = JSON.parse(await readFile(path, "utf8"));
    await writeFile(
      path,
      JSON.stringify({ ...settings, defaultProjectTrust: options.policy }),
    );
  }
  const host = new DesktopHost(fixture.agentDir);
  const dialogs: DialogRequest[] = [];
  const notices: Extract<DesktopEvent, { type: "notice" }>[] = [];
  let answer: ((request: DialogRequest) => unknown) | undefined;
  host.on("event", (event: DesktopEvent) => {
    if (event.type === "notice") notices.push(event);
    if (event.type === "dialog") {
      dialogs.push(event.data);
      if (answer) host.answer(event.data.id, answer(event.data));
    }
  });
  return {
    ...fixture,
    host,
    dialogs,
    notices,
    project,
    loaded,
    factories,
    decide(callback: (request: DialogRequest) => unknown) {
      answer = callback;
    },
    async events() {
      return (await readFile(events, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    async close() {
      await host.dispose();
      await fixture.close();
    },
  };
}

for (const trusted of [true, false])
  for (const remember of [true, false])
    test(`global project_trust ${trusted ? "allow" : "deny"} retains remember=${remember} and gates project loading`, async () => {
      const fixture = await prepare({
        handler: `return {trusted:${JSON.stringify(trusted ? "yes" : "no")}, remember:${remember}};`,
      });
      fixture.decide(() => trusted);
      try {
        await fixture.host.initialize(fixture.cwd);
        assert.deepEqual(await fixture.events(), [
          {
            cwd: fixture.cwd,
            contextCwd: fixture.cwd,
            mode: "tui",
            hasUI: true,
          },
        ]);
        assert.equal(fixture.dialogs.length, 0);
        assert.equal(fixture.host.snapshot().trusted, trusted);
        assert.equal(
          new ProjectTrustStore(fixture.agentDir).get(fixture.cwd),
          remember ? trusted : null,
        );
        assert.equal(
          await readFile(fixture.factories, "utf8"),
          "factory\n",
          "bootstrap extensions are reused for final loading",
        );
        assert.equal(
          await readFile(fixture.loaded, "utf8").catch(() => ""),
          trusted ? "loaded\n" : "",
        );
      } finally {
        await fixture.close();
      }
    });

for (const trusted of [true, false])
  test(`project_trust overrides a saved ${trusted ? "denial" : "grant"} before remembered policy`, async () => {
    const fixture = await prepare({
      handler: `return {trusted:${JSON.stringify(trusted ? "yes" : "no")}};`,
    });
    new ProjectTrustStore(fixture.agentDir).set(fixture.cwd, !trusted);
    try {
      await fixture.host.initialize(fixture.cwd);
      assert.equal((await fixture.events()).length, 1);
      assert.equal(fixture.host.snapshot().trusted, trusted);
      assert.equal(
        new ProjectTrustStore(fixture.agentDir).get(fixture.cwd),
        !trusted,
      );
      assert.equal(fixture.dialogs.length, 0);
    } finally {
      await fixture.close();
    }
  });

for (const policy of ["always", "never"] as const)
  test(`undecided project_trust follows the original defaultProjectTrust=${policy} policy`, async () => {
    const fixture = await prepare({ policy });
    fixture.decide(() => policy === "always");
    try {
      await fixture.host.initialize(fixture.cwd);
      assert.equal((await fixture.events()).length, 1);
      assert.equal(fixture.host.snapshot().trusted, policy === "always");
      assert.equal(fixture.dialogs.length, 0);
      assert.equal(
        new ProjectTrustStore(fixture.agentDir).get(fixture.cwd),
        null,
      );
    } finally {
      await fixture.close();
    }
  });

for (const choice of [
  "Trust (this session only)",
  "Do not trust (this session only)",
  "Trust parent folder",
])
  test(`native project trust choices retain ${choice} persistence`, async () => {
    const fixture = await prepare();
    fixture.decide((request) =>
      request.kind === "confirm"
        ? true
        : request.options?.find(
            (option) => typeof option === "string" && option.startsWith(choice),
          ),
    );
    try {
      await fixture.host.initialize(fixture.cwd);
      assert.equal(fixture.dialogs.length, 1);
      const dialog = fixture.dialogs[0];
      assert.equal(dialog.kind, "select");
      assert.equal(dialog.options?.length, 5);
      const trusted = !choice.startsWith("Do not");
      assert.equal(fixture.host.snapshot().trusted, trusted);
      assert.equal(
        new ProjectTrustStore(fixture.agentDir).get(fixture.cwd),
        choice === "Trust parent folder" ? true : null,
      );
      if (choice === "Trust parent folder")
        assert.equal(
          new ProjectTrustStore(fixture.agentDir).get(fixture.root),
          true,
        );
      await fixture.host.sdk.runtime.newSession();
      assert.equal(
        fixture.dialogs.length,
        1,
        "temporary decisions remain valid for this host's cwd lifetime",
      );
      assert.equal((await fixture.events()).length, 1);
      assert.equal(fixture.host.snapshot().trusted, trusted);
    } finally {
      await fixture.close();
    }
  });

test("project_trust errors fall through to later handlers and become runtime diagnostics", async () => {
  const fixture = await prepare({
    handler: 'throw new Error("trust handler failure");',
  });
  await writeFile(
    join(fixture.agentDir, "extensions", "z-next-policy.ts"),
    'export default pi => { pi.on("project_trust", () => ({trusted:"undecided"})); pi.on("project_trust", () => ({trusted:"yes"})); };',
  );
  fixture.decide(() => true);
  try {
    await fixture.host.initialize(fixture.cwd);
    assert.equal(fixture.host.snapshot().trusted, true);
    assert.equal(fixture.dialogs.length, 0);
    assert.ok(
      fixture.host
        .snapshot()
        .diagnostics.some((message) =>
          message.includes("project_trust error: trust handler failure"),
        ),
    );
    assert.equal(await readFile(fixture.loaded, "utf8"), "loaded\n");
  } finally {
    await fixture.close();
  }
});

test("project trust handlers use host-scoped input, confirm, select and notification APIs", async () => {
  const fixture = await prepare({
    handler: `
    const value = await ctx.ui.input("Policy input", "project passphrase");
    const confirmed = await ctx.ui.confirm("Policy confirm", value);
    const selected = await ctx.ui.select("Policy select", ["Allow", "Deny"]);
    ctx.ui.notify("Policy notification", "warning");
    return {trusted:confirmed && selected === "Allow" ? "yes" : "no"};`,
  });
  fixture.decide((request) =>
    request.kind === "input"
      ? "approved"
      : request.kind === "confirm"
        ? true
        : "Allow",
  );
  try {
    await fixture.host.initialize(fixture.cwd);
    assert.deepEqual(
      fixture.dialogs.map((request) => request.kind),
      ["input", "confirm", "select"],
    );
    assert.equal(fixture.dialogs[0].placeholder, "project passphrase");
    assert.equal(fixture.dialogs[1].message, "approved");
    assert.ok(
      fixture.notices.some(
        (notice) =>
          notice.message === "Policy notification" &&
          notice.level === "warning",
      ),
    );
    assert.equal(fixture.host.snapshot().trusted, true);
  } finally {
    await fixture.close();
  }
});

test("project trust keyboard input works before any session exists and retains dialog identity", async () => {
  const fixture = await prepare({
    handler:
      'const value = await ctx.ui.input("Bootstrap input"); return {trusted:value === "approved" ? "yes" : "no"};',
  });
  let failure: unknown;
  fixture.host.on("event", (event: DesktopEvent) => {
    if (event.type !== "dialog") return;
    void (async () => {
      const id = event.data.id;
      assert.equal(fixture.host.runtime, undefined);
      const result = await fixture.host.action({
        action: "desktop.input",
        args: {
          dialogId: id,
          dialogTarget: "text",
          data: "x",
          controlText: "",
          selection: { start: 0, end: 0 },
          sessionId: "retired-session",
        },
      });
      assert.deepEqual(result, {
        consume: false,
        data: "x",
        keyId: "x",
        changed: false,
      });
      await fixture.host.action({
        action: "desktop.input",
        args: {
          dialogId: id,
          dialogTarget: "text",
          event: { key: "Enter" },
          controlText: "approved",
          sessionId: "retired-session",
        },
      });
    })().catch((error) => {
      failure = error;
      fixture.host.answer(event.data.id, undefined);
    });
  });
  try {
    await fixture.host.initialize(fixture.cwd);
    assert.equal(failure, undefined);
    assert.equal(fixture.host.snapshot().trusted, true);
    assert.equal(fixture.host.pendingDialogs.length, 0);
  } finally {
    await fixture.close();
  }
});

test("explicit trust changes update the temporary cwd decision across newSession", async () => {
  const fixture = await prepare({ handler: 'return {trusted:"yes"};' });
  fixture.decide(() => true);
  try {
    await fixture.host.initialize(fixture.cwd);
    assert.equal(fixture.host.snapshot().trusted, true);
    await fixture.host.action({
      action: "trust.set",
      args: { trusted: false },
    });
    await fixture.host.sdk.runtime.newSession();
    assert.equal(fixture.host.snapshot().trusted, false);
    assert.equal((await fixture.events()).length, 1);
    assert.equal(
      new ProjectTrustStore(fixture.agentDir).get(fixture.cwd),
      false,
    );
  } finally {
    await fixture.close();
  }
});

test("cancelled native trust selection leaves the persistent store undecided", async () => {
  const fixture = await prepare();
  fixture.decide(() => undefined);
  try {
    await fixture.host.initialize(fixture.cwd);
    assert.equal(fixture.host.snapshot().trusted, false);
    assert.equal(
      new ProjectTrustStore(fixture.agentDir).get(fixture.cwd),
      null,
    );
    assert.equal(await readFile(fixture.loaded, "utf8").catch(() => ""), "");
  } finally {
    await fixture.close();
  }
});

test("empty projects need no trust grant even with a never policy", async () => {
  const fixture = await createFixture();
  const path = join(fixture.agentDir, "settings.json");
  await writeFile(
    path,
    JSON.stringify({
      ...JSON.parse(await readFile(path, "utf8")),
      defaultProjectTrust: "never",
    }),
  );
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    assert.equal(host.snapshot().trusted, true);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("closing during a project-trust prompt does not load project code or revive the host", async () => {
  const fixture = await prepare();
  let opened!: () => void;
  const ready = new Promise<void>((done) => {
    opened = done;
  });
  fixture.host.on("event", (event: DesktopEvent) => {
    if (event.type === "dialog") opened();
  });
  const pending = fixture.host.initialize(fixture.cwd);
  void pending.catch(() => {});
  try {
    await ready;
    await fixture.host.dispose();
    await assert.rejects(pending);
    assert.equal(fixture.host.runtime, undefined);
    assert.equal(fixture.host.pendingDialogs.length, 0);
    assert.equal(await readFile(fixture.loaded, "utf8").catch(() => ""), "");
  } finally {
    await pending.catch(() => {});
    await fixture.close();
  }
});

test("public switchSession projectTrustContextFactory keeps the caller's actual context", async () => {
  const fixture = await prepare();
  const target = join(fixture.root, "target");
  await mkdir(join(target, ".pi"), { recursive: true });
  await writeFile(join(target, ".pi", "settings.json"), "{}");
  const manager = SessionManager.create(
    target,
    join(fixture.root, "target-sessions"),
  );
  manager.appendMessage({
    role: "user",
    content: "target",
    timestamp: Date.now(),
  });
  await writeFile(
    manager.getSessionFile()!,
    [manager.getHeader(), ...manager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  let selects = 0;
  const context: ProjectTrustContext = {
    cwd: target,
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async () => {
        selects++;
        return "Do not trust (this session only)";
      },
      confirm: async () => false,
      input: async () => undefined,
      notify: () => {},
    },
  };
  fixture.decide(() => false);
  new ProjectTrustStore(fixture.agentDir).set(fixture.cwd, false);
  try {
    await fixture.host.initialize(fixture.cwd);
    await fixture.host.sdk.runtime.switchSession(manager.getSessionFile()!, {
      projectTrustContextFactory: (cwd) => {
        assert.equal(cwd, target);
        return context;
      },
    });
    const events = await fixture.events();
    assert.equal(events.at(-1).mode, "rpc");
    assert.equal(events.at(-1).contextCwd, target);
    assert.equal(selects, 1);
    assert.equal(fixture.host.snapshot().trusted, false);
    assert.equal(fixture.host.pendingDialogs.length, 0);
  } finally {
    await fixture.close();
  }
});
