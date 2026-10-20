import { t, useLocale } from "./i18n";
import { useState } from "react";
import { Switch } from "./primitives";
import { SettingsButton as Button } from "./SettingsButton";
import { Download, Plus, Trash2 } from "lucide-react";
import { Field, SelectField } from "./ui";
import type { RecordValue } from "../shared/types";
import { modelThinkingLevels } from "../shared/types";
import {
  providerThinkingLevels,
  setProviderThinkingLevel,
} from "../shared/provider-models";

const compatibilityLabels = [
  ["supportsReasoningEffort", "推理强度参数"],
  ["supportsStrictMode", "严格参数模式"],
  ["supportsStrictTools", "严格工具模式"],
  ["supportsOpenAIGrammarTools", "语法工具"],
  ["supportsToolSearch", "工具搜索"],
  ["supportsAdditionalTools", "动态工具"],
] as const;

export function ProviderModels({
  models,
  change,
  disabled,
  discover,
  discovering = false,
}: {
  models: RecordValue[];
  change: (models: RecordValue[]) => void;
  disabled: boolean;
  discover?: () => void;
  discovering?: boolean;
}) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const set = (index: number, key: string, value: unknown) =>
    change(
      models.map((model, current) => {
        if (current !== index) return model;
        const next = { ...model, [key]: value };
        if (key !== "id" && value === "") delete next[key];
        return next;
      }),
    );
  const number = (index: number, key: string, value: string) => {
    if (value === "") {
      const model = { ...models[index] };
      delete model[key];
      change(models.map((item, current) => (current === index ? model : item)));
    } else set(index, key, Number(value));
  };
  return (
    <div className="provider-model-editor">
      <div className="provider-model-heading">
        <h3>{t("模型")}</h3>
        <div className="row-actions">
          {discover && (
            <Button
              icon={Download}
              variant="outline"
              disabled={disabled}
              loading={discovering}
              onClick={discover}
            >
              {t(discovering ? "正在获取模型…" : "从 API 获取模型")}
            </Button>
          )}
          <Button
            icon={Plus}
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setExpanded(true);
              change([...models, { id: "" }]);
            }}
          >
            {t("添加模型")}
          </Button>
        </div>
      </div>
      {discover && (
        <p className="muted">
          {t(
            "从 /models 导入模型名称、token 限制及接口声明的能力，保留已有配置；思考和视觉能力可手动补充，工具能力按接口声明展示。",
          )}
        </p>
      )}
      {models.length > 3 && (
        <Button
          variant="ghost"
          disabled={disabled}
          attributes={{ "aria-expanded": expanded }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? t("收起模型配置")
            : t("展开 {value1} 个模型的配置", { value1: models.length })}
        </Button>
      )}
      {(models.length <= 3 || expanded) &&
        models.map((model, index) => {
          const supported = providerThinkingLevels(model);
          const compat =
            model.compat && typeof model.compat === "object"
              ? (model.compat as RecordValue)
              : {};
          const compatTags = compatibilityLabels
            .filter(([key]) => compat[key] === true)
            .map(([, label]) => t(label));
          const onlyOneLevel = supported.length === 1;
          const showLevelHint = supported.length <= 1;
          return (
            <fieldset
              key={index}
              disabled={disabled}
              className="provider-model-fields"
            >
              <legend>{t("模型 {value1}", { value1: index + 1 })}</legend>
              <div className="provider-model-grid">
                <Field
                  label={t("模型 ID")}
                  name={`model-id-${index}`}
                  value={String(model.id ?? "")}
                  onChange={(value) => set(index, "id", value)}
                />
                <Field
                  label={t("显示名称")}
                  name={`model-name-${index}`}
                  value={String(model.name ?? "")}
                  onChange={(value) => set(index, "name", value)}
                />
                <Field
                  label={t("上下文长度")}
                  name={`model-context-${index}`}
                  type="number"
                  value={String(model.contextWindow ?? "")}
                  onChange={(value) => number(index, "contextWindow", value)}
                />
                <Field
                  label={t("最大输出 tokens")}
                  name={`model-output-${index}`}
                  type="number"
                  value={String(model.maxTokens ?? "")}
                  onChange={(value) => number(index, "maxTokens", value)}
                />
                <SelectField
                  label={t("输入能力")}
                  name={`model-input-${index}`}
                  value={
                    Array.isArray(model.input) && model.input.includes("image")
                      ? "image"
                      : "text"
                  }
                  onChange={(value) =>
                    set(
                      index,
                      "input",
                      value === "image" ? ["text", "image"] : ["text"],
                    )
                  }
                >
                  <option value="text">{t("文本")}</option>
                  <option value="image">{t("文本与图片")}</option>
                </SelectField>
                <div className="provider-model-tools">
                  <span>{t("工具调用（接口声明）")}</span>
                  <span
                    className="provider-model-tool-status"
                    aria-label={t("工具调用（接口声明）")}
                  >
                    {t(
                      model.supportsTools === true
                        ? "支持"
                        : model.supportsTools === false
                          ? "不支持"
                          : "未声明",
                    )}
                  </span>
                  {compatTags.length > 0 && (
                    <small>{compatTags.join(" · ")}</small>
                  )}
                </div>
                <Switch
                  name={`model-reasoning-${index}`}
                  checked={model.reasoning === true}
                  onChange={({ checked }) => set(index, "reasoning", checked)}
                >
                  {t("支持思考")}
                </Switch>
              </div>
              {model.reasoning === true && (
                <fieldset
                  className="provider-thinking-levels"
                  aria-describedby={
                    showLevelHint ? `model-thinking-note-${index}` : undefined
                  }
                >
                  <legend>{t("支持的思考档位")}</legend>
                  {modelThinkingLevels.map((level) => (
                    <label key={level}>
                      <input
                        type="checkbox"
                        checked={supported.includes(level)}
                        disabled={onlyOneLevel && supported.includes(level)}
                        onChange={(event) =>
                          change(
                            models.map((current, currentIndex) =>
                              currentIndex === index
                                ? setProviderThinkingLevel(
                                    current,
                                    level,
                                    event.target.checked,
                                  )
                                : current,
                            ),
                          )
                        }
                      />
                      <span>{level === "off" ? t("关闭") : level}</span>
                    </label>
                  ))}
                  {showLevelHint && (
                    <p
                      id={`model-thinking-note-${index}`}
                      className="provider-thinking-note"
                    >
                      {t(
                        "至少保留一个思考档位；如需停用思考，请关闭“支持思考”。",
                      )}
                    </p>
                  )}
                </fieldset>
              )}
              <Button
                icon={Trash2}
                variant="ghost"
                color="critical"
                disabled={disabled}
                attributes={{
                  "aria-label": t("移除模型 {value1}", { value1: index + 1 }),
                }}
                onClick={() =>
                  change(models.filter((_, current) => current !== index))
                }
              >
                {t("移除模型")}
              </Button>
            </fieldset>
          );
        })}
    </div>
  );
}
