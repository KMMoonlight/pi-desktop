import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function createPackage(sdk, root, name) {
  const paths = {
    primary: join(root, "extensions", "primary.ts"),
    secondary: join(root, "extensions", "secondary.ts"),
    skill: join(root, "skills", name, "SKILL.md"),
    prompt: join(root, "prompts", `${name}.md`),
    theme: join(root, "themes", `${name}.json`),
  };
  for (const directory of ["extensions", `skills/${name}`, "prompts", "themes"])
    await mkdir(join(root, directory), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      pi: {
        extensions: ["extensions"],
        skills: ["skills"],
        prompts: ["prompts"],
        themes: ["themes"],
      },
    }),
  );
  await writeFile(
    paths.primary,
    `export default pi => {
    pi.registerCommand(${JSON.stringify(name)}, {handler: (_args, ctx) => {
      ctx.ui.setEditorText(${JSON.stringify(name)});
      ctx.ui.setStatus("sdk-resources", ${JSON.stringify(name)});
    }});
  };`,
  );
  await writeFile(
    paths.secondary,
    `export default pi => pi.registerCommand(${JSON.stringify(`${name}-secondary`)}, {handler: () => {}});`,
  );
  await writeFile(
    paths.skill,
    `---\nname: ${name}\ndescription: SDK resource fixture\n---\nResource skill body.\n`,
  );
  await writeFile(
    paths.prompt,
    "---\ndescription: SDK prompt fixture\n---\nResource prompt body.\n",
  );
  const theme = JSON.parse(
    await readFile(
      join(
        sdk.getPackageDir(),
        "dist",
        "modes",
        "interactive",
        "theme",
        "dark.json",
      ),
      "utf8",
    ),
  );
  theme.name = name;
  await writeFile(paths.theme, JSON.stringify(theme));
  return paths;
}

