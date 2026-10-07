import assert from "node:assert/strict";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, delimiter } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
const mode = process.argv[2];
const phase = (name) =>
  process.stderr.write(`[startup-policy-worker:${mode}] ${name}\n`);
phase("loading");
process.env.PI_DESKTOP_SKIP_STARTUP_POLICIES = "0";
process.env.PI_TELEMETRY = "0";
process.env.PI_OFFLINE = "1";
delete process.env.PI_SKIP_VERSION_CHECK;
delete process.env.TMUX;
const { DesktopHost } = await import("../../backend/host.ts");
const { createFixture } = await import("../fixture.ts");
const { createPackageNetworkFixture } =
  await import("../package-network-fixture.ts");
const { SettingsManager, DefaultPackageManager, VERSION } =
  await import("@earendil-works/pi-coding-agent");
const files = await createFixture();
let network;
const originalFetch = globalThis.fetch,
  latest = [];
let catalogs = 0;
globalThis.fetch = async (url, ...args) => {
  if (String(url) === "https://pi.dev/api/latest-version") {
    latest.push(args[0]);
    if (mode === "version-failure")
      throw new Error("Native version network failed");
    return Response.json(
      mode === "version-invalid"
        ? { version: 7 }
        : mode === "automatic"
          ? {
              version: "2.0.0",
              packageName: "native-sdk-package",
              note: "**Native release policy**",
            }
          : { version: VERSION },
    );
  }
  const parsed = new URL(String(url));
  assert.ok(
    ["127.0.0.1", "localhost"].includes(parsed.hostname),
    `Unexpected external request ${parsed.hostname}`,
  );
  return originalFetch(url, ...args);
};
const host = new DesktopHost(files.agentDir, {
  runtimeFactory: async (options, create) => {
    const result = await create(options);
    result.session.modelRuntime.refresh = async () => {
      catalogs++;
      return { aborted: false, errors: new Map() };
    };
    if (mode === "offline") process.env.PI_OFFLINE = "0";
    else delete process.env.PI_OFFLINE;
    if (mode === "skip-version") process.env.PI_SKIP_VERSION_CHECK = "1";
    return result;
  },
});
try {
  if (["automatic", "offline"].includes(mode)) {
    delete process.env.PI_OFFLINE;
    network = await createPackageNetworkFixture();
    phase("package fixture ready");
    const settings = SettingsManager.create(files.cwd, files.agentDir, {
      projectTrusted: true,
    });
    settings.setNpmCommand(network.config.npmCommand);
    const manager = new DefaultPackageManager({
      cwd: files.cwd,
      agentDir: files.agentDir,
      settingsManager: settings,
    });
    await manager.installAndPersist(`npm:${network.config.primary}`);
    phase("package installed");
    await settings.flush();
    const response = await originalFetch(`${network.config.url}/control`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fixture-token": network.config.token,
      },
      body: JSON.stringify({ operation: "publish", version: "1.1.0" }),
    });
    assert.equal(response.status, 200);
    phase("package published");
    process.env.PI_OFFLINE = "1";
  }
  if (mode.startsWith("tmux-")) {
    const bin = join(files.root, "tmux-bin"),
      preload = join(files.root, "tmux-preload.mjs");
    await mkdir(bin);
    await cp(
      process.execPath,
      join(bin, process.platform === "win32" ? "tmux.exe" : "tmux"),
    );
    await writeFile(
      preload,
      `
import { basename } from "node:path";
if (["tmux", "tmux.exe"].includes(basename(process.execPath).toLowerCase())) {
  // Bound the owned stub if the native synchronous probe kills only its shell.
  setTimeout(() => process.exit(0), 5000).unref();
  if (process.argv[1] === "display-message") { process.stdout.write("hyperlinks"); process.exit(0); }
  if (process.env.PI_TMUX_FIXTURE === "tmux-timeout") await new Promise(() => setInterval(() => {}, 1000));
  else { process.stdout.write(process.argv.at(-1) === "extended-keys" ? (process.env.PI_TMUX_FIXTURE === "tmux-off" ? "off" : "on") : (process.env.PI_TMUX_FIXTURE === "tmux-xterm" ? "xterm" : "csi-u")); process.exit(0); }
}`,
    );
    process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
    process.env.NODE_OPTIONS =
      `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`.trim();
    process.env.PI_TMUX_FIXTURE = mode;
    process.env.TMUX = "native-fixture";
  }
  phase("initialize");
  await host.initialize(files.cwd);
  phase("initialized");
  const deadline = Date.now() + 20000;
  while (
    Object.keys(host.startupPolicies.snapshot().checks).length !== 5 ||
    Object.values(host.startupPolicies.snapshot().checks).some(
      (check) => check.state === "running",
    )
  ) {
    assert.ok(
      Date.now() < deadline,
      "Automatic background checks did not settle",
    );
    await new Promise((done) => setTimeout(done, 20));
  }
  const checks = host.startupPolicies.snapshot().checks;
  assert.ok(
    Object.values(checks).every((check) => check.state === "settled"),
    JSON.stringify(checks),
  );
  assert.equal(host.startupPolicies.snapshot().automaticStarted, true);
  assert.equal(catalogs, mode === "offline" ? 0 : 1);
  assert.equal(
    latest.length,
    ["offline", "skip-version"].includes(mode) ? 0 : 1,
  );
  if (latest.length) {
    assert.ok(latest[0].signal instanceof AbortSignal);
    assert.ok(latest[0].headers["User-Agent"].includes(VERSION));
  }
  const content = host.desktopUI.terminalRuntime
    .capture()
    .application.noticeEntries(0)
    .flatMap((entry) => entry.component.render(100))
    .join("\n");
  if (mode === "automatic") {
    assert.deepEqual(checks.version.result, {
      version: "2.0.0",
      packageName: "native-sdk-package",
      note: "**Native release policy**",
    });
    assert.deepEqual(checks.packages.result, [network.config.primary]);
    assert.match(content, /Update Available/);
    assert.match(content, /Native release policy/);
    assert.match(content, /Package Updates Available/);
    assert.ok(content.includes(network.config.primary));
  } else {
    assert.equal(checks.version.result, undefined);
    assert.deepEqual(checks.packages.result, []);
    assert.doesNotMatch(content, /Update Available/);
  }
  if (mode === "tmux-off")
    assert.match(checks.tmux.result, /extended-keys is off/);
  else if (mode === "tmux-xterm")
    assert.match(checks.tmux.result, /extended-keys-format is xterm/);
  else assert.equal(checks.tmux.result, undefined);
  if (["tmux-off", "tmux-xterm"].includes(mode))
    assert.ok(
      stripVTControlCharacters(content)
        .replace(/\s+/g, " ")
        .includes(`Warning: ${checks.tmux.result}`.replace(/\s+/g, " ")),
    );
  const before = { catalogs, versions: latest.length };
  await host.initialize(files.cwd);
  assert.deepEqual({ catalogs, versions: latest.length }, before);
  phase("checks complete");
} finally {
  phase("dispose host");
  await host.dispose();
  phase("close package fixture");
  await network?.close();
  phase("close workspace fixture");
  await files.close();
  globalThis.fetch = originalFetch;
  phase("closed");
}
