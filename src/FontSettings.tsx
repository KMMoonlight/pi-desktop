import { useEffect, useId, useState } from "react";
import { t, type TranslationKey } from "./i18n";
import { Field } from "./ui";
import { SelectControl } from "./SelectControl";
import { setFontPreference, useFontPreferences } from "./fonts";
import { action } from "./client";

function FontField({
  kind,
  label,
  customLabel,
  choices,
  value,
  loading,
}: {
  kind: "interface" | "code";
  label: TranslationKey;
  customLabel: TranslationKey;
  choices: string[];
  value: string;
  loading: boolean;
}) {
  const labelId = useId();
  const [custom, setCustom] = useState(false);
  const useCustom = custom || (!loading && !!value && !choices.includes(value));
  const available = [...choices];
  // Keep the saved family available while the installed list is loading.
  if (value && !useCustom && !available.includes(value))
    available.unshift(value);
  return (
    <>
      <div className="field field-outlined">
        <span id={labelId}>{t(label)}</span>
        <SelectControl
          name={t(label)}
          labelledBy={labelId}
          searchable
          searchPlaceholder={t("输入字体名称")}
          emptyText={t("没有匹配的字体")}
          value={useCustom ? "custom" : value}
          onChange={(next) => {
            setCustom(next === "custom");
            if (next !== "custom") setFontPreference(kind, next);
          }}
        >
          <option value="">{t("应用默认字体")}</option>
          {available.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
          <option value="custom">{t("自定义字体")}</option>
        </SelectControl>
      </div>
      {useCustom && (
        <Field
          label={t(customLabel)}
          name={`${kind}-font-custom`}
          value={value}
          placeholder={
            kind === "interface" ? "Source Han Sans SC" : "Fira Code"
          }
          onChange={(next) => setFontPreference(kind, next)}
        />
      )}
    </>
  );
}

export function FontSettings() {
  const fonts = useFontPreferences();
  const [installed, setInstalled] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void action<string[]>("fonts.list")
      .then(
        (families) => {
          if (active) setInstalled(families);
        },
        // Defaults and manual font entry remain usable if enumeration fails.
        () => {},
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="settings-group">
      <h2>{t("字体")}</h2>
      <FontField
        kind="interface"
        label="界面字体"
        customLabel="自定义界面字体名称"
        choices={installed}
        value={fonts.interface}
        loading={loading}
      />
      <FontField
        kind="code"
        label="代码与终端字体"
        customLabel="自定义代码字体名称"
        choices={installed}
        value={fonts.code}
        loading={loading}
      />
      <div
        className="font-preview mt-3 min-w-0 rounded-lg bg-soft p-4"
        role="group"
        aria-label={t("字体预览")}
      >
        <p className="mt-2 break-words text-sm">
          {t("你好，世界。让每一次对话都清晰易读。")}
        </p>
        <code className="mt-2 block break-words text-sm">
          const greeting = "Hello, 世界!"; 0123456789
        </code>
      </div>
    </div>
  );
}
