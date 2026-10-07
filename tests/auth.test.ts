import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopEvent } from "../shared/types.ts";
import { createMcpOAuthFixture } from "./mcp-oauth-fixture.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Login did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const operation of [
  "complete-provider",
  "cancel-provider",
  "cancel-mcp",
] as const)
  test(`concurrent SDK and MCP authorizations retain ownership during ${operation}`, async () => {
    const fixture = await createFixture();
    const peer = await createMcpOAuthFixture();
    const host = new DesktopHost(fixture.agentDir);
    const events: DesktopEvent[] = [];
    host.on("event", (event) => events.push(event));
    let providerLogin: Promise<unknown> | undefined;
    let mcpLogin: Promise<unknown> | undefined;
    try {
      await writeFile(
        join(fixture.agentDir, "mcp.json"),
        JSON.stringify({ mcpServers: { oauth_peer: peer.config } }),
      );
      await host.initialize(fixture.cwd);
      await host.action({
        action: "sdk.run",
        args: {
          path: join(fixture.agentDir, "desktop", "auth-provider.mjs"),
          args: { operation: "install" },
        },
      });
      providerLogin = host
        .action({
          action: "auth.login",
          args: { provider: "desktop-auth-test" },
        })
        .catch((error) => error);
      await until(() =>
        host.pendingDialogs.some(
          (dialog) => dialog.title === "Fixture account",
        ),
      );
      mcpLogin = host.session
        .prompt("/mcp login oauth_peer")
        .catch((error) => error);
      await until(
        () =>
          events.filter((event) => event.type === "auth_url").length === 2 &&
          host.pendingDialogs.length === 2,
      );
      const authorizations = events.filter(
        (event) => event.type === "auth_url",
      );
      assert.ok(
        authorizations[0].id,
        "Provider authorization must carry its own identity",
      );
      assert.notEqual(authorizations[0].id, authorizations[1].id);
      if (operation !== "complete-provider") {
        const id = authorizations[operation === "cancel-provider" ? 0 : 1].id;
        assert.ok(id);
        await host.action({ action: "auth.cancel", args: { id } });
        if (operation === "cancel-provider")
          assert.ok((await providerLogin) instanceof Error);
        else await mcpLogin;
        assert.equal(host.pendingDialogs.length, 1);
        assert.equal(
          host.pendingDialogs[0].title === "Fixture account",
          operation === "cancel-mcp",
        );
        await host.action({ action: "auth.cancel", args: { id } });
        assert.equal(
          host.pendingDialogs.length,
          1,
          "A stale cancel must not affect the other authorization",
        );
        assert.equal(peer.grants.length, 0);
        return;
      }
      for (const [title, value] of [
        ["Fixture account", "account-b"],
        ["Fixture region", "fixture-region"],
        ["Fixture secret", "fixture-only"],
      ]) {
        await until(() =>
          host.pendingDialogs.some((dialog) => dialog.title === title),
        );
        host.answer(
          host.pendingDialogs.find((dialog) => dialog.title === title)!.id,
          value,
        );
      }
      assert.ok(!((await providerLogin) instanceof Error));
      assert.equal(host.pendingDialogs.length, 1);
      const completions = events.filter(
        (event) => event.type === "activity" && event.name === "auth_complete",
      );
      assert.equal(completions.length, 1);
      assert.equal(completions[0].type, "activity");
      if (completions[0].type !== "activity")
        assert.fail("Missing completion event");
      assert.deepEqual(completions[0].data, { id: authorizations[0].id });
      await host.action({ action: "auth.cancel" });
      await mcpLogin;
      assert.equal(host.pendingDialogs.length, 0);
      assert.equal(peer.grants.length, 0);
    } finally {
      await host.action({ action: "auth.cancel" });
      await host.dispose();
      await providerLogin;
      await mcpLogin;
      await peer.close();
      await fixture.close();
    }
  });

