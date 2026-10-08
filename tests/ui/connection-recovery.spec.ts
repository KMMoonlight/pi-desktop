import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { cp, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DesktopHost } from "../../backend/host.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createFixture } from "../fixture.ts";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function recoveryBackend(savedSession = true) {
  const fixture = await createFixture();
  const nextCwd = join(fixture.root, "next-workspace");
  await mkdir(nextCwd);
  let token = randomUUID();
  let gate: ReturnType<typeof deferred> | undefined;
  let entered = deferred();
  const clients = new Set<ServerResponse>();
  let failInitialize = false;
  const requests: { action: string; loading: boolean; error?: string }[] = [];
  const makeHost = () =>
    new DesktopHost(fixture.agentDir, {
      runtimeFactory: async (options, fallback) => {
        if (gate) {
          entered.resolve();
          await gate.promise;
        }
        return fallback(options);
      },
    });
  let host = makeHost();
  const broadcast = (event: unknown) => {
    for (const response of clients) {
      if (!response.writableEnded && !response.destroyed)
        response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };
  host.on("event", broadcast);
  await host.initialize(fixture.cwd);
  if (savedSession) await host.action({ action: "session.new" });
  const initial = host.snapshot();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://127.0.0.1");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/api/token") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ token }));
      return;
    }
    if (
      (request.headers["x-desktop-token"] ?? url.searchParams.get("token")) !==
      token
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (url.pathname === "/api/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      clients.add(response);
      response.write(": connected\n\n");
      if (host.runtime)
        response.write(
          `data: ${JSON.stringify({ type: "snapshot", data: host.snapshot() })}\n\n`,
        );
      response.on("close", () => clients.delete(response));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const value = JSON.parse(body);
    const entry = {
      action: value.action,
      loading: !!gate,
      error: undefined as string | undefined,
    };
    requests.push(entry);
    try {
      if (value.action === "terminal.snapshot") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ data: { chunks: [] } }));
        return;
      }
      if (value.action === "initialize" && failInitialize) {
        failInitialize = false;
        throw new Error("Initialization fixture failed");
      }
      const data = await host.action(value);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: data ?? null }));
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: entry.error }));
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test address");
  return {
    initial,
    nextCwd,
    requests,
    async seedLegacyWorkspace() {
      const legacy = SessionManager.create(fixture.cwd, join(fixture.agentDir, "sessions", "legacy"));
      legacy.appendMessage({ role: "user", content: "Old startup session", timestamp: Date.now() });
      await writeFile(join(fixture.agentDir, "desktop.json"), JSON.stringify({ workspaces: [fixture.cwd] }));
    },
    url: `http://127.0.0.1:${address.port}`,
    hold() {
      entered = deferred();
      gate = deferred();
      return entered.promise;
    },
    release() {
      gate?.resolve();
      gate = undefined;
    },
    failNextInitialize() {
      failInitialize = true;
    },
    disconnect() {
      for (const response of clients) response.end();
      clients.clear();
    },
    async restart() {
      host.off("event", broadcast);
      await host.dispose();
      token = randomUUID();
      host = makeHost();
      host.on("event", broadcast);
      for (const response of clients) response.end();
      clients.clear();
    },
    snapshot() {
      return host.runtime ? host.snapshot() : undefined;
    },
    async enableStartupInput() {
      await cp(
        new URL("../fixtures/bootstrap-input.mjs", import.meta.url),
        join(fixture.agentDir, "extensions", "bootstrap-input.ts"),
      );
    },
    async close() {
      gate?.resolve();
      for (const response of clients) response.end();
      clients.clear();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await host.dispose();
      await fixture.close();
    },
  };
}

