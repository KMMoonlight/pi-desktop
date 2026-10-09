import { t, useLocale, getLocale } from "./i18n";
import { Folder, Pin, Plus, ChevronRight, Trash2 } from "lucide-react";
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
  pending,
  select,
  pin,
  remove,
  removeWorkspace,
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
  pending?: boolean;
  select: (session?: SessionItem) => void;
  pin: (id: string) => void;
  remove: (session: SessionItem) => void;
  removeWorkspace: (cwd: string) => void;
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
    groups.get(key)?.sessions.push(session);
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
      data-session-id={session.id}
    >
      <Hint
        text={`${session.cwd} · ${new Date(session.modified).toLocaleString(getLocale())}`}
      >
        <button disabled={busy} aria-disabled={pending || undefined} aria-current={session.id === currentId ? "page" : undefined} onClick={() => { if (!pending) select(session); }}>
          <span>
            <strong>
              {session.name || (session.messageCount > 0 && session.firstMessage) || t("新会话")}
            </strong>
            <small className="session-time">{relativeTime(session.modified)}</small>
          </span>
        </button>
      </Hint>
      <IconButton
        icon={Pin}
        label={pins.includes(session.id) ? t("取消固定") : t("固定会话")}
        active={pins.includes(session.id)}
        attributes={{ "data-session-action": "pin" }}
        onClick={() => pin(session.id)}
      />
      {!busy && <IconButton
        icon={Trash2}
        label={t("删除会话")}
        color="critical"
        attributes={{ "data-session-action": "delete", "aria-disabled": pending || undefined }}
        onClick={() => { if (!pending) remove(session); }}
      />}
    </div>
  );
  return (
    <div className="session-list min-h-0 flex-1 overflow-y-auto px-3 pb-3">
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
                type="button" className="workspace-remove workspace-new-session"
                aria-label={t("移除工作区 {value1}", { value1: baseName(group.cwd) })}
                disabled={busy} aria-disabled={pending || undefined}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!pending) removeWorkspace(group.cwd);
                }}
              ><Trash2 size={14} /></button>
              <button
                type="button" className="workspace-new-session"
                aria-label={t("在 {value1} 中新建会话", { value1: baseName(group.cwd) })} disabled={busy}
                aria-disabled={pending || undefined}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (pending) return;
                  const next = { ...disclosures, [projectKey(group.cwd)]: true };
                  setDisclosures(next);
                  localStorage.setItem("pi.workspaceDisclosures", JSON.stringify(next));
                  newSession(group.cwd);
                }}
              ><Plus size={14} /></button>
            </summary>
            {fresh && projectKey(group.cwd) === projectKey(cwd!) && (
              <button className="session-row active" data-session-id={currentId} aria-current="page" disabled={busy} aria-disabled={pending || undefined} onClick={() => { if (!pending) select(); }}>
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