for (const transition of ["cancel", "reload", "dispose"] as const)
  test(`SDK login ${transition} closes its prompt and ignores late authorization notifications`, async () => {
    const fixture = await createFixture();
    const host = new DesktopHost(fixture.agentDir);
    const events: DesktopEvent[] = [];
    host.on("event", (event) => events.push(event));
    let login: Promise<unknown> | undefined;
    try {
      await host.initialize(fixture.cwd);
      await host.action({
        action: "sdk.run",
        args: {
          path: join(fixture.agentDir, "desktop", "auth-provider.mjs"),
          args: { operation: "install", scenario: "late-notify" },
        },
      });
      login = host
        .action({
          action: "auth.login",
          args: { provider: "desktop-auth-test" },
        })
        .catch((error) => error);
      await until(() =>
        host.pendingDialogs.some(
          (dialog) => dialog.title === "Fixture delayed prompt",
        ),
      );
      if (transition === "reload") await host.session.reload();
      else if (transition === "dispose") await host.dispose();
      else await host.action({ action: "auth.cancel" });
      assert.ok((await login) instanceof Error);
      assert.equal(host.pendingDialogs.length, 0);
      const urls = events.filter((event) => event.type === "auth_url");
      assert.equal(urls.length, 1);
      assert.equal(urls[0].url, "https://example.invalid/active");
      assert.ok(urls[0].id);
      const completion = events.find(
        (event) => event.type === "activity" && event.name === "auth_complete",
      );
      assert.ok(completion?.type === "activity");
      assert.deepEqual(completion.data, { id: urls[0].id });
    } finally {
      await host.dispose();
      await login;
      await fixture.close();
    }
  });

