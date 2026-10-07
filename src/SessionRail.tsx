import { t, useLocale, getLocale } from "./i18n";
import { Folder, Pin, Plus, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { SessionItem } from "../shared/types";
import { Hint, IconButton, baseName } from "./ui";

const projectKey = (cwd: string) =>
  cwd.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
const parentName = (cwd: string) => cwd.replaceAll("\\", "/").split("/").filter(Boolean).at(-2) ?? cwd;
function relativeTime(modified: SessionItem["modified"]) {
  const age = Math.max(0, Date.now() - new Date(modified).getTime());
  if (age < 60_000) return t("刚刚");
  if (age < 3_600_000) return t("{value1} 分钟", { value1: Math.floor(age / 60_000) });
  if (age < 86_400_000) return t("{value1} 小时", { value1: Math.floor(age / 3_600_000) });
  if (age < 604_800_000) return t("{value1} 天", { value1: Math.floor(age / 86_400_000) });
  return new Date(modified).toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
}

export function SessionRail({
  sessions,
  workspaces,
  pins,
  currentId,
  cwd,
  currentName,
  search,
  busy,
  select,
  pin,
  newSession,
}: {
  sessions: SessionItem[];
  workspaces: string[];
  pins: string[];
  currentId?: string;
  cwd?: string;
  currentName?: string;
  search: string;
  busy: boolean;
  select: (session?: SessionItem) => void;
  pin: (id: string) => void;
  newSession: (cwd: string) => void;
}) {
  useLocale();
  const [disclosures, setDisclosures] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("pi.workspaceDisclosures") ?? "{}"); }
    catch { return {}; }
  });
  const groups = new Map<string, { cwd: string; sessions: SessionItem[] }>();
  for (const workspace of workspaces)
    groups.set(projectKey(workspace), { cwd: workspace, sessions: [] });
  if (cwd) groups.set(projectKey(cwd), { cwd, sessions: [] });
  for (const session of sessions) {
    const key = projectKey(session.cwd);
    if (!groups.has(key)) groups.set(key, { cwd: session.cwd, sessions: [] });
    groups.get(key)!.sessions.push(session);
  }
  const names = [...groups.values()].map(group => baseName(group.cwd).toLowerCase());
  const fresh =
    !!currentId &&
    !sessions.some((session) => session.id === currentId) &&
    !search;
  const row = (session: SessionItem) => (
    <div
      className={`session-row ${session.id === currentId ? "active" : ""} ${pins.includes(session.id) ? "is-pinned" : ""}`}
      key={session.path}
    >
      <Hint
        text={`${session.cwd} · ${new Date(session.modified).toLocaleString(getLocale())}`}
      >
        <button disabled={busy} aria-current={session.id === currentId ? "page" : undefined} onClick={() => select(session)}>
          <span>
            <strong>
              {session.name || session.firstMessage || t("未命名会话")}
            </strong>
            <small className="session-time">{relativeTime(session.modified)}</small>
          </span>
        </button>
      </Hint>
      <IconButton
        icon={Pin}
        label={pins.includes(session.id) ? t("取消固定") : t("固定会话")}
        active={pins.includes(session.id)}
        onClick={() => pin(session.id)}
      />
    </div>
  );
  return (
    <div className="session-list">
      {[...groups.values()]
        .filter(
          (group) =>
            !search || group.sessions.length,
        )
        .map((group) => (
          <details
            className="session-project"
            key={projectKey(group.cwd)}
            open={!!search || (disclosures[projectKey(group.cwd)] ?? projectKey(group.cwd) === projectKey(cwd ?? ""))}
            onToggle={(event) => {
              if (search) return;
              const open = event.currentTarget.open;
              const key = projectKey(group.cwd);
              const expected = disclosures[key] ?? key === projectKey(cwd ?? "");
              if (open === expected) return;
              setDisclosures((previous) => {
                const next = { ...previous, [key]: open };
                localStorage.setItem("pi.workspaceDisclosures", JSON.stringify(next));
                return next;
              });
            }}
          >
            <summary title={group.cwd} aria-label={`${baseName(group.cwd)} workspace`}>
              <span className="workspace-group-glyph" aria-hidden="true">
                <Folder size={16} /><ChevronRight size={16} />
              </span>
              <span
                className="workspace-group-name"
              >{baseName(group.cwd)}</span>
              {names.filter(name => name === baseName(group.cwd).toLowerCase()).length > 1 && (
                <small className="workspace-parent">{parentName(group.cwd)}</small>
              )}
              <button
                type="button" className="workspace-new-session"
                aria-label={t("在 {value1} 中新建会话", { value1: baseName(group.cwd) })} disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const next = { ...disclosures, [projectKey(group.cwd)]: true };
                  setDisclosures(next);
                  localStorage.setItem("pi.workspaceDisclosures", JSON.stringify(next));
                  newSession(group.cwd);
                }}
              ><Plus size={14} /></button>
            </summary>
            {fresh && projectKey(group.cwd) === projectKey(cwd!) && (
              <button className="session-row active" aria-current="page" disabled={busy} onClick={() => select()}>
                <span>
                  <strong>{currentName ?? t("新会话")}</strong>
                </span>
              </button>
            )}
            {group.sessions.map(row)}
            {!group.sessions.length && !(fresh && projectKey(group.cwd) === projectKey(cwd ?? "")) && (
              <div className="workspace-empty">{t("暂无会话")}</div>
            )}
          </details>
        ))}
      {search && sessions.length === 0 && (
        <div className="muted small-pad">{t("没有匹配的会话")}</div>
      )}
    </div>
  );
}
