import { useSyncExternalStore } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";
import { UpdateController } from "./update-controller";
import { t } from "./i18n";

const preferenceKey = "pi.updates.autoDownload";
let autoDownload = true;
try { autoDownload = localStorage.getItem(preferenceKey) !== "false"; } catch { /* Defaults work without storage. */ }
let environment = { supported: isTauri(), configured: false, initialized: false, currentVersion: "", autoDownload, setupError: "" };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export const updates = new UpdateController({
  check: async () => {
    const update = await check({ timeout: 30_000 });
    return update && {
      version: update.version,
      body: update.body,
      download: (progress) => update.download(progress, { timeout: 30 * 60 * 1000 }),
      install: () => update.install(),
      close: () => update.close(),
    };
  },
  restart: relaunch,
  autoDownload: () => environment.autoDownload,
});
export function useUpdates() {
  const state = useSyncExternalStore(updates.subscribe, updates.getSnapshot);
  const settings = useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => environment);
  return { ...state, ...settings };
}
export function setAutoDownload(value: boolean) {
  environment = { ...environment, autoDownload: value };
  try { localStorage.setItem(preferenceKey, String(value)); } catch { /* Keep in-memory preference. */ }
  notify();
  if (value) void updates.download();
}
let initialization: Promise<void> | undefined;
export function initializeUpdates() {
  return initialization ??= (async () => {
    if (!environment.supported) return;
    try {
      const [version, configured] = await Promise.all([getVersion(), invoke<boolean>("updater_configured")]);
      environment = { ...environment, currentVersion: version, configured, initialized: true };
      notify();
    } catch (error) {
      environment = { ...environment, initialized: true, setupError: String(error) };
      notify();
    }
  })();
}
export function startUpdateChecks() {
  let disposed = false;
  const run = () => { if (!disposed && environment.configured) void updates.check(); };
  void initializeUpdates().then(run);
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  window.addEventListener("online", run);
  return () => { disposed = true; clearInterval(timer); window.removeEventListener("online", run); };
}
let confirming = false;
export async function confirmUpdateInstall() {
  if (confirming) return;
  confirming = true;
  try {
    if (await ask(t("安装更新将关闭并重启应用，请先结束正在运行的任务并保存编辑。"), {
      title: t("安装更新"), kind: "warning", okLabel: t("安装并重启"), cancelLabel: t("取消"),
    })) await updates.install();
  } catch (error) {
    environment = { ...environment, setupError: String(error) };
    notify();
  } finally { confirming = false; }
}