test("cancelling during a provider notification cannot publish a stale authorization link", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const urls: DesktopEvent[] = [];
  try {
    await host.initialize(fixture.cwd);
    await host.action({
      action: "sdk.run",
      args: {
        path: join(fixture.agentDir, "desktop", "auth-provider.mjs"),
        args: { operation: "install", scenario: "late-notify" },
      },
    });
    host.on("event", (event: DesktopEvent) => {
      if (event.type === "activity" && event.name === "auth")
        void host.action({ action: "auth.cancel" });
      if (event.type === "auth_url") urls.push(event);
    });
    await assert.rejects(
      host.action({
        action: "auth.login",
        args: { provider: "desktop-auth-test" },
      }),
      /取消|abort|cancel/i,
    );
    assert.equal(host.pendingDialogs.length, 0);
    assert.equal(urls.length, 0);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("SDK login retains stable device identity, distinct option IDs and auth events", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const events: DesktopEvent[] = [];
  host.on("event", (event) => events.push(event));
  try {
    await host.initialize(fixture.cwd);
    const path = join(fixture.agentDir, "desktop", "auth-provider.mjs");
    const operation = (operation: string) =>
      host.action({ action: "sdk.run", args: { path, args: { operation } } });
    await operation("install");
    const login = host.action({
      action: "auth.login",
      args: { provider: "desktop-auth-test" },
    });
    let settled = false;
    void login.finally(() => (settled = true)).catch(() => {});
    await until(() => host.pendingDialogs.length > 0 || settled);
    if (settled) await login;
    const selection = host.pendingDialogs[0];
    assert.equal(selection.title, "Fixture account");
    assert.deepEqual(selection.options, [
      {
        value: "account-a",
        label: "Same account",
        description: "Personal workspace",
      },
      {
        value: "account-b",
        label: "Same account",
        description: "Team workspace",
      },
    ]);
    host.answer(selection.id, "account-b");
    await until(() => host.pendingDialogs[0]?.title === "Fixture region");
    assert.equal(host.pendingDialogs[0].placeholder, "region-name");
    host.answer(host.pendingDialogs[0].id, "fixture-region");
    await until(() => host.pendingDialogs[0]?.title === "Fixture secret");
    assert.equal(host.pendingDialogs[0].secret, true);
    host.answer(host.pendingDialogs[0].id, "fixture-only");
    await login;
    const records = (await operation("records")) as Record<string, unknown>[];
    assert.equal(records[1].value, "account-b");
    assert.equal(records[2].value, "fixture-region");
    assert.equal(records[3].accepted, true);
    const device = records[0].value;
    assert.equal(device, host.sdk.settingsManager.getOrCreateDeviceId());
    assert.equal(
      host.sdk.sdk.SettingsManager.create(
        fixture.cwd,
        fixture.agentDir,
      ).getOrCreateDeviceId(),
      device,
    );
    assert.equal(
      JSON.parse(
        await readFile(join(fixture.agentDir, "settings.json"), "utf8"),
      ).deviceId,
      device,
    );
    assert.ok(
      (await host.sdk.modelRuntime.listCredentials()).some(
        (credential) =>
          credential.providerId === "desktop-auth-test" &&
          credential.type === "oauth",
      ),
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === "activity" &&
          event.name === "auth" &&
          (event.data as { links?: unknown[] }).links?.length === 1,
      ),
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === "activity" &&
          event.name === "auth" &&
          (event.data as { intervalSeconds?: number }).intervalSeconds === 2,
      ),
    );
    await host.action({
      action: "auth.logout",
      args: { provider: "desktop-auth-test" },
    });
    assert.ok(
      !(await host.sdk.modelRuntime.listCredentials()).some(
        (credential) => credential.providerId === "desktop-auth-test",
      ),
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("SDK login prompt cancellation at publication closes only that prompt", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const path = join(fixture.agentDir, "desktop", "auth-provider.mjs");
    const fixtureModule = await import(pathToFileURL(path).href);
    await host.action({
      action: "sdk.run",
      args: { path, args: { operation: "install", scenario: "prompt-race" } },
    });
    host.on("event", (event) => {
      if (
        event.type === "dialog" &&
        event.data.title === "Fixture callback code"
      )
        fixtureModule.abortPrompt();
    });
    const login = host.action({
      action: "auth.login",
      args: { provider: "desktop-auth-test" },
    });
    let settled = false;
    void login.finally(() => (settled = true)).catch(() => {});
    await until(() => settled);
    await login;
    assert.equal(host.pendingDialogs.length, 0);
    assert.ok(
      (await host.sdk.modelRuntime.listCredentials()).some(
        (credential) => credential.providerId === "desktop-auth-test",
      ),
    );
    const records = await host.action({
      action: "sdk.run",
      args: { path, args: { operation: "records" } },
    });
    assert.deepEqual(
      (records as { type: string }[]).map((record) => record.type),
      ["device", "prompt-cancelled"],
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("unmodified SDK ChatGPT login receives its installation ID and cancels before token exchange", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  let authorization: URL | undefined;
  host.on("event", (event) => {
    if (event.type === "auth_url") authorization = new URL(event.url);
  });
  try {
    await host.initialize(fixture.cwd);
    assert.ok(host.sdk.modelRuntime.getProvider("openai")?.auth.oauth);
    let outcome: { success: boolean; error?: unknown } | undefined;
    const login = host
      .action({
        action: "auth.login",
        args: { provider: "openai", method: "oauth" },
      })
      .then(
        () => {
          outcome = { success: true };
        },
        (error: unknown) => {
          outcome = { success: false, error };
        },
      );
    await until(() => authorization !== undefined || outcome !== undefined);
    assert.ok(authorization, String(outcome?.error ?? "No authorization URL"));
    assert.equal(
      authorization.searchParams.get("ext_agent_host_id"),
      `urn:uuid:${host.sdk.settingsManager.getOrCreateDeviceId()}`,
    );
    await host.action({ action: "auth.cancel" });
    await until(() => outcome !== undefined);
    await login;
    assert.equal(outcome?.success, false);
    assert.match(String(outcome?.error), /cancel|abort|取消/i);
    assert.equal(host.pendingDialogs.length, 0);
    assert.ok(
      !(await host.sdk.modelRuntime.listCredentials()).some(
        (credential) => credential.providerId === "openai",
      ),
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
