import { t, useLocale, localizeText } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { SettingsButton as Button } from "./SettingsButton";
import { Plus, PencilLine, Trash2 } from "lucide-react";
import { Field, SelectField } from "./ui";
import { ProviderModels } from "./ProviderModels";
import type { RecordValue } from "../shared/types";
import type { Run } from "./Workspace";
const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const protocols = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "google-vertex",
  "bedrock-converse-stream",
  "azure-openai-responses",
];
type Editor = { id: string; existing?: string; value: RecordValue };

export function CustomProviders({
  run,
  disabled,
}: {
  run: Run;
  disabled: boolean;
}) {
  useLocale();
  const [providers, setProviders] = useState<RecordValue>({});
  const [loaded, setLoaded] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [remove, setRemove] = useState<string>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const read = async () => {
    const text = await run<string>(
      "config.read",
      { name: "models.json" },
      setError,
    );
    if (text === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(t("模型配置必须是 JSON 对象"));
      return object(value);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    let active = true;
    void read().then((config) => {
      if (config && active) {
        setProviders(object(config.providers));
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (editor) {
      root.current?.querySelector(".custom-provider-form")?.scrollIntoView({ block: "start" });
      root.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    }
  }, [!!editor]);
  const edit = (id?: string) => {
    setRemove(undefined);
    setError("");
    setEditor({
      id: id ?? "",
      existing: id,
      value: id
        ? structuredClone(object(providers[id]))
        : { baseUrl: "", api: "openai-completions", models: [{ id: "" }] },
    });
  };
  const update = (key: string, value: unknown) => {
    setError("");
    setEditor(
      (current) =>
        current && { ...current, value: { ...current.value, [key]: value } },
    );
  };
  const persist = async (deleteId?: string) => {
    if (pending) return;
    setError("");
    if (!deleteId && editor) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(editor.id)) {
        setError(t("提供商 ID 仅使用字母、数字、点、下划线和连字符"));
        return;
      }
      const endpoint = String(editor.value.baseUrl ?? "").trim();
      try {
        if (
          endpoint &&
          !["http:", "https:"].includes(new URL(endpoint).protocol)
        )
          throw new Error();
      } catch {
        setError(t("请输入有效的 HTTP 或 HTTPS API 地址"));
        return;
      }
      const models = Array.isArray(editor.value.models)
        ? editor.value.models.map(object)
        : [];
      if (!editor.existing && (!endpoint || !models.length)) {
        setError(t("新端点需要 API 地址和至少一个模型"));
        return;
      }
      const ids = new Set<string>();
      for (const model of models) {
        const id = String(model.id ?? "").trim();
        if (!id || ids.has(id)) {
          setError(t("模型 ID 不能为空或重复"));
          return;
        }
        ids.add(id);
        for (const key of ["contextWindow", "maxTokens"])
          if (
            model[key] !== undefined &&
            (!Number.isSafeInteger(model[key]) || Number(model[key]) <= 0)
          ) {
            setError(t("模型 token 限制必须是正整数"));
            return;
          }
      }
    }
    setPending(true);
    try {
      const config = await read();
      if (!config) return;
      const current = object(config.providers);
      const id = deleteId ?? editor!.id;
      if (!deleteId && !editor?.existing && current[id] !== undefined) {
        setError(t("提供商 ID 已存在，请编辑已有端点"));
        return;
      }
      if (JSON.stringify(current[id]) !== JSON.stringify(providers[id])) {
        setError(t("端点配置已在其他位置修改，请重新打开模型设置后编辑"));
        return;
      }
      const next = { ...current };
      if (deleteId) delete next[id];
      else {
        const value = { ...editor!.value };
        for (const key of ["baseUrl", "api", "apiKey"])
          if (typeof value[key] === "string") {
            if (String(value[key]).trim())
              value[key] = String(value[key]).trim();
            else delete value[key];
          }
        next[id] = value;
      }
      const saved = await run(
        "config.save",
        {
          name: "models.json",
          content: JSON.stringify({ ...config, providers: next }),
        },
        setError,
      );
      if (saved !== undefined) {
        setProviders(next);
        setEditor(undefined);
        setRemove(undefined);
      }
    } finally {
      setPending(false);
    }
  };
  const models =
    editor && Array.isArray(editor.value.models)
      ? editor.value.models.map(object)
      : [];
  return (
    <div
      className="settings-group custom-providers"
      ref={root}
      aria-label={t("自定义端点")}
    >
      <div className="provider-model-heading">
        <h2>{t("自定义端点")}</h2>
        <Button
          icon={Plus}
          variant="outline"
          disabled={disabled || pending || !loaded}
          onClick={() => edit()}
        >
          {t("添加自定义端点")}
        </Button>
      </div>
      {!loaded && !error && (
        <p className="muted" role="status">
          {t("正在读取端点…")}
        </p>
      )}
      {Object.entries(providers).map(([id, value]) => (
        <div className="custom-provider-row" key={id}>
          <span>
            <strong>{id}</strong>
            <small>{String(object(value).baseUrl ?? t("使用默认地址"))}</small>
          </span>
          <Button
            icon={PencilLine}
            variant="ghost"
            disabled={disabled || pending}
            attributes={{ "aria-label": t("编辑端点 {value1}", { value1: id }) }}
            onClick={() => edit(id)}
          >
            {t("编辑")}
          </Button>
          <Button
            icon={Trash2}
            variant="ghost"
            color="critical"
            disabled={disabled || pending}
            attributes={{ "aria-label": t("移除端点 {value1}", { value1: id }) }}
            onClick={() => {
              setRemove(id);
              setEditor(undefined);
              setError("");
            }}
          >
            {t("移除")}
          </Button>
        </div>
      ))}
      {remove && (
        <div className="custom-provider-confirm">
          <p>{t("移除端点 {value1}？", { value1: remove })}</p>
          <Button
            disabled={pending}
            onClick={() => setRemove(undefined)}
          >
            {t("取消")}
          </Button>
          <Button
            color="critical"
            disabled={disabled || pending}
            onClick={() => {
              void persist(remove);
            }}
          >
            {t("确认移除")}
          </Button>
        </div>
      )}
      {editor && (
        <fieldset
          className="custom-provider-form integration-form"
          disabled={disabled || pending}
        >
          <Field
            label={t("提供商 ID")}
            name="custom-provider-id"
            readOnly={!!editor.existing}
            value={editor.id}
            onChange={(id) => {
              if (!editor.existing) {
                setEditor({ ...editor, id });
                setError("");
              }
            }}
          />
          <Field
            label={t("API 地址")}
            name="custom-provider-url"
            value={String(editor.value.baseUrl ?? "")}
            onChange={(value) => update("baseUrl", value)}
            placeholder="https://example.com/v1"
          />
          <SelectField
            label={t("API 协议")}
            name="custom-provider-api"
            value={String(editor.value.api ?? "")}
            onChange={(value) => update("api", value)}
          >
            <option value="">{t("模型或提供商默认协议")}</option>
            {[...new Set([...protocols, String(editor.value.api ?? "")])]
              .filter(Boolean)
              .map((api) => (
                <option key={api} value={api}>
                  {api}
                </option>
              ))}
          </SelectField>
          <Field
            label={t("API Key 或环境变量")}
            name="custom-provider-key"
            secret
            value={String(editor.value.apiKey ?? "")}
            onChange={(value) => update("apiKey", value)}
          />
          <ProviderModels
            models={models}
            disabled={disabled || pending}
            change={(value) => update("models", value)}
          />
          <div className="row-actions">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setEditor(undefined);
                setError("");
              }}
            >
              {t("取消编辑")}
            </Button>
            <Button
              color="primary"
              disabled={disabled || pending}
              loading={pending}
              onClick={() => {
                void persist();
              }}
            >
              {t("保存端点")}
            </Button>
          </div>
        </fieldset>
      )}
      {error && (
        <p className="error-inline" role="alert">
          {localizeText(error)}
        </p>
      )}
    </div>
  );
}
