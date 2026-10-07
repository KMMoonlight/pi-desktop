import { t, useLocale } from "./i18n";
import { Switch } from "reshaped";
import { SettingsButton as Button } from "./SettingsButton";
import { Plus, Trash2 } from "lucide-react";
import { Field, SelectField } from "./ui";
import type { RecordValue } from "../shared/types";

export function ProviderModels({
  models,
  change,
  disabled,
}: {
  models: RecordValue[];
  change: (models: RecordValue[]) => void;
  disabled: boolean;
}) {
  useLocale();
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
        <Button
          icon={Plus}
          variant="outline"
          disabled={disabled}
          onClick={() => change([...models, { id: "" }])}
        >
          {t("添加模型")}
        </Button>
      </div>
      {models.map((model, index) => (
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
            <Switch
              name={`model-reasoning-${index}`}
              checked={model.reasoning === true}
              onChange={({ checked }) => set(index, "reasoning", checked)}
            >
              {t("支持思考")}
            </Switch>
          </div>
          <Button
            icon={Trash2}
            variant="ghost"
            color="critical"
            disabled={disabled}
            attributes={{ "aria-label": t("移除模型 {value1}", { value1: index + 1 }) }}
            onClick={() =>
              change(models.filter((_, current) => current !== index))
            }
          >
            {t("移除模型")}
          </Button>
        </fieldset>
      ))}
    </div>
  );
}
