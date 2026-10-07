import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { createMcpOAuthFixture } from "./mcp-oauth-fixture.ts";
import type { DesktopEvent } from "../shared/types.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

function nodes(node: DesktopNode): DesktopNode[] {
  return [
    node,
    ...("children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : []
    ).flatMap(nodes),
  ];
}

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error("OAuth fixture did not reach expected state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test(
  "MCP manager completes reauthorization when token contents and expiry are unchanged",
  { timeout: 30000 },
  async () => {
    const fixture = await createFixture();
    let holdToken = false;
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    const peer = await createMcpOAuthFixture({
      stableTokens: true,
      beforeTokenResponse: () => (holdToken ? tokenGate : Promise.resolve()),
    });
    const host = new DesktopHost(fixture.agentDir);
    const urls: Extract<DesktopEvent, { type: "auth_url" }>[] = [];
    const completed: unknown[] = [];
    host.on("event", (event: DesktopEvent) => {
      if (event.type === "auth_url") urls.push(event);
      if (event.type === "activity" && event.name === "auth_complete")
        completed.push((event.data as { id?: string })?.id);
    });
    let pending: Promise<unknown> | undefined;
    try {
      await writeFile(
        join(fixture.agentDir, "mcp.json"),
        JSON.stringify({ mcpServers: { oauth_peer: peer.config } }),
      );
      await host.initialize(fixture.cwd);
      pending = host.session
        .prompt("/mcp login oauth_peer")
        .catch((error) => error);
      await until(() => urls.length === 1 && host.pendingDialogs.length === 1);
      assert.equal((await fetch(urls[0].url)).status, 200);
      await pending;
      const credentials = async () =>
        Object.values(
          JSON.parse(
            await readFile(join(fixture.agentDir, "mcp-auth.json"), "utf8"),
          ),
        ) as { tokens: unknown; tokensExpireAt?: number }[];
      const before = (await credentials())[0];
      assert.equal(before.tokensExpireAt, undefined);
      peer.rejectCurrentAccessToken();
      await host.action({
        action: "mcp.command",
        args: { name: "oauth_peer", operation: "reconnect" },
      });
      pending = host.session.prompt("/mcp").catch((error) => error);
      for (const value of ["oauth_peer", "signin"]) {
        await until(() =>
          host.desktopUI.surfaces.some(
            (surface) =>
              surface.slot === "dialog" &&
              nodes(surface.view).some(
                (node) =>
                  node.kind === "select" &&
                  node.options.some((option) => option.value === value),
              ),
          ),
        );
        const surface = host.desktopUI.surfaces.find(
          (surface) => surface.slot === "dialog",
        )!;
        const select = nodes(surface.view).find(
          (node) =>
            node.kind === "select" &&
            node.options.some((option) => option.value === value),
        );
        assert.ok(select?.kind === "select");
        await host.desktopUI.action(surface.id, {
          action: select.action,
          value,
        });
        await host.desktopUI.action(surface.id, {
          action: `${select.action}:submit`,
        });
      }
      await until(() => urls.length === 2);
      assert.equal(
        completed.includes(urls[1].id),
        false,
        "Metadata writes must not complete an authorization",
      );
      holdToken = true;
      assert.equal((await fetch(urls[1].url)).status, 200);
      await until(() => peer.grants.length === 2);
      await until(() => completed.includes(urls[1].id));
      assert.equal(
        peer.issuedTokenCount,
        1,
        "Closing the browser interaction must not report token exchange success",
      );
      releaseToken();
      await until(() => peer.issuedTokenCount === 2);
      await until(() =>
        host.desktopUI.surfaces.some(
          (surface) =>
            surface.slot === "dialog" &&
            nodes(surface.view).some(
              (node) =>
                node.kind === "select" &&
                node.options.some((option) => option.value === "tools"),
            ),
        ),
      );
      const after = (await credentials())[0];
      assert.deepEqual(after.tokens, before.tokens);
      assert.equal(after.tokensExpireAt, undefined);
      assert.equal(peer.grants.length, 2);
      await until(() => completed.includes(urls[1].id));
      assert.ok(
        host.desktopUI.surfaces.some((surface) => surface.slot === "dialog"),
      );
    } finally {
      releaseToken();
      await host.dispose();
      await pending;
      await peer.close();
      await fixture.close();
    }
  },
);