export default async function (context, { mode }) {
  const { sdk, host, settingsManager, session, runtime } = context;
  if (mode === "recovery") {
    await session.prompt("sdk-resource-recovery");
    assert.ok(
      host.snapshot().messages.some((message) => message.role === "assistant"),
    );
    return { mode, complete: true };
  }
  const name = `sdk-resource-${randomUUID().slice(0, 8)}`;
  const root = join(runtime.services.agentDir, "desktop", name);
  const packageRoot = join(root, "package");
  const paths = await createPackage(sdk, packageRoot, name);
  const createManager = (settings = settingsManager) =>
    new sdk.DefaultPackageManager({
      cwd: runtime.cwd,
      agentDir: runtime.services.agentDir,
      settingsManager: settings,
      builtinExtensions: ["codemode", "tool_search", "mcp"],
    });

  if (/^(native|desktop)-(user|project)$/.test(mode)) {
    const local = mode.endsWith("project");
    const native = mode.startsWith("native");
    const globalPackages = settingsManager.getGlobalSettings().packages ?? [];
    const projectPackages = settingsManager.getProjectSettings().packages ?? [];
    const manager = createManager();
    const progress = [];
    manager.setProgressCallback((event) => progress.push(event));
    try {
      assert.equal(
        manager.getInstalledPath(packageRoot, local ? "project" : "user"),
        packageRoot,
      );
      if (native) {
        await manager.install(packageRoot, { local });
        assert.equal(
          manager
            .listConfiguredPackages()
            .some((item) => item.installedPath === packageRoot),
          false,
        );
        await manager.installAndPersist(packageRoot, { local });
        await settingsManager.flush();
        await session.reload();
      } else
        await host.action({
          action: "packages.install",
          args: { source: packageRoot, local },
        });
      const configured = manager
        .listConfiguredPackages()
        .find((item) => item.installedPath === packageRoot);
      assert.equal(configured.scope, local ? "project" : "user");
      const stored = JSON.parse(
        await readFile(
          local
            ? join(runtime.cwd, ".pi", "settings.json")
            : join(runtime.services.agentDir, "settings.json"),
          "utf8",
        ),
      );
      assert.ok(stored.packages.includes(configured.source));
      const resolved = await manager.resolve();
      for (const [kind, path] of [
        ["extensions", paths.primary],
        ["skills", paths.skill],
        ["prompts", paths.prompt],
        ["themes", paths.theme],
      ]) {
        const item = resolved[kind].find((item) => item.path === path);
        assert.equal(item.enabled, true, kind);
        assert.equal(item.metadata.scope, local ? "project" : "user", kind);
        assert.equal(item.metadata.packageRoot, packageRoot, kind);
      }
      assert.ok(
        session.extensionRunner
          .getRegisteredCommands()
          .some((command) => command.name === name),
      );
      assert.ok(
        session.resourceLoader
          .getSkills()
          .skills.some((skill) => skill.name === name),
      );
      assert.ok(session.promptTemplates.some((prompt) => prompt.name === name));
      assert.ok(
        session.resourceLoader
          .getThemes()
          .themes.some((theme) => theme.name === name),
      );
      await session.prompt(`/${name}`);
      assert.equal(
        session.extensionRunner.getUIContext().getEditorText(),
        name,
      );
      assert.equal(host.snapshot().statuses["sdk-resources"], name);
      await manager.update(packageRoot);
      assert.deepEqual(await manager.checkForAvailableUpdates(), []);
      if (native) {
        assert.equal(
          await manager.removeAndPersist(packageRoot, { local }),
          true,
        );
        assert.equal(
          await manager.removeAndPersist(packageRoot, { local }),
          false,
        );
        await settingsManager.flush();
        await session.reload();
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
      } else
        await host.action({
          action: "packages.remove",
          args: { source: packageRoot, local },
        });
      assert.equal(
        session.extensionRunner
          .getRegisteredCommands()
          .some((command) => command.name === name),
        false,
      );
      assert.equal(
        session.resourceLoader
          .getSkills()
          .skills.some((skill) => skill.name === name),
        false,
      );
      assert.equal(
        session.promptTemplates.some((prompt) => prompt.name === name),
        false,
      );
      assert.equal(
        session.resourceLoader
          .getThemes()
          .themes.some((theme) => theme.name === name),
        false,
      );
      assert.ok(
        (await stat(packageRoot)).isDirectory(),
        "removing a local source preserves its original files",
      );
    } finally {
      settingsManager.setPackages(globalPackages);
      settingsManager.setProjectPackages(projectPackages);
      await settingsManager.flush();
      await session.reload();
    }
  } else if (mode === "filters") {
    const settings = sdk.SettingsManager.inMemory(
      {
        packages: [
          { source: packageRoot, extensions: ["extensions/primary.ts"] },
        ],
        extensions: ["-builtin:mcp"],
      },
      { projectTrusted: true },
    );
    settings.setProjectPackages([
      {
        source: packageRoot,
        autoload: false,
        extensions: ["+extensions/secondary.ts"],
      },
    ]);
    settings.setProjectExtensionPaths(["+builtin:mcp"]);
    await settings.flush();
    const manager = createManager(settings);
    const resolved = await manager.resolve();
    assert.equal(
      resolved.extensions.find((item) => item.path === paths.primary).enabled,
      true,
    );
    assert.equal(
      resolved.extensions.find((item) => item.path === paths.secondary).enabled,
      true,
    );
    assert.equal(
      resolved.extensions.find((item) => item.path === paths.secondary).metadata
        .scope,
      "project",
    );
    assert.equal(
      resolved.extensions.find((item) => item.path === "builtin:mcp").enabled,
      true,
    );
    assert.equal(
      manager
        .listConfiguredPackages()
        .filter((item) => item.installedPath === packageRoot).length,
      2,
    );
    const before = settings.getSettings();
    const temporary = await manager.resolveExtensionSources(
      [packageRoot, "builtin:mcp"],
      { temporary: true },
    );
    assert.ok(temporary.extensions.some((item) => item.path === paths.primary));
    for (const resources of Object.values(temporary))
      for (const resource of resources)
        assert.equal(resource.metadata.scope, "temporary");
    assert.deepEqual(settings.getSettings(), before);
    settings.setProjectTrusted(false);
    assert.equal(
      (await manager.resolve()).extensions.find(
        (item) => item.path === "builtin:mcp",
      ).enabled,
      false,
    );
    await assert.rejects(
      manager.install(packageRoot, { local: true }),
      /trust/i,
    );
    await assert.rejects(
      manager.remove(packageRoot, { local: true }),
      /trust/i,
    );
  } else if (mode === "callbacks") {
    const missing = "npm:pi-desktop-sdk-audit-missing@1.0.0";
    const settings = sdk.SettingsManager.inMemory({ packages: [missing] });
    const manager = createManager(settings);
    const missingCalls = [];
    const skipped = await manager.resolve(async (source) => {
      missingCalls.push(source);
      return "skip";
    });
    assert.deepEqual(missingCalls, [missing]);
    assert.equal(
      skipped.extensions.some((item) => item.metadata.origin === "package"),
      false,
    );
    await assert.rejects(
      manager.resolve(async () => "error"),
      /Missing source/,
    );
    const failure = {};
    await assert.rejects(
      manager.resolve(async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
    settings.setPackages([]);
    const progress = [];
    manager.setProgressCallback((event) => progress.push(event));
    await manager.install(packageRoot);
    await manager.remove(packageRoot);
    await assert.rejects(
      manager.install(join(root, "absent")),
      /Path does not exist/,
    );
    assert.deepEqual(
      progress.map((event) => `${event.action}:${event.type}`),
      [
        "install:start",
        "install:complete",
        "remove:start",
        "remove:complete",
        "install:start",
        "install:error",
      ],
    );
    manager.setProgressCallback(undefined);
    await manager.install(packageRoot);
    assert.equal(progress.length, 6);
    assert.equal(manager.addSourceToSettings(packageRoot), true);
    const source = manager.listConfiguredPackages()[0].source;
    assert.equal(manager.addSourceToSettings(packageRoot), false);
    assert.equal(manager.getInstalledPath(source, "user"), packageRoot);
    assert.equal(manager.removeSourceFromSettings(packageRoot), true);
    assert.equal(manager.removeSourceFromSettings(packageRoot), false);
    assert.equal(
      manager.getInstalledPath(join(root, "absent"), "user"),
      undefined,
    );
    await assert.rejects(
      manager.update(packageRoot),
      /[Nn]o.*package|[Nn]o.*source/,
    );
    assert.deepEqual(await manager.checkForAvailableUpdates(), []);
  } else if (mode === "loader") {
    const systemPath = join(root, "system.md"),
      appendPath = join(root, "append.md");
    await writeFile(systemPath, "SDK system source");
    await writeFile(appendPath, "SDK append source");
    const settings = sdk.SettingsManager.inMemory({ packages: [packageRoot] });
    const calls = [];
    const loader = new sdk.DefaultResourceLoader({
      cwd: runtime.cwd,
      agentDir: runtime.services.agentDir,
      settingsManager: settings,
      noContextFiles: true,
      systemPrompt: systemPath,
      appendSystemPrompt: [appendPath],
      extensionsOverride: (value) => {
        calls.push("extensions");
        return value;
      },
      skillsOverride: (value) => {
        calls.push("skills");
        return value;
      },
      promptsOverride: (value) => {
        calls.push("prompts");
        return value;
      },
      themesOverride: (value) => {
        calls.push("themes");
        return value;
      },
      agentsFilesOverride: (value) => {
        calls.push("agents");
        return value;
      },
      systemPromptOverride: (value) => {
        calls.push("system");
        return `${value}\nSDK override`;
      },
      appendSystemPromptOverride: (value) => {
        calls.push("append");
        return [...value, "SDK appended override"];
      },
    });
    const bootstrap = await loader.loadProjectTrustExtensions();
    assert.ok(
      bootstrap.extensions.some(
        (extension) => extension.path === paths.primary,
      ),
    );
    await loader.reload({
      resolveProjectTrust: async ({ extensionsResult }) => {
        assert.ok(
          extensionsResult.extensions.some(
            (extension) => extension.path === paths.primary,
          ),
        );
        return true;
      },
    });
    assert.equal(settings.isProjectTrusted(), true);
    assert.ok(
      loader
        .getExtensions()
        .extensions.some((extension) => extension.path === paths.primary),
    );
    assert.ok(loader.getSkills().skills.some((skill) => skill.name === name));
    assert.ok(
      loader.getPrompts().prompts.some((prompt) => prompt.name === name),
    );
    assert.ok(loader.getThemes().themes.some((theme) => theme.name === name));
    assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
    assert.equal(loader.getSystemPrompt(), "SDK system source\nSDK override");
    assert.deepEqual(loader.getSystemPromptSource(), { path: systemPath });
    assert.deepEqual(loader.getAppendSystemPrompt(), [
      "SDK append source",
      "SDK appended override",
    ]);
    assert.deepEqual(loader.getAppendSystemPromptSources(), [
      { path: appendPath },
    ]);
    for (const callback of [
      "extensions",
      "skills",
      "prompts",
      "themes",
      "agents",
      "system",
      "append",
    ])
      assert.ok(calls.includes(callback), callback);
    const extraRoot = join(root, "extra");
    const extraName = `${name}-extra`;
    const extra = await createPackage(sdk, extraRoot, extraName);
    const metadata = {
      source: "sdk-resource-extension",
      scope: "temporary",
      origin: "top-level",
      baseDir: extraRoot,
    };
    loader.extendResources({
      skillPaths: [{ path: extra.skill, metadata }],
      promptPaths: [{ path: extra.prompt, metadata }],
      themePaths: [{ path: extra.theme, metadata }],
    });
    assert.ok(
      loader.getSkills().skills.some((skill) => skill.name === extraName),
    );
    assert.ok(
      loader.getPrompts().prompts.some((prompt) => prompt.name === extraName),
    );
    assert.ok(
      loader.getThemes().themes.some((theme) => theme.name === extraName),
    );
    await loader.reload();
    assert.equal(
      loader.getSkills().skills.some((skill) => skill.name === extraName),
      false,
    );
    assert.equal(
      loader.getPrompts().prompts.some((prompt) => prompt.name === extraName),
      false,
    );
    assert.equal(
      loader.getThemes().themes.some((theme) => theme.name === extraName),
      false,
    );
  } else if (mode === "settings") {
    const settingsCwd = join(root, "settings-workspace"),
      settingsAgent = join(root, "settings-agent");
    await mkdir(settingsCwd, { recursive: true });
    await mkdir(settingsAgent, { recursive: true });
    const first = sdk.SettingsManager.create(settingsCwd, settingsAgent, {
      projectTrusted: true,
    });
    const second = sdk.SettingsManager.create(settingsCwd, settingsAgent, {
      projectTrusted: true,
    });
    first.setDefaultProvider("sdk-provider");
    second.setDefaultModel("sdk-model");
    first.setProjectPackages([packageRoot]);
    first.setNpmCommand(["npm", "--offline"]);
    await Promise.all([first.flush(), second.flush()]);
    await second.reload();
    assert.equal(second.getDefaultProvider(), "sdk-provider");
    assert.equal(second.getDefaultModel(), "sdk-model");
    assert.deepEqual(second.getNpmCommand(), ["npm", "--offline"]);
    assert.deepEqual(second.getProjectSettings().packages, [packageRoot]);
    second.setProjectTrusted(false);
    assert.deepEqual(second.getProjectSettings(), {});
    second.setProjectTrusted(true);
    await second.reload();
    assert.deepEqual(second.getProjectSettings().packages, [packageRoot]);
    second.applyOverrides({ defaultModel: "temporary-model" });
    assert.equal(second.getDefaultModel(), "temporary-model");
    assert.equal(
      JSON.parse(await readFile(join(settingsAgent, "settings.json"), "utf8"))
        .defaultModel,
      "sdk-model",
    );
    const invalidAgent = join(root, "invalid-settings");
    await mkdir(invalidAgent, { recursive: true });
    await writeFile(join(invalidAgent, "settings.json"), "{");
    const invalid = sdk.SettingsManager.create(settingsCwd, invalidAgent);
    assert.ok(
      invalid
        .drainErrors()
        .some((item) => item.scope === "global" && item.error instanceof Error),
    );
    assert.deepEqual(invalid.drainErrors(), []);
    const saved = new Map();
    const scopes = [];
    const custom = sdk.SettingsManager.fromStorage({
      withLock(scope, update) {
        scopes.push(scope);
        const next = update(saved.get(scope));
        if (next !== undefined) saved.set(scope, next);
      },
    });
    custom.setDefaultModel("custom-storage-model");
    await custom.flush();
    assert.ok(scopes.includes("global"));
    assert.equal(
      JSON.parse(saved.get("global")).defaultModel,
      "custom-storage-model",
    );
  } else throw new Error(`Unknown SDK resources mode: ${mode}`);
  return { mode, complete: true };
}
