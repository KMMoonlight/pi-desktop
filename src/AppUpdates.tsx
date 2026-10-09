import { Download, RefreshCw } from "lucide-react";
import { t, useLocale, formatDate } from "./i18n";
import { Switch, Button } from "./primitives";
import { useUpdates, updates, setAutoDownload, confirmUpdateInstall } from "./updates";

export function AppUpdates() {
  useLocale();
  const state = useUpdates();
  const busy = ["checking", "downloading", "installing"].includes(state.phase);
  const ready = ["ready", "installed"].includes(state.phase);
  const progress = state.total ? Math.min(100, Math.round(state.downloaded / state.total * 100)) : undefined;
  return <div className="settings-group">
    <h2>Pi Desktop {state.currentVersion && <span className="text-muted">v{state.currentVersion}</span>}</h2>
    {!state.supported ? <p>{t("请在桌面应用中检查更新。")}</p>
      : !state.initialized ? <p>{t("正在读取更新配置…")}</p>
      : !state.configured ? <p>{t("此构建尚未启用在线更新，请安装支持更新的正式版本。")}</p>
      : <>
        <div className="setting-row flex items-center justify-between gap-4">
          <div><strong>{t("自动下载更新")}</strong><p className="text-muted">{t("启动时及每 6 小时检查更新，下载完成后由你决定何时安装。")}</p></div>
          <Switch name="auto-download-updates" checked={state.autoDownload} onChange={({ checked }) => setAutoDownload(checked)}><span className="sr-only">{t("自动下载更新")}</span></Switch>
        </div>
        <div className="my-4 space-y-2" role="status" aria-live="polite">
          {state.phase === "idle" && <p>{t("尚未检查更新")}</p>}
          {state.phase === "checking" && <p>{t("正在检查更新…")}</p>}
          {state.phase === "latest" && <p>{t("当前已是最新版本")}</p>}
          {state.phase === "available" && <p>{t("发现新版本 {version}", { version: state.version ?? "" })}</p>}
          {state.phase === "downloading" && <>
            <p>{t("正在下载更新…")} {progress === undefined ? `${(state.downloaded / 1048576).toFixed(1)} MB` : `${progress}%`}</p>
            <progress className="w-full accent-coral" aria-label={t("下载进度")} max={100} value={progress} />
          </>}
          {ready && <p>{t("版本 {version} 已准备就绪", { version: state.version ?? "" })}</p>}
          {state.phase === "installing" && <p>{t("正在安装更新…")}</p>}
        </div>
        {state.checkedAt && <p className="mb-3 text-muted">{t("上次检查：{time}", { time: formatDate(state.checkedAt, { dateStyle: "short", timeStyle: "short" }) })}</p>}
        <div className="flex flex-wrap gap-2">
          {!ready && <Button icon={RefreshCw} variant="outline" disabled={busy} onClick={() => void updates.check()}>{t("检查更新")}</Button>}
          {state.phase === "available" && <Button icon={Download} onClick={() => void updates.download()}>{t("下载更新")}</Button>}
          {ready && <Button color="primary" onClick={() => void confirmUpdateInstall()}>{t("安装并重启")}</Button>}
        </div>
        {state.notes && <details className="mt-4"><summary>{t("更新说明")}</summary><p className="mt-2 whitespace-pre-wrap break-words text-body">{state.notes}</p></details>}
      </>}
    {(state.error || state.setupError) && <div className="error-inline mt-3" role="alert">{t("更新失败，请重试。你的当前版本仍可继续使用。")}<details><summary>{t("错误详情")}</summary><p className="break-words">{state.error || state.setupError}</p></details></div>}
  </div>;
}

export function UpdateNotice({ onOpen }: { onOpen: () => void }) {
  useLocale();
  const state = useUpdates();
  if (!["ready", "installed"].includes(state.phase)) return null;
  return <aside className="fixed right-4 bottom-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-line bg-canvas p-3 text-sm text-ink shadow-lg" aria-live="polite">
    <Download size={18} aria-hidden />
    <span>{t("版本 {version} 已准备就绪", { version: state.version ?? "" })}</span>
    <Button size="small" onClick={onOpen}>{t("查看更新")}</Button>
  </aside>;
}