for (const entry of ["slash", "manager"] as const)
  for (const transition of [
    "cancel",
    "reload",
    "dispose",
    "immediate",
    "success",
    "failure",
  ] as const)
    test(
      `MCP ${entry} login retains ${transition} lifecycle and callback cleanup`,
      { timeout: 30000 },
      async () => {
        const fixture = await createFixture();
        const peer = await createMcpOAuthFixture({
          beforeTokenResponse:
            transition === "failure"
              ? async () => {
                  throw new Error("Fixture token exchange rejected");
                }
              : undefined,
        });
        const host = new DesktopHost(fixture.agentDir);
        const urls: string[] = [];
        const ids: (string | undefined)[] = [];
        const completed: unknown[] = [];
        host.on("event", (event: DesktopEvent) => {
          if (event.type === "auth_url") {
            urls.push(event.url);
            ids.push(event.id);
            if (transition === "immediate")
              void host.action({ action: "auth.cancel" });
          }
          if (event.type === "activity" && event.name === "auth_complete")
            completed.push((event.data as { id?: string })?.id);
        });
        let pending: Promise<unknown> | undefined;
        try {
          await writeFile(
            join(fixture.agentDir, "mcp.json"),
            JSON.stringify({ mcpServers: { oauth_peer: peer.config } }),
          );
          await host.initialize(fixture.cwd);
          pending = host.session
            .prompt(entry === "slash" ? "/mcp login oauth_peer" : "/mcp")
            .catch((error) => error);
          if (entry === "manager") {
            await until(() =>
              host.desktopUI.surfaces.some(
                (surface) => surface.slot === "dialog",
              ),
            );
            const surface = host.desktopUI.surfaces.find(
              (surface) => surface.slot === "dialog",
            )!;
            const select = () => {
              const node = nodes(
                host.desktopUI.surfaces.find((item) => item.id === surface.id)!
                  .view,
              ).find((node) => node.kind === "select");
              assert.ok(node?.kind === "select");
              return node;
            };
            for (const value of ["oauth_peer", "signin"]) {
              await until(() =>
                select().options.some((option) => option.value === value),
              );
              const action = select().action;
              await host.desktopUI.action(surface.id, { action, value });
              await host.desktopUI.action(surface.id, {
                action: `${action}:submit`,
              });
            }
          }
          await until(
            () =>
              urls.length === 1 &&
              (transition === "immediate" ||
                (entry === "slash"
                  ? host.pendingDialogs.length === 1
                  : host.desktopUI.surfaces.some((surface) =>
                      nodes(surface.view).some((node) => node.kind === "input"),
                    ))),
          );
          if (transition === "failure")
            assert.equal(completed.includes(ids[0]), false);
          if (transition === "cancel")
            await host.action({ action: "auth.cancel" });
          else if (transition === "reload") await host.session.reload();
          else if (transition === "dispose") await host.dispose();
          else if (transition === "success") {
            assert.equal((await fetch(urls[0])).status, 200);
            await until(() =>
              host.session
                .getActiveToolNames()
                .includes("mcp__oauth_peer__echo"),
            );
          } else if (transition === "failure") {
            assert.equal((await fetch(urls[0])).status, 200);
          }
          await until(() =>
            entry === "slash"
              ? host.pendingDialogs.length === 0
              : host.desktopUI.surfaces
                  .filter((surface) => surface.slot === "dialog")
                  .every(
                    (surface) =>
                      !nodes(surface.view).some(
                        (node) => node.kind === "input",
                      ),
                  ),
          );
          const callback = new URL(urls[0]).searchParams.get("redirect_uri")!;
          await until(async () => {
            try {
              await fetch(callback);
              return false;
            } catch {
              return true;
            }
          });
          assert.equal(
            peer.grants.length,
            transition === "success" || transition === "failure" ? 1 : 0,
          );
          await until(() => completed.includes(ids[0]));
          assert.ok(ids[0]);
          assert.equal(completed.filter((id) => id === ids[0]).length, 1);
          if (
            (transition === "success" || transition === "failure") &&
            entry === "manager"
          )
            assert.ok(
              host.desktopUI.surfaces.some(
                (surface) => surface.slot === "dialog",
              ),
            );
          if (transition === "failure" && entry === "manager") {
            await until(() =>
              host.desktopUI.surfaces.some(
                (surface) =>
                  surface.slot === "dialog" &&
                  nodes(surface.view).some(
                    (node) =>
                      node.kind === "text" &&
                      node.text.includes("Sign-in failed:"),
                  ),
              ),
            );
            const surface = host.desktopUI.surfaces.find(
              (surface) => surface.slot === "dialog",
            )!;
            assert.ok(
              nodes(surface.view).some(
                (node) =>
                  node.kind === "text" && node.text.includes("Sign-in failed:"),
              ),
              "The original Pi manager retains its login error",
            );
            assert.equal(
              host.session
                .getActiveToolNames()
                .includes("mcp__oauth_peer__echo"),
              false,
            );
          }
        } finally {
          for (const surface of host.desktopUI.surfaces.filter(
            (surface) => surface.slot === "dialog",
          ))
            await host.desktopUI.input(surface.id, "\u001b");
          for (const dialog of host.pendingDialogs)
            host.answer(dialog.id, undefined);
          await host.dispose();
          await pending;
          await peer.close();
          await fixture.close();
        }
      },
    );