test("no-history startup and restart stay blank; drafts do not create sessions and first send creates one", async ({ page }) => {
  const backend = await recoveryBackend(false);
  try {
    await page.route("**/api/**", route => {
      const url = new URL(route.request().url());
      return route.continue({ url: backend.url + url.pathname + url.search });
    });
    await page.addInitScript(cwd => localStorage.setItem("pi.workspace.userSelection", cwd), backend.initial.cwd);
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    const rows = page.locator(".session-row");
    await expect(editor).toBeVisible();
    await expect(page.locator(".header-title h1")).toHaveText("开始对话");
    await expect(page.getByText("暂无会话", { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(0);
    expect(backend.snapshot()?.sessionFile).toBeUndefined();
    await editor.fill("尚未发送的工作区草稿");
    await expect.poll(() => page.evaluate(cwd => localStorage.getItem(`pi.draft.workspace:${cwd}`), backend.initial.cwd)).toBe("尚未发送的工作区草稿");
    await expect(rows).toHaveCount(0);
    await page.reload();
    await expect(editor).toHaveValue("尚未发送的工作区草稿");
    for (let attempt = 0; attempt < 2; attempt++) {
      const backendId = backend.snapshot()!.backendId;
      await backend.restart();
      await expect.poll(() => {
        const next = backend.snapshot();
        return !!next && next.backendId !== backendId && !next.changing &&
          next.editor.text === "尚未发送的工作区草稿";
      }).toBe(true);
      await expect(editor).toHaveValue("尚未发送的工作区草稿");
      await expect(rows).toHaveCount(0);
      expect(backend.snapshot()?.sessionFile).toBeUndefined();
    }
    await page.screenshot({ path: ".local/screenshots/startup-no-history.png" });
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy).toBe(false);
    await expect(rows).toHaveCount(1);
    await expect(page.locator(".transcript")).toContainText("尚未发送的工作区草稿");
    const sent = backend.snapshot()!;
    expect(sent.sessionFile).toBeTruthy();
    await backend.restart();
    await expect.poll(() => backend.snapshot()?.sessionId).toBe(sent.sessionId);
    await expect(rows).toHaveCount(1);
    await expect(page.locator(".notice")).toHaveCount(0);
  } finally {
    await page.close();
    await backend.close();
  }
});

test("an old automatic workspace stays closed until a folder is selected", async ({ page }) => {
  const backend = await recoveryBackend();
  const selectedCwd = await realpath(backend.nextCwd);
  try {
    await backend.seedLegacyWorkspace();
    await backend.restart();
    await page.route("**/api/**", route => {
      const url = new URL(route.request().url());
      return route.continue({ url: backend.url + url.pathname + url.search });
    });
    await page.addInitScript(cwd => localStorage.setItem("pi.workspace", cwd), backend.initial.cwd);
    await page.goto("/");
    const open = page.getByRole("button", { name: "打开工作区", exact: true });
    await expect(open).toBeVisible();
    await page.screenshot({ path: ".local/desktop-ui-review/after/startup-no-workspace.png", animations: "disabled" });
    expect(backend.snapshot()).toBeUndefined();
    await expect(page.locator(".session-project")).toHaveCount(0);

    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog");
    await expect(settings.getByRole("navigation", { name: "设置分类" })).toBeVisible();
    await settings.getByRole("button", { name: "模型与账号", exact: true }).click();
    await expect(settings.getByRole("combobox", { name: "默认模型", exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "项目", exact: true }).click();
    await expect(settings.getByText("未选择工作区", { exact: true })).toBeVisible();
    await expect(settings.getByRole("button", { name: "编辑项目默认值", exact: true })).toBeDisabled();
    await settings.getByRole("button", { name: "扩展与技能", exact: true }).click();
    await expect(settings.getByText("请先选择工作区", { exact: true })).toBeVisible();
    await expect(settings.getByRole("button", { name: "重新加载", exact: true })).toBeDisabled();
    await page.screenshot({ path: ".local/desktop-ui-review/after/settings-no-workspace-resources.png", animations: "disabled" });
    expect(backend.snapshot()).toBeUndefined();
    await settings.getByRole("button", { name: "关闭设置", exact: true }).click();

    await open.click();
    const picker = page.getByRole("dialog");
    await expect(picker.getByRole("button", { name: "主文件夹", exact: true })).toBeEnabled();
    await picker.getByRole("textbox", { name: "文件夹路径", exact: true }).fill(backend.nextCwd);
    await picker.getByRole("button", { name: "转到文件夹", exact: true }).click();
    await expect(picker.locator(".directory-footer > span")).toHaveAttribute("title", selectedCwd);
    await picker.getByRole("button", { name: "打开", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
    await expect.poll(() => backend.snapshot()?.cwd).toBe(selectedCwd);
    await expect(page.locator(".session-project")).toHaveCount(1);
    await expect(page.getByText("Old startup session", { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("pi.workspace.userSelection"))).toBe(selectedCwd);

    await backend.restart();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
    await expect.poll(() => backend.snapshot()?.cwd).toBe(selectedCwd);
  } finally {
    await page.close();
    await backend.close();
  }
});

for (const width of [1440, 760]) {
  test(`workspace bootstrap defers stale session synchronization at ${width}px`, async ({
    page,
  }) => {
    const backend = await recoveryBackend();
    try {
      await page.setViewportSize({ width, height: 940 });
      await page.route("**/api/**", (route) =>
        route.continue({
          url:
            backend.url +
            new URL(route.request().url()).pathname +
            new URL(route.request().url()).search,
        }),
      );
      await page.addInitScript(
        ({ cwd, sessionId }) => {
          localStorage.setItem("pi.workspace.userSelection", cwd);
          localStorage.setItem(
            `pi.draft.${sessionId}`,
            "Previous workspace draft",
          );
        },
        { cwd: backend.nextCwd, sessionId: backend.initial.sessionId },
      );
      const entered = backend.hold();
      await backend.restart();
      await page.goto("/");
      await entered;
      if (width === 1440) await page.screenshot({ path: ".local/desktop-ui-review/after/startup-loading.png", animations: "disabled" });
      // Keep the real runtime absent longer than the composer's debounce.
      await page.waitForTimeout(450);
      backend.release();
      const composer = page.getByRole("textbox", { name: "消息", exact: true });
      await expect(composer).toBeVisible();
      await expect(page.locator(".notice")).toHaveCount(0);
      expect(
        backend.requests.filter(
          ({ loading, action }) =>
            loading &&
            ["editor.restore", "editor.update", "sessions.list"].includes(
              action,
            ),
        ),
      ).toEqual([]);
      expect(backend.snapshot()?.cwd).toBe(backend.nextCwd);
      await composer.fill("Ready workspace draft");
      await expect
        .poll(() => backend.snapshot()?.editor.text)
        .toBe("Ready workspace draft");
    } finally {
      await page.close();
      await backend.close();
    }
  });

  test(`backend restart restores the active session and draft without adding a session at ${width}px`, async ({
    page,
  }) => {
    const backend = await recoveryBackend();
    try {
      await page.setViewportSize({ width, height: 940 });
      await page.route("**/api/**", (route) =>
        route.continue({
          url:
            backend.url +
            new URL(route.request().url()).pathname +
            new URL(route.request().url()).search,
        }),
      );
      await page.addInitScript(
        (cwd) => localStorage.setItem("pi.workspace.userSelection", cwd),
        backend.initial.cwd,
      );
      await page.goto("/");
      const composer = page.getByRole("textbox", { name: "消息", exact: true });
      await expect(composer).toBeVisible();
      await composer.fill("Restart recovery draft");
      await expect
        .poll(() => backend.snapshot()?.editor.text)
        .toBe("Restart recovery draft");
      const activeId = backend.snapshot()!.sessionId;
      await expect.poll(() => page.evaluate(
        id => localStorage.getItem(`pi.draft.${id}`), activeId,
      )).toBe("Restart recovery draft");
      const rows = page.locator(".session-row");
      await expect(rows).toHaveCount(1);
      await backend.restart();
      await expect
        .poll(() => backend.snapshot()?.sessionId)
        .toBe(activeId);
      expect(backend.snapshot()?.backendId).not.toBe(backend.initial.backendId);
      await expect(composer).toHaveValue("Restart recovery draft");
      await expect(rows).toHaveCount(1);
      await composer.fill("New backend draft");
      await expect
        .poll(() => backend.snapshot()?.editor.text)
        .toBe("New backend draft");
      await expect(page.locator(".notice")).toHaveCount(0);
      await page.screenshot({
        path: `.local/screenshots/connection-recovery-${width}.png`,
      });
    } finally {
      await page.close();
      await backend.close();
    }
  });

  test(`failed initialization retries on the next connection at ${width}px`, async ({
    page,
  }) => {
    const backend = await recoveryBackend();
    try {
      await page.setViewportSize({ width, height: 940 });
      await page.route("**/api/**", (route) =>
        route.continue({
          url:
            backend.url +
            new URL(route.request().url()).pathname +
            new URL(route.request().url()).search,
        }),
      );
      await page.addInitScript(
        (cwd) => localStorage.setItem("pi.workspace.userSelection", cwd),
        backend.nextCwd,
      );
      await backend.restart();
      backend.failNextInitialize();
      await page.goto("/");
      await expect(
        page.getByText("Initialization fixture failed", { exact: true }),
      ).toBeVisible();
      if (width === 1440) await page.screenshot({ path: ".local/desktop-ui-review/after/startup-failed.png", animations: "disabled" });
      backend.disconnect();
      await expect.poll(() => backend.snapshot()?.cwd).toBe(backend.nextCwd);
      await expect(
        page.getByRole("textbox", { name: "消息", exact: true }),
      ).toBeVisible();
      expect(
        backend.requests.filter(({ action }) => action === "initialize"),
      ).toHaveLength(2);
      expect(backend.requests.filter(({ error }) => error)).toHaveLength(1);
    } finally {
      await page.close();
      await backend.close();
    }
  });

  test(`late action responses cannot restore the retired backend at ${width}px`, async ({
    page,
  }) => {
    const backend = await recoveryBackend();
    const entered = deferred();
    const release = deferred();
    try {
      await page.setViewportSize({ width, height: 940 });
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        if (
          url.pathname === "/api/action" &&
          route.request().postDataJSON()?.action === "session.new"
        ) {
          const response = await route.fetch({
            url: backend.url + url.pathname,
          });
          entered.resolve();
          await release.promise;
          await route.fulfill({ response });
        } else
          await route.continue({
            url: backend.url + url.pathname + url.search,
          });
      });
      await page.addInitScript(
        (cwd) => localStorage.setItem("pi.workspace.userSelection", cwd),
        backend.initial.cwd,
      );
      await page.goto("/");
      const composer = page.getByRole("textbox", { name: "消息", exact: true });
      await expect(composer).toBeVisible();
      if (width < 800)
        await page
          .getByRole("button", { name: "打开侧边栏", exact: true })
          .click();
      await page.getByRole("button", { name: "新建会话", exact: true }).click();
      await entered.promise;
      await backend.restart();
      await expect
        .poll(() => backend.snapshot()?.cwd)
        .toBe(backend.initial.cwd);
      await expect(composer).toBeVisible();
      await composer.fill("Successor backend draft");
      await expect
        .poll(() => backend.snapshot()?.editor.text)
        .toBe("Successor backend draft");
      const response = page.waitForResponse(
        (response) =>
          response.request().postDataJSON()?.action === "session.new",
      );
      release.resolve();
      await response;
      await expect(composer).toHaveValue("Successor backend draft");
      await expect(page.locator(".notice")).toHaveCount(0);
      expect(backend.snapshot()?.backendId).not.toBe(backend.initial.backendId);
    } finally {
      release.resolve();
      await page.close();
      await backend.close();
    }
  });

  test(`initializing extensions retain mapped input and submission at ${width}px`, async ({
    page,
  }) => {
    const backend = await recoveryBackend();
    try {
      await backend.enableStartupInput();
      await backend.restart();
      await page.setViewportSize({ width, height: 940 });
      await page.route("**/api/**", (route) =>
        route.continue({
          url:
            backend.url +
            new URL(route.request().url()).pathname +
            new URL(route.request().url()).search,
        }),
      );
      await page.addInitScript(
        (cwd) => localStorage.setItem("pi.workspace.userSelection", cwd),
        backend.nextCwd,
      );
      await page.goto("/");
      const input = page.getByRole("textbox", {
        name: "Startup extension input",
        exact: true,
      });
      await expect(input).toBeVisible();
      await input.fill("Startup callback value");
      await input.press("Enter");
      await expect(input).toBeHidden();
      await expect(
        page.getByRole("textbox", { name: "消息", exact: true }),
      ).toBeVisible();
      expect(backend.snapshot()?.statuses["bootstrap-input"]).toBe(
        "Startup callback value",
      );
      await expect(page.locator(".notice")).toHaveCount(0);
    } finally {
      await page.close();
      await backend.close();
    }
  });
}
