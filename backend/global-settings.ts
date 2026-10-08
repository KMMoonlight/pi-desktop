import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ModelRuntime,
  SettingsManager,
  DefaultPackageManager,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import type {
  ActionRequest,
  DesktopSettingsSnapshot,
  RecordValue,
} from "../shared/types.ts";

export const globalSettingsActions = new Set([
  "settings.snapshot",
  "settings.save",
  "models.refresh",
  "models.scope",
  "auth.login",
  "auth.logout",
  "config.read",
  "config.save",
  "theme.set",
  "display.thinking",
  "packages.list",
  "packages.install",
  "packages.remove",
  "packages.update",
]);

/** Global preferences and provider credentials need no session or project resources. */
export class GlobalSettings {
  readonly settings: SettingsManager;
  private models?: Promise<ModelRuntime>;
  constructor(
    private agentDir: string,
    private signal: AbortSignal,
    private login: (
      models: ModelRuntime,
      settings: SettingsManager,
      args: RecordValue,
    ) => Promise<void>,
    private notify: (message: string) => void,
  ) {
    this.settings = SettingsManager.create(agentDir, agentDir, {
      projectTrusted: false,
    });
  }
  private modelRuntime() {
    return (this.models ??= ModelRuntime.create({
      authPath: join(this.agentDir, "auth.json"),
      modelsPath: join(this.agentDir, "models.json"),
      signal: this.signal,
    }).catch((error) => {
      this.models = undefined;
      throw error;
    }));
  }
  async snapshot(): Promise<DesktopSettingsSnapshot> {
    await this.settings.reload();
    const runtime = await this.modelRuntime();
    const available = new Set(
      runtime.getAvailableSnapshot().map((m) => `${m.provider}/${m.id}`),
    );
    const models = runtime.getModels().map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow,
      reasoning: m.reasoning,
      available: available.has(`${m.provider}/${m.id}`),
    }));
    return {
      version: VERSION,
      agentDir: this.agentDir,
      cwd: "",
      busy: false,
      changing: false,
      trusted: false,
      resources: [],
      settings: this.settings.getSettings() as RecordValue,
      globalSettings: this.settings.getGlobalSettings() as RecordValue,
      projectSettings: {},
      models,
      model: models.find(
        (m) =>
          m.id === this.settings.getDefaultModel() &&
          m.provider === this.settings.getDefaultProvider(),
      ),
      scopedModels: this.settings.getEnabledModels() ?? [],
      providers: runtime.getProviders().map((p) => {
        const status = runtime.getProviderAuthStatus(p.id);
        return {
          id: p.id,
          name: p.name ?? p.id,
          configured: status.configured,
          source: status.source,
          methods: Object.keys(p.auth ?? {}).filter((k) =>
            ["apiKey", "oauth"].includes(k),
          ),
        };
      }),
    };
  }
  async action({ action, args = {} }: ActionRequest): Promise<unknown> {
    if (args.local === true || args.scope === "project")
      throw new Error("请先选择工作区");
    switch (action) {
      case "settings.snapshot":
        return this.snapshot();
      case "settings.save": {
        const value = args.settings;
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("配置格式错误");
        await mkdir(this.agentDir, { recursive: true });
        await writeFile(
          join(this.agentDir, "settings.json"),
          JSON.stringify(value, null, 2),
        );
        await this.settings.reload();
        break;
      }
      case "config.read":
      case "config.save": {
        if (args.name !== "models.json" && args.name !== "mcp.json")
          throw new Error("配置文件不受支持");
        const path = join(this.agentDir, args.name);
        if (action === "config.read") {
          try {
            return await readFile(path, "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return "{}";
            throw error;
          }
        }
        if (typeof args.content !== "string")
          throw new Error("配置内容不能为空");
        const value = JSON.parse(args.content);
        await mkdir(this.agentDir, { recursive: true });
        await writeFile(path, JSON.stringify(value, null, 2));
        if (args.name === "models.json")
          await (await this.modelRuntime()).refresh({ allowNetwork: false });
        break;
      }
      case "models.refresh":
        await (await this.modelRuntime()).refresh();
        break;
      case "models.scope":
        this.settings.setEnabledModels(
          Array.isArray(args.models) && args.models.length
            ? args.models.filter((id): id is string => typeof id === "string")
            : undefined,
        );
        break;
      case "auth.login":
        await this.login(await this.modelRuntime(), this.settings, args);
        break;
      case "auth.logout":
        if (typeof args.provider !== "string" || !args.provider)
          throw new Error("提供商不能为空");
        await (await this.modelRuntime()).logout(args.provider);
        break;
      case "theme.set":
        if (typeof args.theme !== "string" || !args.theme)
          throw new Error("Theme is required");
        this.settings.setTheme(args.theme);
        break;
      case "display.thinking":
        this.settings.setHideThinkingBlock(args.visible !== true);
        break;
      default: {
        const packages = new DefaultPackageManager({
          cwd: this.agentDir,
          agentDir: this.agentDir,
          settingsManager: this.settings,
          builtinExtensions: ["codemode", "tool_search", "mcp"],
        });
        packages.setProgressCallback((event) =>
          this.notify(event.message ?? `${event.action}: ${event.source}`),
        );
        if (action === "packages.list")
          return packages.listConfiguredPackages();
        if (action === "packages.update")
          await packages.update(
            typeof args.source === "string" ? args.source : undefined,
          );
        else {
          if (typeof args.source !== "string" || !args.source)
            throw new Error("包地址不能为空");
          if (action === "packages.install")
            await packages.installAndPersist(args.source, { local: false });
          else if (action === "packages.remove")
            await packages.removeAndPersist(args.source, { local: false });
          else throw new Error(`未知操作：${action}`);
        }
      }
    }
    await this.settings.flush();
    return this.snapshot();
  }
}
