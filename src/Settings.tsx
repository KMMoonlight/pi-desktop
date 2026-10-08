import { t, useI18n, localizeText, getLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Modal, Switch } from "./primitives";
import { SettingsButton as Button } from "./SettingsButton";
import {
  Save,
  LogIn,
  KeyRound,
  ChevronDown,
  ChevronUp,
  LogOut,
  RefreshCw,
  Plus,
  Trash2,
  Package,
  Check,
  Server,
  Search,
  Settings2, Palette, Bot, Folder, SlidersHorizontal, Blocks, X,
} from "lucide-react";
import { Field, SelectField, IconButton, Empty, Hint, baseName } from "./ui";
import type { DesktopSettingsSnapshot, DesktopSnapshot, RecordValue } from "../shared/types";
import type { Run } from "./Workspace";
import { ResourcesView } from "./Resources";
import { CustomProviders } from "./CustomProviders";
import { FontSettings } from "./FontSettings";

const object = (v: unknown): RecordValue =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as RecordValue) : {};
export function SettingsView({
  snapshot,
  resourceSnapshot,
  useCommand,
  run,
  showThinking,
  onShowThinking,
  colorMode,
  onColorMode,
  messageMode,
  onMessageMode,
  open,
  onClose,
}: {
  snapshot: DesktopSettingsSnapshot;
  resourceSnapshot?: DesktopSnapshot;
  useCommand: (command: string) => void;
  run: Run;
  showThinking: boolean;
  onShowThinking: (value: boolean) => void;
  colorMode: string;
  onColorMode: (value: string) => void;
  messageMode: string;
  onMessageMode: (value: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const { locale, setLocale } = useI18n();
  const [tab, setTab] = useState("general");
  const [scope, setScope] = useState("global");
  useEffect(() => { if (!snapshot.cwd) setScope("global"); }, [snapshot.cwd]);
  const [draft, setDraft] = useState<RecordValue>(snapshot.globalSettings);
  const [search, setSearch] = useState("");
  const [addProvider, setAddProvider] = useState(false);
  const [providerEditor, setProviderEditor] = useState<string>();
  const [addMcp, setAddMcp] = useState(false);
  const [addPackage, setAddPackage] = useState(false);
  const [packages, setPackages] = useState<
    { source: string; scope: string; installedPath?: string }[]
  >([]);
  const [source, setSource] = useState("");
  const [advanced, setAdvanced] = useState("");
  const [configError, setConfigError] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const configErrorNode = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (configError) configErrorNode.current?.scrollIntoView({ block: "nearest" });
  }, [configError]);
  const [configName, setConfigName] = useState("models.json");
  const [mcp, setMcp] = useState<RecordValue>({});
  const [mcpStatus, setMcpStatus] = useState("");
  const [serverName, setServerName] = useState("");
  const [serverType, setServerType] = useState("stdio");
  const [serverAddress, setServerAddress] = useState("");
  const [serverArgs, setServerArgs] = useState("");
  const [pending, setPending] = useState(false);
  const [validation, setValidation] = useState("");
  const [settingsJson, setSettingsJson] = useState(
    JSON.stringify(draft, null, 2),
  );
  const savedSettings = JSON.stringify(
    scope === "global" ? snapshot.globalSettings : snapshot.projectSettings,
  );
  const previousSettings = useRef({ key: `${scope}:${snapshot.cwd}`, json: savedSettings });
  const formRoot = useRef<HTMLElement>(null);
  const contentRoot = useRef<HTMLDivElement>(null);
  useEffect(() => { if (contentRoot.current) contentRoot.current.scrollTop = 0; }, [tab, scope]);
  useEffect(() => {
    const key = `${scope}:${snapshot.cwd}`;
    const previous = previousSettings.current;
    const incoming = JSON.parse(savedSettings);
    const old = JSON.parse(previous.json);
    setDraft((draft) => {
      if (key !== previous.key) return incoming;
      const merged = { ...incoming };
      for (const [name, value] of Object.entries(draft))
        if (JSON.stringify(value) !== JSON.stringify(old[name])) merged[name] = value;
      return merged;
    });
    previousSettings.current = { key, json: savedSettings };
    setSettingsJson(JSON.stringify(JSON.parse(savedSettings), null, 2));
    setValidation("");
  }, [scope, snapshot.cwd, savedSettings]);
  useEffect(() => {
    const name = tab === "mcp" && addMcp ? "server-name"
      : tab === "packages" && addPackage ? "package-source" : undefined;
    if (!name) return;
    const input = formRoot.current?.querySelector<HTMLInputElement>(`[name="${name}"]`);
    input?.closest(".integration-form")?.scrollIntoView({ block: "start" });
    input?.focus({ preventScroll: true });
  }, [tab, addMcp, addPackage]);
  useEffect(() => {
    setValidation("");
    if (tab === "advanced") setSettingsJson(JSON.stringify(draft, null, 2));
  }, [tab]);
  const loadPackages = async () => {
    const data = await run<typeof packages>("packages.list");
    if (data) setPackages(data);
  };
  const changePackage = async (action: string, args?: RecordValue) => {
    setPending(true);
    try {
      const result = await run(action, args);
      if (result) await loadPackages();
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    if (tab === "packages")
      void run<typeof packages>("packages.list").then((data) => {
        if (data) setPackages(data);
      });
    if (tab === "mcp")
      void run<string>("config.read", {
        name: "mcp.json",
        local: scope === "project",
      }).then((data) => {
        if (data) {
          try {
            setMcp(object(JSON.parse(data)));
          } catch {
            setValidation(t("MCP 配置不是有效的 JSON"));
          }
        }
      });
  }, [tab, scope, snapshot.resources.length]);
  useEffect(() => {
    if (tab === "advanced")
      void run<string>("config.read", {
        name: configName,
        local: scope === "project",
      }).then((data) => {
        if (data !== undefined) {
          try { setAdvanced(JSON.stringify(JSON.parse(data), null, 2)); }
          catch { setAdvanced(data); }
        }
      });
  }, [tab, scope, configName]);
  const save = async (settings: RecordValue = draft) => {
    setPending(true);
    try {
      await run("settings.save", { scope, settings });
    } finally {
      setPending(false);
    }
  };
  const set = (key: string, value: unknown) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const nested = (key: string, name: string, value: unknown) =>
    setDraft((previous) => ({
      ...previous,
      [key]: { ...object(previous[key]), [name]: value },
    }));
  const settings = { ...snapshot.settings, ...draft };
  const dirty = JSON.stringify(draft) !== savedSettings;
  const categories = [
    ["general", t("常规"), t("会话的默认行为")],
    ["appearance", t("外观与显示"), t("调整界面和对话的显示方式")],
    ["models", t("模型与账号"), t("连接提供商并选择默认模型")],
    ["project", t("项目"), t("当前 workspace 和项目配置")],
    ["mcp", "MCP", t("管理外部工具连接")],
    ["resources", t("扩展与技能"), t("当前工作区加载的扩展、技能、提示词和上下文")],
    ["packages", t("扩展包"), t("管理已安装的 Pi 扩展")],
    ["advanced", t("高级"), t("上下文、重试和完整配置")],
  ];
  const categoryIcons = [Settings2, Palette, Bot, Folder, Server, Blocks, Package, SlidersHorizontal];
  async function saveMcp(value: RecordValue) {
    setPending(true);
    try {
      const data = await run("config.save", {
        name: "mcp.json",
        content: JSON.stringify(value),
        local: scope === "project",
      });
      if (data) setMcp(value);
      return data !== undefined;
    } finally {
      setPending(false);
    }
  }
  const refreshMcp = async () => {
    const value = await run<string>("mcp.status");
    if (value !== undefined) setMcpStatus(value);
  };
  return (
    <Modal key={open ? "open" : "closed"} active={open} onClose={onClose}
      size="960px" padding={0} className="settings-modal" ariaLabel={t("设置")}
      attributes={{ "data-desktop-native-input": "" }}>
    <section className="settings-view grid h-full min-h-0 w-full overflow-hidden" ref={formRoot} data-category={tab}>
      <nav className="settings-tabs flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-line bg-soft px-3 py-6" aria-label={t("设置分类")}>
        <h2>{t("设置")}</h2>
        {categories.map(([key, label], index) => {
          const Icon = categoryIcons[index];
          return (
          <button
            key={key}
            className={tab === key ? "selected" : ""}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
          >
            <Icon size={16} /><span>{label}</span>
          </button>
        ); })}
      </nav>
      <div className="settings-panel flex min-h-0 min-w-0 flex-col">
        <div className="settings-chrome flex h-12 shrink-0 items-center justify-end px-4">
          <div className="settings-category-picker">
            <SelectField name={t("设置分类")} value={tab} onChange={setTab}>
              {categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </SelectField>
          </div>
          <IconButton icon={X} label={t("关闭设置")} onClick={onClose} />
        </div>
        <header className="settings-heading flex shrink-0 items-center justify-between gap-4 px-6 pb-5">
          <div>
            <h2>{categories.find(([key]) => key === tab)?.[1]}</h2>
            <p>{categories.find(([key]) => key === tab)?.[2]}</p>
          </div>
          {["general", "advanced", "mcp", "packages"].includes(tab) && (
            <SelectField name={t("配置范围")} value={scope} onChange={setScope} appearance="embedded">
              <option value="global">{t("全局配置")}</option>
              <option value="project" disabled={!snapshot.cwd}>{t("项目配置")}</option>
            </SelectField>
          )}
        </header>
      <div className="settings-content min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-6" ref={contentRoot}>
        {tab === "resources" && <ResourcesView snapshot={resourceSnapshot} run={run} useCommand={useCommand} />}
        {scope === "project" && ["general", "advanced", "models"].includes(tab) && (
          <p className="settings-scope-note">{t("当前项目的覆盖项；未设置的值继承全局配置。")}</p>
        )}
        {validation && !addMcp && tab !== "advanced" && (
          <div className="error-inline" role="alert">
            {localizeText(validation)}
          </div>
        )}
        {["general", "advanced"].includes(tab) && (
          <>
            <div className="settings-group settings-defaults">
              <h2>{tab === "advanced" ? t("运行策略") : t("消息交付")}</h2>
              <div className="settings-grid flex flex-col">
                {tab === "general" && <>
                <SelectField
                  label={t("运行中发送消息")}
                  description={t("调整方向会在当前工具结束后交付；排队会在本轮任务结束后交付。此偏好在本应用中立即生效。")}
                  name="message-mode"
                  value={messageMode}
                  onChange={onMessageMode}
                >
                  <option value="steer">{t("调整方向")}</option>
                  <option value="followUp">{t("排队")}</option>
                </SelectField>
                <SelectField
                  label={t("执行中消息")}
                  description={t("任务执行期间，决定追加消息一次交付一条还是全部交付。")}
                  name="steering-mode"
                  value={String(settings.steeringMode ?? "one-at-a-time")}
                  onChange={(v) => set("steeringMode", v)}
                >
                  <option value="one-at-a-time">{t("逐条交付")}</option>
                  <option value="all">{t("全部交付")}</option>
                </SelectField>
                </>}
                {tab === "advanced" && <>
                <SelectField
                  label={t("缓存预热")}
                  name="cache-warming"
                  value={String(settings.cacheWarming ?? "streaming")}
                  onChange={(v) => set("cacheWarming", v)}
                >
                  <option value="off">{t("关闭")}</option>
                  <option value="streaming">{t("执行期间")}</option>
                  <option value="idle">{t("空闲时也保持")}</option>
                </SelectField>
                </>}
              </div>
            </div>
          </>
        )}
        {tab === "advanced" && (
            <div className="settings-group">
              <h2>{t("上下文与重试")}</h2>
              <div className="setting-row flex items-center justify-between gap-4">
                <span>{t("自动压缩上下文")}</span>
                <Switch
                  name="auto-compaction"
                  checked={object(settings.compaction).enabled !== false}
                  onChange={({ checked }) =>
                    nested("compaction", "enabled", checked)
                  }
                />
              </div>
              <div className="settings-grid flex flex-col">
                <label className="field">
                  <span>{t("回复预留 tokens")}</span>
                  <input
                    type="number"
                    min="256"
                    step="1024"
                    value={Number(
                      object(settings.compaction).reserveTokens ?? 16384,
                    )}
                    onChange={(e) =>
                      nested(
                        "compaction",
                        "reserveTokens",
                        Number(e.target.value),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("保留近期 tokens")}</span>
                  <input
                    type="number"
                    min="256"
                    step="1024"
                    value={Number(
                      object(settings.compaction).keepRecentTokens ?? 20000,
                    )}
                    onChange={(e) =>
                      nested(
                        "compaction",
                        "keepRecentTokens",
                        Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
              <div className="setting-row flex items-center justify-between gap-4">
                <span>{t("自动重试")}</span>
                <Switch
                  name="auto-retry"
                  checked={object(settings.retry).enabled !== false}
                  onChange={({ checked }) =>
                    nested("retry", "enabled", checked)
                  }
                />
              </div>
              <div className="settings-grid flex flex-col">
                <label className="field">
                  <span>{t("最多重试次数")}</span>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={Number(object(settings.retry).maxRetries ?? 3)}
                    onChange={(e) =>
                      nested("retry", "maxRetries", Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("初始等待时间（毫秒）")}</span>
                  <input
                    type="number"
                    min="100"
                    step="500"
                    value={Number(object(settings.retry).baseDelayMs ?? 2000)}
                    onChange={(e) =>
                      nested("retry", "baseDelayMs", Number(e.target.value))
                    }
                  />
                </label>
              </div>
            </div>
        )}
        {tab === "appearance" && (
          <>
            <div className="settings-group">
              <h2>{t("桌面外观")}</h2>
              <p className="setting-help">{t("更改后立即生效。对话视图也可以从会话菜单切换。")}</p>
              <SelectField label={t("界面语言")} name="interface-language" value={locale} onChange={setLocale}>
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </SelectField>
              <div className="setting-row flex items-center justify-between gap-4">
                <span>{t("展开思考过程")}</span>
                <Switch
                  name="show-thinking"
                  checked={showThinking}
                  onChange={({ checked }) => onShowThinking(checked)}
                />
              </div>
              <SelectField
                label={t("颜色模式")}
                name="color-mode"
                value={colorMode}
                onChange={onColorMode}
              >
                <option value="light">{t("浅色")}</option>
                <option value="dark">{t("深色")}</option>
                <option value="system">{t("跟随系统")}</option>
              </SelectField>
            </div>
            <FontSettings />
          </>
        )}
        {tab === "project" && (
            <div className="settings-group">
              <h2>{t("工作区")}</h2>
              {!snapshot.cwd && <p className="setting-help">{t("请先选择工作区")}</p>}
              <p className="setting-help">{t("信任状态立即生效；项目默认值只影响当前 workspace。")}</p>
              <div className="setting-row flex items-center justify-between gap-4">
                <span>{t("信任项目配置")}</span>
                <Switch
                  name="trust"
                  disabled={!snapshot.cwd}
                  checked={snapshot.trusted}
                  onChange={({ checked }) => {
                    void run("trust.set", { trusted: checked });
                  }}
                />
              </div>
              <dl className="settings-locations grid gap-4 text-[13px] leading-5">
                <div><dt>{t("当前工作区")}</dt><dd>{snapshot.cwd || t("未选择工作区")}</dd></div>
                <div><dt>{t("Pi 配置目录")}</dt><dd>{snapshot.agentDir}</dd></div>
              </dl>
              <Button variant="outline" disabled={!snapshot.cwd} onClick={() => { setScope("project"); setTab("general"); }}>{t("编辑项目默认值")}</Button>
            </div>
        )}
        {tab === "models" && (
          <>
            <div className="settings-toolbar">
              <Field
                name={t("搜索模型和账号")}
                value={search}
                onChange={setSearch}
                placeholder={t("搜索模型和账号")}
              />
              <Button
                icon={RefreshCw}
                variant="outline"
                disabled={snapshot.busy}
                onClick={() => {
                  void run("models.refresh");
                }}
              >
                {t("刷新模型")}
              </Button>
            </div>
            <div className="provider-section-header">
              <h2>{addProvider ? t("添加提供商") : t("已连接账号")}</h2>
              <Button icon={addProvider ? undefined : Plus} attributes={{ "aria-expanded": addProvider }} onClick={() => { setAddProvider(!addProvider); setProviderEditor(undefined); }}>
                {addProvider ? t("返回已连接账号") : t("添加提供商")}
              </Button>
            </div>
            {!addProvider &&
              !search &&
              !snapshot.providers.some((provider) => provider.configured) && (
                <p className="muted">
                  {t("还没有连接账号，添加提供商后即可选择模型。")}
                </p>
              )}
            <div className="provider-list flex flex-col">
              {snapshot.providers
                .filter(
                  (p) =>
                    (addProvider || !!search || p.configured) &&
                    `${p.name} ${p.id}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                )
                .sort(
                  (a, b) =>
                    Number(b.configured) - Number(a.configured) ||
                    a.name.localeCompare(b.name),
                )
                .map((provider) => (
                  <div className="provider-row" key={provider.id}>
                    <div className="provider-identity">
                      <strong><span className={`provider-dot ${provider.configured ? "connected" : ""}`} />{provider.name}</strong>
                      <span className="muted">
                        {provider.configured ? t("凭据已配置") : t("未配置")}
                      </span>
                    </div>
                    <div className="row-actions">
                      <Button
                        endIcon={providerEditor === provider.id ? ChevronUp : ChevronDown}
                        attributes={{ "aria-expanded": providerEditor === provider.id }}
                        onClick={() => setProviderEditor(providerEditor === provider.id ? undefined : provider.id)}>
                        {provider.configured ? t("管理") : t("连接")}
                      </Button>
                      {provider.configured && (
                        <IconButton
                          icon={LogOut}
                          label={t("退出 {value1}", { value1: provider.name })}
                          onClick={() => {
                            void run("auth.logout", { provider: provider.id });
                          }}
                        />
                      )}
                    </div>
                    {providerEditor === provider.id && <div className="provider-methods" role="group" aria-label={t("{value1} 连接方式", { value1: provider.name })}>
                      <p>{t("选择连接方式")}</p>
                      {provider.methods.map((method) => (
                        <Button
                          key={method}
                          icon={method === "oauth" ? LogIn : KeyRound}
                          variant="outline"
                          onClick={() => {
                            void run("auth.login", {
                              provider: provider.id,
                              method: method === "apiKey" ? "api_key" : method,
                            });
                          }}
                        >
                          {method === "oauth" ? t("登录") : "API Key"}
                        </Button>
                      ))}
                    </div>}
                  </div>
                ))}
            </div>
            <CustomProviders run={run} disabled={snapshot.busy || snapshot.changing} />
            <div className="settings-group settings-defaults">
              <div className="settings-section-heading">
              <h2>{t("默认模型")}</h2>
              <SelectField name={t("默认模型配置范围")} value={scope} onChange={setScope} appearance="embedded">
                <option value="global">{t("全局默认值")}</option>
                <option value="project" disabled={!snapshot.cwd}>{t("当前项目默认值")}</option>
              </SelectField>
              </div>
              <div className="settings-grid flex flex-col">
                <SelectField
                  label={t("默认模型")} name={t("默认模型")}
                  description={t("用于新会话；当前会话的模型在输入区选择。")}
                  value={`${settings.defaultProvider ?? ""}/${settings.defaultModel ?? ""}`}
                  onChange={(value) => {
                    const model = snapshot.models.find(m => `${m.provider}/${m.id}` === value);
                    if (model) setDraft(p => ({ ...p, defaultProvider: model.provider, defaultModel: model.id }));
                  }}>
                  <option value="/">{t("自动选择")}</option>
                  {snapshot.models.filter(m => m.available).map(m => (
                    <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.name} · {m.provider}</option>
                  ))}
                </SelectField>
                <SelectField label={t("默认思考等级")} name={t("默认思考等级")}
                  value={String(settings.defaultThinkingLevel ?? "medium")}
                  onChange={v => set("defaultThinkingLevel", v)}>
                  {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </SelectField>
              </div>
            </div>
            <div className="settings-group">
            <h2>{t("模型轮换范围")}</h2>
            <p className="setting-help">{t("选择快捷切换时轮换的模型，更改后立即生效。")}</p>
            <div className="model-list">
              {snapshot.models
                .filter(
                  (m) =>
                    m.available &&
                    `${m.name} ${m.provider}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                )
                .map((model) => {
                  const id = `${model.provider}/${model.id}`;
                  return (
                    <label className="model-row" key={id}>
                      <input
                        type="checkbox"
                        checked={snapshot.scopedModels.includes(id)}
                        onChange={(e) => {
                          void run("models.scope", {
                            models: e.target.checked
                              ? [...snapshot.scopedModels, id]
                              : snapshot.scopedModels.filter((m) => m !== id),
                          });
                        }}
                      />
                      <span>
                        <strong>{model.name}</strong>
                        <small>
                          {model.provider} ·{" "}
                          {model.contextWindow.toLocaleString(getLocale())} tokens
                        </small>
                      </span>
                      {snapshot.model?.id === model.id &&
                        snapshot.model.provider === model.provider && (
                          <Check size={15} />
                        )}
                    </label>
                  );
                })}
            </div>
            </div>
          </>
        )}
        {tab === "mcp" && (
          <>
            <div className="settings-toolbar">
              <h2>{t("MCP 服务器")}</h2>
              <Button icon={Plus} variant="outline" attributes={{"aria-expanded": addMcp, "data-settings-add": "mcp"}} onClick={() => setAddMcp(!addMcp)}>{t("添加服务器")}</Button>
              <Button
                icon={RefreshCw}
                variant="outline"
                disabled={!snapshot.cwd || snapshot.busy || pending}
                onClick={() => {
                  void refreshMcp();
                }}
              >
                {t("检查连接")}
              </Button>
            </div>
            {!addMcp && !Object.keys(object(mcp.mcpServers)).length && <Empty icon={Server} title={t("尚未配置 MCP 服务器")} />}
            {mcpStatus && <pre className="mcp-status">{mcpStatus}</pre>}
            <div className="server-list">
              {Object.entries(object(mcp.mcpServers)).map(([name, config]) => {
                const c = object(config);
                return (
                  <div className="server-row" key={name}>
                    <Server size={18} />
                    <div className="server-identity">
                      <strong>{name}</strong>
                      <small className="server-address">{String(c.url ?? c.command ?? "")}</small>
                      <Hint text={String(c.url ?? c.command ?? "")}>
                        <span tabIndex={0}>{c.url ? "HTTP" : t("本地进程")}</span>
                      </Hint>
                    </div>
                    <div className="server-actions">
                    <Switch
                      name={`mcp-${name}`}
                      checked={c.enabled !== false}
                      disabled={pending || snapshot.busy}
                      onChange={({ checked }) => {
                        void saveMcp({
                          ...mcp,
                          mcpServers: {
                            ...object(mcp.mcpServers),
                            [name]: { ...c, enabled: checked },
                          },
                        });
                      }}
                    />
                    <IconButton
                      icon={Trash2}
                      color="critical"
                      label={t("移除 {value1}", { value1: name })}
                      disabled={pending || snapshot.busy}
                      onClick={() => {
                        const servers = { ...object(mcp.mcpServers) };
                        delete servers[name];
                        void saveMcp({ ...mcp, mcpServers: servers });
                      }}
                    />
                    <IconButton
                      icon={RefreshCw}
                      label={t("重新连接 {value1}", { value1: name })}
                      disabled={!snapshot.cwd || snapshot.busy || pending}
                      onClick={() => {
                        void run("mcp.command", {
                          operation: "reconnect",
                          name,
                        });
                      }}
                    />
                    {c.url !== undefined && (
                      <>
                        <IconButton
                          icon={LogIn}
                          label={t("登录 {value1}", { value1: name })}
                          disabled={!snapshot.cwd || snapshot.busy || pending}
                          onClick={() => {
                            void run("mcp.command", {
                              operation: "login",
                              name,
                            });
                          }}
                        />
                        <IconButton
                          icon={LogOut}
                          label={t("退出 {value1}", { value1: name })}
                          disabled={!snapshot.cwd || snapshot.busy || pending}
                          onClick={() => {
                            void run("mcp.command", {
                              operation: "logout",
                              name,
                            });
                          }}
                        />
                      </>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>
            {addMcp && <div className="settings-group integration-form" role="group" aria-label={t("添加服务器")}>
              <div className="integration-form-heading">
              <h2>{t("添加服务器")}</h2>
              <Button variant="ghost" onClick={() => { setAddMcp(false); setValidation(""); formRoot.current?.querySelector<HTMLButtonElement>('[data-settings-add="mcp"]')?.focus(); }}>{t("取消添加")}</Button>
              </div>
              {validation && <div className="error-inline" role="alert">{localizeText(validation)}</div>}
              <div className="settings-grid flex flex-col">
                <Field
                  label={t("名称")}
                  name="server-name"
                  value={serverName}
                  onChange={setServerName}
                />
                <SelectField
                  label={t("传输方式")}
                  name="server-type"
                  value={serverType}
                  onChange={setServerType}
                >
                  <option value="stdio">{t("本地进程")}</option>
                  <option value="http">HTTP</option>
                </SelectField>
              </div>
              <Field
                label={serverType === "stdio" ? t("执行程序") : t("服务器 URL")}
                name="server-address"
                value={serverAddress}
                onChange={setServerAddress}
                placeholder={serverType === "stdio" ? "npx" : "https://example.com/mcp"}
              />
              {serverType === "stdio" && (
                <Field
                  label={t("参数（JSON 数组）")}
                  name="server-args"
                  value={serverArgs}
                  onChange={setServerArgs}
                  placeholder='["-y", "@modelcontextprotocol/server-filesystem", "C:/Code"]'
                />
              )}
              {serverType === "stdio" && <p className="setting-help">{t("程序与参数分开填写；每个参数是数组中的一个字符串。")}</p>}
              <div className="integration-form-actions">
              <Button
                icon={Plus}
                color="primary"
                disabled={
                  !serverName.trim() ||
                  !serverAddress.trim() ||
                  pending ||
                  snapshot.busy
                }
                onClick={() => {
                  let args: unknown = [];
                  try {
                    args = serverArgs ? JSON.parse(serverArgs) : [];
                  } catch {
                    setValidation(t("参数必须是 JSON 字符串数组"));
                    return;
                  }
                  if (
                    !Array.isArray(args) ||
                    !args.every((v) => typeof v === "string")
                  ) {
                    setValidation(t("参数必须是 JSON 字符串数组"));
                    return;
                  }
                  if (!/^[a-zA-Z0-9_-]+$/.test(serverName)) {
                    setValidation(
                      t("服务器名称只能包含字母、数字、下划线和连字符"),
                    );
                    return;
                  }
                  if (object(mcp.mcpServers)[serverName]) {
                    setValidation(t("已有同名服务器"));
                    return;
                  }
                  setValidation("");
                  void saveMcp({
                    ...mcp,
                    mcpServers: {
                      ...object(mcp.mcpServers),
                      [serverName]:
                        serverType === "stdio"
                          ? { command: serverAddress, args }
                          : { url: serverAddress },
                    },
                  }).then((saved) => {
                    if (!saved) return;
                    setServerName("");
                    setServerAddress("");
                    setServerArgs("");
                    setAddMcp(false);
                  });
                }}
              >
                {t("保存服务器")}
              </Button>
              </div>
            </div>}
          </>
        )}
        {tab === "packages" && (
          <>
            <div className="settings-toolbar">
              <Button icon={Plus} variant="outline" attributes={{"aria-expanded": addPackage, "data-settings-add": "package"}} onClick={() => setAddPackage(!addPackage)}>{t("添加扩展包")}</Button>
              <Button
                icon={RefreshCw}
                variant="outline"
                disabled={snapshot.busy || pending || packages.length === 0}
                onClick={() => {
                  void changePackage("packages.update");
                }}
              >
                {t("更新全部")}
              </Button>
            </div>
            {packages.map((pkg) => (
              <div className="package-row" key={`${pkg.scope}-${pkg.source}`}>
                <Package size={18} />
                <div>
                  <strong>{pkg.source.startsWith("npm:") ? pkg.source.slice(4).replace(/@[^/@]+$/, "") : baseName(pkg.source)}</strong>
                  <p className="package-source">{pkg.source}</p>
                <Hint text={pkg.installedPath ?? pkg.scope}>
                    <span tabIndex={0}>
                      {pkg.scope === "project" ? t("项目") : t("全局")}
                    </span>
                  </Hint>
                </div>
                <div className="package-actions">
                <IconButton
                  icon={RefreshCw}
                  label={t("更新扩展包")}
                  disabled={snapshot.busy || pending}
                  onClick={() => {
                    void changePackage("packages.update", {
                      source: pkg.source,
                    });
                  }}
                />
                <IconButton
                  icon={Trash2}
                  color="critical"
                  label={t("移除扩展包")}
                  disabled={snapshot.busy || pending}
                  onClick={() => {
                    void changePackage("packages.remove", {
                      source: pkg.source,
                      local: pkg.scope === "project",
                    });
                  }}
                />
                </div>
              </div>
            ))}
            {!addPackage && packages.length === 0 && (
              <Empty icon={Package} title={t("尚未安装扩展包")} />
            )}
            {addPackage && <div className="integration-form rounded-xl bg-soft p-4" role="group" aria-label={t("添加扩展包")}>
              <div className="integration-form-heading">
                <h2>{t("添加扩展包")}</h2>
                <Button variant="ghost" onClick={() => { setAddPackage(false); setSource(""); formRoot.current?.querySelector<HTMLButtonElement>('[data-settings-add="package"]')?.focus(); }}>{t("取消添加")}</Button>
              </div>
              <Field
                label={t("包地址")}
                name="package-source"
                value={source}
                onChange={setSource}
                placeholder={t("npm:@scope/package 或 git:github.com/user/repo")}
              />
              <div className="integration-form-actions">
              <Button
                icon={Plus}
                color="primary"
                loading={pending}
                disabled={!source.trim() || snapshot.busy}
                onClick={() => {
                  setPending(true);
                  void run("packages.install", {
                    source,
                    local: scope === "project",
                  })
                    .then((result) => {
                      if (result === undefined) return;
                      setSource("");
                      setAddPackage(false);
                      return run<typeof packages>("packages.list");
                    })
                    .then((data) => {
                      if (data) setPackages(data);
                    })
                    .finally(() => setPending(false));
                }}
              >
                {t("安装")}
              </Button>
              </div>
            </div>}
          </>
        )}
        {tab === "advanced" && (
          <section className="settings-config-editor" aria-label={t("配置文件编辑器")}>
            <h2>{t("配置文件编辑器")}</h2>
            <p className="setting-help">{t("配置文件单独保存；下方“保存设置”仅保存运行策略。")}</p>
            <div className="settings-toolbar">
              <SelectField
                name={t("配置文件")}
                value={configName}
                onChange={(name) => { setConfigName(name); setConfigError(""); }}
              >
                <option value="models.json">{t("模型端点 · models.json")}</option>
                <option value="mcp.json">{t("MCP 配置 · mcp.json")}</option>
              </SelectField>
              <Button
                icon={Save}
                color="primary"
                disabled={snapshot.busy || configSaving}
                loading={configSaving}
                onClick={async () => {
                  setConfigError("");
                  setConfigSaving(true);
                  try {
                    await run("config.save", {
                      name: configName,
                      content: advanced,
                      local: scope === "project",
                    }, setConfigError);
                  } finally {
                    setConfigSaving(false);
                  }
                }}
              >
                {t("保存配置")}
              </Button>
            </div>
            <textarea
              className="json-editor"
              aria-label={t("配置 JSON")}
              value={advanced}
              spellCheck={false}
              wrap="off"
              onChange={(e) => { setAdvanced(e.target.value); setConfigError(""); }}
            />
            {configError && <p ref={configErrorNode} className="error-inline config-file-error" role="alert">{localizeText(configError)}</p>}
            <details className="raw-settings">
              <summary>{t("完整设置")}</summary>
              <textarea
                className="json-editor"
                aria-label={t("完整设置 JSON")}
                value={settingsJson}
                spellCheck={false}
                wrap="off"
                onChange={(e) => { setSettingsJson(e.target.value); setValidation(""); }}
              />
              {validation && <p className="error-inline" role="alert">{localizeText(validation)}</p>}
              <Button
                icon={Save}
                color="primary"
                onClick={() => {
                  try {
                    const value = JSON.parse(settingsJson);
                    if (
                      !value ||
                      typeof value !== "object" ||
                      Array.isArray(value)
                    )
                      throw new Error();
                    setValidation("");
                    void save(value);
                  } catch {
                    setValidation(t("设置必须是有效的 JSON 对象"));
                  }
                }}
              >
                {t("保存完整设置")}
              </Button>
            </details>
            <div className="runtime-info">
              <Hint text={snapshot.agentDir}>
                <span>Pi {snapshot.version}</span>
              </Hint>
            </div>
          </section>
        )}
      </div>
      {["general", "models", "advanced"].includes(tab) && <footer className="settings-save shrink-0 items-center justify-between gap-3 border-t border-line bg-canvas px-6 py-4">
        <span role="status">{pending ? t("正在保存…") : dirty ? t("有未保存的更改") : tab === "advanced" ? t("运行策略已保存") : t("设置已保存")}</span>
        <Button icon={Save} color="primary" loading={pending} disabled={snapshot.busy || !dirty} onClick={() => { void save(); }}>{t("保存设置")}</Button>
      </footer>}
      </div>
    </section>
    </Modal>
  );
}