test(
  "MCP OAuth signs in with PKCE, refreshes after 401, persists and cancels",
  { timeout: 45000 },
  async () => {
    const fixture = await createFixture({
      modelTools: {
        "oauth-tool": {
          name: "mcp__oauth_peer__echo",
          args: { text: "OAuth proof" },
        },
      },
    });
    const peer = await createMcpOAuthFixture();
    const host = new DesktopHost(fixture.agentDir);
    const urls: string[] = [];
    const notices: DesktopEvent[] = [];
    let completions = 0;
    const authorizationIds: (string | undefined)[] = [];
    const completedIds: unknown[] = [];
    host.on("event", (event: DesktopEvent) => {
      if (event.type === "auth_url") {
        urls.push(event.url);
        authorizationIds.push(event.id);
      }
      if (event.type === "notice") notices.push(event);
      if (event.type === "activity" && event.name === "auth_complete") {
        completions++;
        completedIds.push(
          event.data && typeof event.data === "object" && "id" in event.data
            ? event.data.id
            : undefined,
        );
      }
    });
    try {
      await writeFile(
        join(fixture.agentDir, "mcp.json"),
        JSON.stringify({ mcpServers: { oauth_peer: peer.config } }),
      );
      await host.initialize(fixture.cwd);
      const login = host.action({
        action: "mcp.command",
        args: { name: "oauth_peer", operation: "login" },
      });
      void login.catch(() => {});
      await until(() => urls.length === 1 && host.pendingDialogs.length === 1);
      const callback = await fetch(urls[0]);
      assert.equal(callback.status, 200);
      await login;
      assert.equal(peer.grants[0].grant_type, "authorization_code");
      assert.ok(peer.grants[0].code_verifier);
      assert.ok(
        host.session.getActiveToolNames().includes("mcp__oauth_peer__echo"),
      );
      await host.session.prompt("oauth-tool");
      peer.rejectCurrentAccessToken();
      await host.session.prompt("oauth-tool");
      assert.equal(
        peer.grants.filter((grant) => grant.grant_type === "refresh_token")
          .length,
        1,
      );
      assert.ok(peer.resourceTokens.includes("Bearer fixture-access-2"));
      const credentials = await readFile(
        join(fixture.agentDir, "mcp-auth.json"),
        "utf8",
      );
      assert.match(credentials, /fixture-refresh-2/);
      await host.session.reload();
      await host.session.prompt("oauth-tool");
      assert.equal(peer.grants.length, 2);
      assert.equal(
        peer.requests.filter((request) => request.method === "tools/call")
          .length,
        3,
      );
      await host.action({
        action: "mcp.command",
        args: { name: "oauth_peer", operation: "logout" },
      });
      const cancelled = host.action({
        action: "mcp.command",
        args: { name: "oauth_peer", operation: "login" },
      });
      void cancelled.catch(() => {});
      await until(() => urls.length === 2 && host.pendingDialogs.length === 1);
      const unrelated = host.ask({ kind: "input", title: "Unrelated request" });
      await host.action({ action: "auth.cancel" });
      await until(() => host.pendingDialogs.length === 1);
      assert.equal(host.pendingDialogs[0].title, "Unrelated request");
      host.answer(host.pendingDialogs[0].id, "retained");
      assert.equal(await unrelated, "retained");
      await cancelled;
      assert.equal(peer.grants.length, 2);
      assert.equal(host.pendingDialogs.length, 0);
      assert.doesNotMatch(
        await readFile(join(fixture.agentDir, "mcp-auth.json"), "utf8"),
        /fixture-access|fixture-refresh/,
      );
      assert.doesNotMatch(
        JSON.stringify(notices),
        /Unsupported Pi TUI|Sign-in failed/,
      );
      for (const transition of ["reload", "dispose"] as const) {
        const count = urls.length;
        const interrupted = host
          .action({
            action: "mcp.command",
            args: { name: "oauth_peer", operation: "login" },
          })
          .then(
            () => null,
            (error) => error,
          );
        await until(
          () => urls.length === count + 1 && host.pendingDialogs.length === 1,
        );
        const completedBefore = completions;
        if (transition === "dispose") await host.dispose();
        else await host.session.reload();
        const interruption = await interrupted;
        assert.ok(interruption instanceof Error);
        assert.equal(interruption.name, "AbortError");
        assert.equal(host.pendingDialogs.length, 0);
        assert.equal(completions, completedBefore + 1);
        assert.ok(authorizationIds[count]);
        assert.equal(completedIds.at(-1), authorizationIds[count]);
        await assert.rejects(
          fetch(new URL(urls[count]).searchParams.get("redirect_uri")!),
        );
      }
    } finally {
      await host.dispose();
      await peer.close();
      await fixture.close();
    }
  },
);

