import { useSyncExternalStore } from "react";

type FontPreferences = { interface: string; code: string };
const storageKey = "pi.fontPreferences";
const listeners = new Set<() => void>();
const clean = (value: unknown) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) : "";

function readPreferences(): FontPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return { interface: clean(saved?.interface), code: clean(saved?.code) };
  } catch {
    return { interface: "", code: "" };
  }
}

let preferences = readPreferences();
function apply() {
  if (typeof document === "undefined") return;
  for (const [key, property] of [
    ["interface", "--app-font-sans"], ["code", "--app-font-mono"],
  ] as const) {
    const family = preferences[key].trim();
    // Treat the input as one literal family name, retaining the CSS fallback stack.
    if (family) document.documentElement.style.setProperty(property, JSON.stringify(family));
    else document.documentElement.style.removeProperty(property);
  }
}
// Restore before React mounts so the first frame and xterm use the saved fonts.
apply();

export function setFontPreference(key: keyof FontPreferences, value: string) {
  preferences = { ...preferences, [key]: clean(value) };
  apply();
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)); }
  catch { /* Continue applying fonts if preference storage is unavailable. */ }
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function useFontPreferences() {
  return useSyncExternalStore(subscribe, () => preferences, () => preferences);
}
