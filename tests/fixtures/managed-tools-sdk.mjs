import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const mode = process.argv[2],
  assets = process.env.PI_MANAGED_ASSETS;
const { ManagedTools, loadManagedTools } =
  await import("../../backend/managed-tools.ts");
const api = await loadManagedTools();
const sdk = await import("@earendil-works/pi-coding-agent");
const bin = join(process.env.PI_CODING_AGENT_DIR, "bin");
await mkdir(bin, { recursive: true });
if (mode === "preinstalled")
  for (const tool of ["fd", "rg"])
    await cp(join(assets, `${tool}.exe`), join(bin, `${tool}.exe`));
assert.equal(
  api.getToolPath("fd"),
  mode === "preinstalled" ? join(bin, "fd.exe") : null,
);
assert.equal(
  api.getToolPath("rg"),
  mode === "preinstalled" ? join(bin, "rg.exe") : null,
);
const requests = [];
let failed = mode === "failure-retry";
let releaseDownloads,
  downloadCount = 0;
const held = new Promise((resolve) => (releaseDownloads = resolve));
const server = createServer(async (req, res) => {
  requests.push(req.url);
  const tool = req.url.includes("sharkdp") ? "fd" : "rg";
  if (req.url.endsWith("/latest")) {
    res.writeHead(302, {
      location: `https://github.com/${tool === "fd" ? "sharkdp/fd" : "BurntSushi/ripgrep"}/releases/tag/${tool === "fd" ? "v" : ""}1.0.0`,
    });
    res.end();
    return;
  }
  if (failed) {
    res.writeHead(404);
    res.end("Original fixture archive failure");
    return;
  }
  if (mode === "retire") {
    downloadCount++;
    await held;
  }
  res.writeHead(200, { "Content-Type": "application/zip" });
  res.end(await readFile(join(assets, `${tool}.zip`)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  const parsed = new URL(
    typeof url === "string" || url instanceof URL ? url : url.url,
  );
  if (parsed.hostname !== "github.com")
    throw new Error(`Unexpected native fetch ${parsed.hostname}`);
  return originalFetch(
    `http://127.0.0.1:${server.address().port}${parsed.pathname}`,
    options,
  );
};
const controller = new AbortController(),
  statuses = [];
const tools = new ManagedTools(controller.signal, (status) =>
  statuses.push(status),
);
let host, fixture;
try {
  if (mode === "retire") {
    const preparing = tools.prepare();
    const rejection = assert.rejects(preparing, { name: "AbortError" });
    while (downloadCount < 2)
      await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await rejection;
    const before = statuses.length,
      nativePending = Reflect.get(tools, "pending");
    releaseDownloads();
    // Original ensureTool has no cancellation API; wait for its own cache work
    // before removing this test's directory, but never adopt those late paths.
    await nativePending.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(statuses.length, before);
    assert.equal(tools.snapshot().state, "closed");
    assert.equal(tools.fdPath, undefined);
  } else {
    let result = await tools.prepare();
    if (mode === "offline" || mode === "failure-retry") {
      assert.deepEqual(result, { fd: undefined, rg: undefined });
      assert.equal(statuses.filter((s) => s.type === "warning").length, 2);
      if (mode === "offline") {
        assert.equal(requests.length, 0);
        assert.ok(
          statuses.every((s) => s.message.includes("Offline mode enabled")),
        );
      } else {
        assert.ok(
          statuses
            .filter((s) => s.type === "warning")
            .every((s) => s.message.includes("HTTP 404")),
        );
        failed = false;
        result = await tools.prepare({ refresh: true });
      }
    }
    if (mode !== "offline") {
      assert.deepEqual(result, {
        fd: join(bin, "fd.exe"),
        rg: join(bin, "rg.exe"),
      });
      for (const tool of ["fd", "rg"])
        assert.ok(
          execFileSync(result[tool], ["--version"], {
            encoding: "utf8",
          }).includes(tool === "fd" ? "fd" : "ripgrep"),
        );
      if (mode === "preinstalled") {
        assert.deepEqual(statuses, []);
        assert.equal(requests.length, 0);
      } else {
        assert.equal(
          requests.filter((url) => url.endsWith("/latest")).length,
          mode === "failure-retry" ? 4 : 2,
        );
        assert.equal(
          statuses.filter((s) => s.message.includes("installed to")).length,
          2,
        );
      }
    }
    if (mode === "download" || mode === "offline") {
      const { DesktopHost } = await import("../../backend/host.ts");
      const { createFixture } = await import("../fixture.ts");
      const { loadTuiApi } = await import("../../backend/tui-api.ts");
      fixture = await createFixture();
      host = new DesktopHost(fixture.agentDir);
      await mkdir(join(fixture.cwd, "nested", "deeper"), { recursive: true });
      await writeFile(
        join(fixture.cwd, "nested", "deeper", "needle-original.txt"),
        "Downloaded original fd completion",
      );
      await host.initialize(fixture.cwd);
      assert.equal(
        host.managedTools.fdPath,
        mode === "download" ? join(bin, "fd.exe") : undefined,
      );
      if (mode === "offline") {
        const app = host.desktopUI.terminalRuntime.capture().application;
        const rows = app.noticeEntries(0);
        assert.deepEqual(
          rows.map((row) => row.component.constructor.name),
          ["Spacer", "ThemedText", "ThemedText"],
        );
        assert.ok(
          rows
            .flatMap((row) => row.component.render(79))
            .join("\n")
            .includes("Offline mode enabled"),
        );
      }
      const tui = await loadTuiApi();
      for (const query of ["@needle", "@nested/needle"]) {
        const expected = new tui.CombinedAutocompleteProvider(
          [],
          fixture.cwd,
          result.fd,
        );
        const options = { signal: new AbortController().signal };
        const [actual, native] = await Promise.all([
          host.autocompleteProvider.getSuggestions(
            [query],
            0,
            query.length,
            options,
          ),
          expected.getSuggestions([query], 0, query.length, options),
        ]);
        assert.deepEqual(actual, native);
        if (mode === "download")
          assert.ok(
            actual.items.some((item) =>
              item.value.includes("needle-original.txt"),
            ),
          );
        else assert.equal(actual, null);
      }
    }
  }
  assert.equal(sdk.ensureTool, undefined); // No export/prototype replacement.
  console.log(
    JSON.stringify({
      mode,
      state: tools.snapshot().state,
      requests: requests.length,
      statuses,
    }),
  );
} finally {
  releaseDownloads();
  controller.abort();
  globalThis.fetch = originalFetch;
  await host?.dispose();
  await fixture?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