test(
  "MCP OAuth desktop input rejects wrong state and accepts a pasted callback",
  { timeout: 30000 },
  async () => {
    const fixture = await createFixture();
    const peer = await createMcpOAuthFixture();
    const host = new DesktopHost(fixture.agentDir);
    const urls: string[] = [];
    const notices: string[] = [];
    host.on("event", (event: DesktopEvent) => {
      if (event.type === "auth_url") urls.push(event.url);
      if (event.type === "notice") notices.push(event.message);
    });
    try {
      await writeFile(
        join(fixture.agentDir, "mcp.json"),
        JSON.stringify({ mcpServers: { oauth_peer: peer.config } }),
      );
      await host.initialize(fixture.cwd);
      for (const valid of [false, true]) {
        const count = urls.length;
        const login = host.action({
          action: "mcp.command",
          args: { name: "oauth_peer", operation: "login" },
        });
        void login.catch(() => {});
        await until(
          () => urls.length > count && host.pendingDialogs.length === 1,
        );
        const response = await fetch(urls.at(-1)!, { redirect: "manual" });
        assert.equal(response.status, 302);
        const redirect = new URL(response.headers.get("location")!);
        if (!valid) redirect.searchParams.set("state", "wrong-fixture-state");
        host.answer(host.pendingDialogs[0].id, redirect.href);
        await login;
        assert.equal(host.pendingDialogs.length, 0);
        assert.equal(peer.grants.length, valid ? 1 : 0);
        if (!valid)
          assert.ok(
            notices.some((notice) => notice.includes("different sign-in")),
          );
        else
          assert.ok(
            host.session.getActiveToolNames().includes("mcp__oauth_peer__echo"),
          );
      }
    } finally {
      await host.dispose();
      await peer.close();
      await fixture.close();
    }
  },
);
