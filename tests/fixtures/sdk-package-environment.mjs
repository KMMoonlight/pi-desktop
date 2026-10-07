import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );
const versionAt = async (path) =>
  JSON.parse(await readFile(join(path, "package.json"), "utf8")).version;
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

export default async function (
  { sdk, host, session, runtime, settingsManager },
  { mode, network },
) {
  if (mode === "recovery") {
    await session.prompt("sdk-package-environment-recovery");
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
  const keys = new Set(
    Object.keys(network.npmEnvironment).map((key) => key.toLowerCase()),
  );
  const previousEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => keys.has(key.toLowerCase())),
  );
  const removeEnvironment = () => {
    for (const key of Object.keys(process.env))
      if (keys.has(key.toLowerCase())) delete process.env[key];
  };
  const original = {
    npmCommand: settingsManager.getNpmCommand(),
    packages: settingsManager.getGlobalSettings().packages ?? [],
    project: settingsManager.getProjectSettings().packages ?? [],
    offline: process.env.PI_OFFLINE,
  };
  removeEnvironment();
  Object.assign(process.env, network.npmEnvironment);
  delete process.env.PI_OFFLINE;
  settingsManager.setNpmCommand(undefined);
  const source = `npm:${network.primary}`;
  const legacyPath = join(network.legacyModules, network.primary);
  const managedPath = join(
    runtime.services.agentDir,
    "npm/node_modules",
    network.primary,
  );
  const manager = new sdk.DefaultPackageManager({
    cwd: runtime.cwd,
    agentDir: runtime.services.agentDir,
    settingsManager,
  });
  const verifyCommand = async (version) => {
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
  const configured = async (source) => {
    manager.addSourceToSettings(source);
    await settingsManager.flush();
    await session.reload();
  };
  try {
    assert.equal(settingsManager.getNpmCommand(), undefined);
    if (mode === "default-command") {
      await host.action({ action: "packages.install", args: { source } });
      assert.equal(manager.getInstalledPath(source, "user"), managedPath);
      assert.equal(await versionAt(managedPath), "1.0.0");
      assert.equal(await exists(legacyPath), false);
      await verifyCommand("1.0.0");
      await control("publish", { version: "1.1.0" });
      await host.action({ action: "packages.update", args: { source } });
      await verifyCommand("1.1.0");
      await host.action({ action: "packages.remove", args: { source } });
      assert.equal(await exists(managedPath), false);
      await host.action({
        action: "packages.install",
        args: { source, local: true },
      });
      const projectPath = manager.getInstalledPath(source, "project");
      assert.equal(
        projectPath,
        join(runtime.cwd, ".pi/npm/node_modules", network.primary),
      );
      assert.equal(await versionAt(projectPath), "1.1.0");
      await verifyCommand("1.1.0");
      await host.action({
        action: "packages.remove",
        args: { source, local: true },
      });
      assert.equal(await exists(projectPath), false);
      assert.equal(await exists(legacyPath), false);
    } else if (mode === "legacy-update" || mode === "legacy-version") {
      await control("installLegacy");
      assert.equal(await versionAt(legacyPath), "1.0.0");
      const legacyHashes = await Promise.all(
        [
          "package.json",
          "extensions/primary.ts",
          "extensions/secondary.ts",
        ].map((file) => hash(join(legacyPath, file))),
      );
      const before = (await control("state")).requests.length;
      await configured(mode === "legacy-version" ? `${source}@1.0.0` : source);
      assert.equal(manager.getInstalledPath(source, "user"), legacyPath);
      assert.equal(await exists(managedPath), false);
      const resources = await manager.resolve();
      assert.ok(
        resources.extensions.some(
          (item) =>
            item.metadata.packageRoot === legacyPath &&
            item.metadata.scope === "user",
        ),
      );
      await verifyCommand("1.0.0");
      assert.equal((await control("state")).requests.length, before);
      await control("publish", { version: "1.1.0" });
      if (mode === "legacy-update") {
        const updates = await manager.checkForAvailableUpdates();
        assert.equal(updates.length, 1);
        assert.equal(updates[0].scope, "user");
        await host.action({ action: "packages.update", args: { source } });
        assert.equal(manager.getInstalledPath(source, "user"), managedPath);
        assert.equal(await versionAt(managedPath), "1.1.0");
        await verifyCommand("1.1.0");
      } else {
        assert.deepEqual(await manager.checkForAvailableUpdates(), []);
        await manager.update();
        assert.equal(await exists(managedPath), false);
        await control("publish", { version: "2.0.0" });
        await configured(`${source}@2.0.0`);
        assert.equal(manager.getInstalledPath(source, "user"), managedPath);
        assert.equal(await versionAt(managedPath), "2.0.0");
        await verifyCommand("2.0.0");
        await configured(`${source}@^1.0.0`);
        assert.equal(await versionAt(managedPath), "1.1.0");
        await verifyCommand("1.1.0");
      }
      assert.equal(await versionAt(legacyPath), "1.0.0");
      assert.deepEqual(
        await Promise.all(
          [
            "package.json",
            "extensions/primary.ts",
            "extensions/secondary.ts",
          ].map((file) => hash(join(legacyPath, file))),
        ),
        legacyHashes,
      );
      await host.action({ action: "packages.remove", args: { source } });
      assert.equal(await exists(managedPath), false);
      assert.equal(manager.getInstalledPath(source, "user"), legacyPath);
      assert.equal(
        session.extensionRunner
          .getRegisteredCommands()
          .some((item) => item.name === network.command),
        false,
      );
      assert.equal(
        manager
          .listConfiguredPackages()
          .some((item) => item.source.startsWith(source)),
        false,
      );
      const root = join(
        runtime.services.agentDir,
        "desktop",
        `legacy-${randomUUID()}`,
      );
      await mkdir(root, { recursive: true });
      const settings = sdk.SettingsManager.inMemory();
      const lookup = new sdk.DefaultPackageManager({
        cwd: runtime.cwd,
        agentDir: root,
        settingsManager: settings,
      });
      assert.equal(lookup.getInstalledPath(source, "user"), legacyPath);
      settings.setNpmCommand([
        ...network.npmCommand,
        `--prefix=${join(root, "empty-global")}`,
      ]);
      assert.equal(lookup.getInstalledPath(source, "user"), undefined);
      settings.setNpmCommand(undefined);
      assert.equal(lookup.getInstalledPath(source, "user"), legacyPath);
    } else throw new Error(`Unknown package environment mode: ${mode}`);
  } finally {
    settingsManager.setNpmCommand(original.npmCommand);
    settingsManager.setPackages(original.packages);
    settingsManager.setProjectPackages(original.project);
    removeEnvironment();
    Object.assign(process.env, previousEnvironment);
    if (original.offline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = original.offline;
    await settingsManager.flush();
    await session.reload();
  }
  return { mode, complete: true };
}
