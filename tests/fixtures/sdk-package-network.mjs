import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const execute = promisify(execFile);
const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );
const versionAt = async (path) =>
  JSON.parse(await readFile(join(path, "package.json"), "utf8")).version;
const gitHead = async (path) =>
  (
    await execute("git", ["rev-parse", "HEAD"], {
      cwd: path,
      windowsHide: true,
    })
  ).stdout.trim();

export default async function (context, { mode, network }) {
  const { sdk, host, session, runtime, settingsManager } = context;
  if (mode === "recovery") {
    await session.prompt("sdk-package-network-recovery");
    assert.ok(
      host.snapshot().messages.some((message) => message.role === "assistant"),
    );
    return { mode, complete: true };
  }
  const control = async (operation, options = {}) => {
    const response = await fetch(`${network.url}/control`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fixture-token": network.token,
      },
      body: JSON.stringify({ operation, ...options }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const root = join(
    runtime.services.agentDir,
    "desktop",
    `network-${randomUUID()}`,
  );
  await mkdir(root, { recursive: true });
  const isolatedSettings = () =>
    sdk.SettingsManager.inMemory(
      { npmCommand: network.npmCommand },
      { projectTrusted: true },
    );
  const managerFor = (
    settings = settingsManager,
    agentDir = runtime.services.agentDir,
    cwd = runtime.cwd,
  ) =>
    new sdk.DefaultPackageManager({ settingsManager: settings, agentDir, cwd });
  const original = {
    npm: settingsManager.getNpmCommand(),
    packages: settingsManager.getGlobalSettings().packages ?? [],
    project: settingsManager.getProjectSettings().packages ?? [],
    offline: process.env.PI_OFFLINE,
  };
  const source = mode.startsWith("git")
    ? network.gitSource
    : `npm:${network.primary}`;
  const progress = [];
  const manager = managerFor();
  manager.setProgressCallback((event) => progress.push(event));
  settingsManager.setNpmCommand(network.npmCommand);
  delete process.env.PI_OFFLINE;
  const verifyCommand = async (version) => {
    assert.ok(
      session.extensionRunner
        .getRegisteredCommands()
        .some((item) => item.name === network.command),
    );
    await session.prompt(`/${network.command}`);
    assert.equal(
      session.extensionRunner.getUIContext().getEditorText(),
      `dependency-loaded:${version}`,
    );
    assert.equal(
      host.snapshot().statuses["sdk-package-network"],
      `dependency-loaded:${version}`,
    );
  };
  try {
    if (/^(npm|git)-(user|project)$/.test(mode)) {
      const local = mode.endsWith("project");
      const scope = local ? "project" : "user";
      await manager.installAndPersist(source, { local });
      await settingsManager.flush();
      const path = manager.getInstalledPath(source, scope);
      assert.ok(await exists(path));
      assert.equal(await versionAt(path), "1.0.0");
      if (mode.startsWith("git"))
        assert.equal(
          await exists(join(path, "node_modules", network.secondary)),
          false,
        );
      const configured = manager
        .listConfiguredPackages()
        .find((item) => item.source === source);
      assert.equal(configured.scope, scope);
      const persisted = JSON.parse(
        await readFile(
          local
            ? join(runtime.cwd, ".pi/settings.json")
            : join(runtime.services.agentDir, "settings.json"),
          "utf8",
        ),
      );
      assert.ok(persisted.packages.includes(source));
      const resolved = await manager.resolve();
      const resource = resolved.extensions.find(
        (item) => item.path === join(path, "extensions/primary.ts"),
      );
      assert.equal(resource.metadata.scope, scope);
      assert.equal(resource.metadata.packageRoot, path);
      await session.reload();
      await verifyCommand("1.0.0");
      assert.deepEqual(await manager.checkForAvailableUpdates(), []);
      if (mode.startsWith("npm"))
        await control("publish", { version: "1.1.0" });
      else await control("advanceGit", { version: "1.1.0" });
      assert.deepEqual(
        (await manager.checkForAvailableUpdates()).map(
          ({ source, type, scope }) => ({ source, type, scope }),
        ),
        [{ source, type: mode.startsWith("npm") ? "npm" : "git", scope }],
      );
      await host.action({ action: "packages.update", args: { source } });
      assert.equal(await versionAt(path), "1.1.0");
      await verifyCommand("1.1.0");
      assert.deepEqual(await manager.checkForAvailableUpdates(), []);
      assert.equal(await manager.removeAndPersist(source, { local }), true);
      await settingsManager.flush();
      await session.reload();
      assert.equal(await exists(path), false);
      assert.equal(
        session.extensionRunner
          .getRegisteredCommands()
          .some((item) => item.name === network.command),
        false,
      );
      await host.action({
        action: "packages.install",
        args: { source, local },
      });
      await verifyCommand("1.1.0");
      assert.equal(await versionAt(path), "1.1.0");
      await host.action({ action: "packages.remove", args: { source, local } });
      assert.equal(await exists(path), false);
      assert.equal(
        manager.listConfiguredPackages().some((item) => item.source === source),
        false,
      );
      assert.ok(
        progress.some(
          (event) => event.type === "complete" && event.action === "install",
        ),
      );
      assert.ok(
        progress.some(
          (event) => event.type === "complete" && event.action === "remove",
        ),
      );
      const state = await control("state");
      assert.ok(
        state.requests.some(
          (req) => req.path.startsWith("/tarballs/") && req.status === 200,
        ),
      );
      assert.ok(
        state.requests.some(
          (req) => req.path === `/${network.dependency}` && req.status === 200,
        ),
      );
      assert.equal(
        state.requests.some((req) => req.path.includes("@earendil-works")),
        false,
      );
      if (mode.startsWith("git"))
        assert.ok(
          state.requests.some(
            (req) => req.path.includes("/objects/") && req.status === 200,
          ),
        );
    } else if (mode === "npm-policy") {
      const settings = isolatedSettings();
      const policy = managerFor(
        settings,
        join(root, "agent"),
        join(root, "workspace"),
      );
      await mkdir(join(root, "workspace"), { recursive: true });
      const exact = `npm:${network.primary}@1.0.0`;
      const range = `npm:${network.primary}@^1.0.0`;
      await policy.installAndPersist(exact);
      const path = policy.getInstalledPath(exact, "user");
      await control("publish", { version: "1.1.0" });
      await control("publish", { version: "2.0.0" });
      assert.deepEqual(await policy.checkForAvailableUpdates(), []);
      await policy.update();
      assert.equal(await versionAt(path), "1.0.0");
      assert.equal(policy.addSourceToSettings(range), true);
      assert.deepEqual(settings.getGlobalSettings().packages, [range]);
      assert.equal((await policy.checkForAvailableUpdates()).length, 1);
      const second = `npm:${network.secondary}@^1.0.0`;
      await policy.installAndPersist(`${second.replace("^1.0.0", "1.0.0")}`);
      policy.addSourceToSettings(second);
      await policy.update();
      assert.equal(await versionAt(path), "1.1.0");
      assert.equal(
        await versionAt(policy.getInstalledPath(second, "user")),
        "1.1.0",
      );
      assert.deepEqual(await policy.checkForAvailableUpdates(), []);
      await policy.installAndPersist(`npm:${network.primary}`, { local: true });
      const projectPath = policy.getInstalledPath(range, "project");
      assert.equal(await versionAt(projectPath), "2.0.0");
      const resolved = await policy.resolve();
      assert.ok(
        resolved.extensions.some(
          (item) =>
            item.metadata.packageRoot === projectPath &&
            item.metadata.scope === "project",
        ),
      );
      assert.equal(
        resolved.extensions.some((item) => item.metadata.packageRoot === path),
        false,
      );
      settings.setProjectPackages([
        {
          source: range,
          autoload: false,
          extensions: ["-extensions/secondary.ts"],
        },
      ]);
      const delta = await policy.resolve();
      assert.ok(
        delta.extensions.some(
          (item) =>
            item.path === join(path, "extensions/primary.ts") && item.enabled,
        ),
      );
      assert.ok(
        delta.extensions.some(
          (item) =>
            item.path === join(path, "extensions/secondary.ts") &&
            !item.enabled,
        ),
      );
      const beforeSettings = structuredClone(
        settings.getGlobalSettings().packages,
      );
      const temporary = await policy.resolveExtensionSources([exact], {
        temporary: true,
      });
      const temporaryRoot = temporary.extensions[0].metadata.packageRoot;
      assert.equal(temporary.extensions[0].metadata.scope, "temporary");
      assert.equal(await versionAt(temporaryRoot), "1.0.0");
      assert.notEqual(temporaryRoot, path);
      assert.deepEqual(settings.getGlobalSettings().packages, beforeSettings);
      process.env.PI_OFFLINE = "1";
      const before = (await control("state")).requests.length;
      assert.deepEqual(await policy.checkForAvailableUpdates(), []);
      await policy.update();
      assert.ok(
        (await policy.resolveExtensionSources([exact], { temporary: true }))
          .extensions.length,
      );
      assert.equal((await control("state")).requests.length, before);
      const missingSettings = isolatedSettings();
      missingSettings.setPackages([
        `npm:pi-network-never-published-${randomUUID()}`,
      ]);
      const missing = managerFor(missingSettings, join(root, "missing"));
      let called = false;
      assert.equal(
        (
          await missing.resolve(async () => {
            called = true;
            return "install";
          })
        ).extensions.length,
        0,
      );
      assert.equal(called, false);
      delete process.env.PI_OFFLINE;
      await assert.rejects(
        policy.update("npm:pi-network-unknown"),
        /No matching/i,
      );
    } else if (mode === "git-policy") {
      const settings = isolatedSettings();
      const policy = managerFor(settings, join(root, "agent"));
      const v1 = `${source}@v1.0.0`;
      const v2 = `${source}@v1.1.0`;
      await policy.installAndPersist(v1);
      const path = policy.getInstalledPath(source, "user");
      const initial = await control("state");
      assert.equal(await gitHead(path), initial.commits["1.0.0"]);
      const next = await control("advanceGit", { version: "1.1.0" });
      assert.deepEqual(await policy.checkForAvailableUpdates(), []);
      await policy.update();
      assert.equal(await gitHead(path), initial.commits["1.0.0"]);
      assert.equal(policy.addSourceToSettings(v2), true);
      await writeFile(join(path, "extensions/primary.ts"), "dirty fixture");
      await writeFile(join(path, "untracked.txt"), "temporary fixture");
      await policy.update();
      assert.equal(await gitHead(path), next.commits["1.1.0"]);
      assert.equal(await exists(join(path, "untracked.txt")), false);
      assert.ok(await exists(join(path, "node_modules", network.dependency)));
      await rm(join(path, "node_modules", network.dependency), {
        recursive: true,
        force: true,
      });
      await policy.update();
      assert.ok(await exists(join(path, "node_modules", network.dependency)));
      const a = await policy.resolveExtensionSources([v1], { temporary: true });
      const b = await policy.resolveExtensionSources([v2], { temporary: true });
      const aPath = a.extensions[0].metadata.packageRoot;
      const bPath = b.extensions[0].metadata.packageRoot;
      assert.notEqual(aPath, bPath);
      assert.equal(await gitHead(aPath), initial.commits["1.0.0"]);
      assert.equal(await gitHead(bPath), next.commits["1.1.0"]);
      const floating = await policy.resolveExtensionSources([source], {
        temporary: true,
      });
      const floatingPath = floating.extensions[0].metadata.packageRoot;
      const newest = await control("advanceGit", { version: "2.0.0" });
      await policy.resolveExtensionSources([source], { temporary: true });
      assert.equal(await gitHead(floatingPath), newest.commits["2.0.0"]);
      await control("faults", { git: true });
      assert.ok(
        (await policy.resolveExtensionSources([source], { temporary: true }))
          .extensions.length,
      );
      assert.equal(await gitHead(floatingPath), newest.commits["2.0.0"]);
      process.env.PI_OFFLINE = "true";
      const before = (await control("state")).requests.length;
      assert.ok(
        (await policy.resolveExtensionSources([source], { temporary: true }))
          .extensions.length,
      );
      await policy.update();
      assert.deepEqual(await policy.checkForAvailableUpdates(), []);
      assert.equal((await control("state")).requests.length, before);
      delete process.env.PI_OFFLINE;
    } else if (mode === "failure") {
      const settings = isolatedSettings();
      const policy = managerFor(settings, join(root, "agent"));
      const errors = [];
      policy.setProgressCallback((event) => errors.push(event));
      settings.setPackages([`npm:${network.primary}`]);
      const before = (await control("state")).requests.length;
      assert.equal(
        (await policy.resolve(async () => "skip")).extensions.length,
        0,
      );
      await assert.rejects(
        policy.resolve(async () => "error"),
        /Missing source/,
      );
      const rejection = { original: true };
      await assert.rejects(
        policy.resolve(async () => {
          throw rejection;
        }),
        (error) => error === rejection,
      );
      assert.equal((await control("state")).requests.length, before);
      assert.ok(
        (await policy.resolve(async () => "install")).extensions.length,
      );
      const path = policy.getInstalledPath(`npm:${network.primary}`, "user");
      await control("faults", { registry: true });
      assert.deepEqual(await policy.checkForAvailableUpdates(), []);
      await assert.rejects(policy.update());
      assert.equal(await versionAt(path), "1.0.0");
      const missing = `npm:pi-network-missing-${randomUUID()}`;
      await assert.rejects(policy.installAndPersist(missing));
      assert.equal(
        settings.getGlobalSettings().packages.includes(missing),
        false,
      );
      const git = network.gitSource;
      assert.equal(policy.getInstalledPath(git, "user"), undefined);
      settings.setNpmCommand([
        ...network.npmCommand,
        "--offline",
        `--cache=${join(root, "empty-cache")}`,
      ]);
      await assert.rejects(policy.installAndPersist(git));
      assert.equal(policy.getInstalledPath(git, "user"), undefined);
      assert.equal(settings.getGlobalSettings().packages.includes(git), false);
      await control("faults", {});
      settings.setNpmCommand(network.npmCommand);
      await policy.installAndPersist(git);
      const gitPath = policy.getInstalledPath(git, "user");
      assert.equal(typeof gitPath, "string");
      await control("advanceGit", { version: "1.1.0" });
      settings.setNpmCommand([
        ...network.npmCommand,
        "--offline",
        `--cache=${join(root, "empty-cache")}`,
      ]);
      await assert.rejects(policy.update(git));
      const marker = join(
        dirname(gitPath),
        `.${basename(gitPath)}.pi-update-incomplete`,
      );
      assert.equal(await exists(marker), true);
      await control("faults", {});
      settings.setNpmCommand(network.npmCommand);
      await policy.update(git);
      assert.equal(await exists(marker), false);
      assert.equal(await versionAt(gitPath), "1.1.0");
      assert.ok(
        await exists(join(gitPath, "node_modules", network.dependency)),
      );
      await control("faults", { git: true });
      await assert.rejects(policy.update(git));
      assert.equal(await versionAt(gitPath), "1.1.0");
      await control("faults", {});
      assert.ok(
        errors.some(
          (event) => event.type === "error" && event.action === "install",
        ),
      );
      assert.ok(
        errors.some(
          (event) => event.type === "error" && event.action === "update",
        ),
      );
      policy.setProgressCallback(undefined);
      await policy.removeAndPersist(git);
      assert.equal(await exists(gitPath), false);
    } else throw new Error(`Unknown network mode: ${mode}`);
  } finally {
    await control("faults", {});
    if (original.offline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = original.offline;
    settingsManager.setNpmCommand(original.npm);
    settingsManager.setPackages(original.packages);
    settingsManager.setProjectPackages(original.project);
    await settingsManager.flush();
    await session.reload();
  }
  return { mode, complete: true };
}
