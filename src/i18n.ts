import { useSyncExternalStore } from "react";
import { english } from "./locales/en";

export type Locale = "zh-CN" | "en";
export type TranslationKey = keyof typeof english;
type Values = Record<string, string | number>;
const listeners = new Set<() => void>();
let locale: Locale = "zh-CN";
try {
  if (typeof localStorage !== "undefined" && localStorage.getItem("pi.locale") === "en") locale = "en";
} catch { /* The interface still works when preference storage is unavailable. */ }
const applyLanguage = () => {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};
applyLanguage();

export function setLocale(value: string) {
  if (value !== "zh-CN" && value !== "en") return;
  locale = value;
  try { localStorage.setItem("pi.locale", value); } catch { /* Local-only fallback. */ }
  applyLanguage();
  listeners.forEach(listener => listener());
}
export const getLocale = () => locale;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, () => "zh-CN" as const);
}
export function useI18n() {
  return { locale: useLocale(), setLocale, t };
}
export function t(key: TranslationKey, values: Values = {}): string {
  const template = locale === "en" ? english[key] : key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function formatDate(value: number | Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, options).format(value);
}
/** Re-localize stored fixed desktop errors; preserve unknown service/extension text. */
export function localizeText(text: string): string {
  if (Object.hasOwn(english, text)) return t(text as TranslationKey);
  const key = (Object.keys(english) as TranslationKey[]).find(key => english[key] === text);
  if (key) return t(key);
  for (const key of Object.keys(english) as TranslationKey[]) {
    const names = [...key.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
    if (!names.length) continue;
    for (const template of [key, english[key]]) {
      const pattern = template.split(/\{\w+\}/g).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("([\\s\\S]*?)");
      const match = text.match(new RegExp(`^${pattern}$`));
      if (match) return t(key, Object.fromEntries(names.map((name, i) => [name, localizeText(match[i + 1])])));
    }
  }
  return text;
}
