import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { unlink } from "node:fs/promises";
import { forgetDesktopSession, rememberDesktopSessionFile } from "./session-history.ts";
import { TerminalHost } from "./terminal-host.ts";
import type { ActionRequest, DesktopEvent, DesktopSnapshot, DialogRequest, SessionItem } from "../shared/types.ts";

export interface SessionWorker extends EventEmitter {
  snapshot(): DesktopSnapshot | undefined;
  readonly pendingDialogs: DialogRequest[];
  action(request: ActionRequest): Promise<any>;
  dispose(): Promise<void>;
}
type Entry = {
  worker: SessionWorker;
  snapshot?: DesktopSnapshot;
  completed: number;
  failed: boolean;
  auth?: Extract<DesktopEvent, { type: "auth_url" }>;
  notices: Extract<DesktopEvent, { type: "notice" }>[];
};

/** A worker owns one live session, including its PTY, SDK, extensions and dialogs.
 * Selecting another worker never changes or aborts the previous worker's task.
 */
export class SessionHost extends EventEmitter {
  private readonly backendId = randomUUID();
  private revision = 0;
  private entries = new Set<Entry>();
  private active: Entry;
  private navigating = false;
  private disposal?: Promise<void>;
  private navigation?: Promise<unknown>;
  private appearance?: unknown;
  private workspaces?: string[];

  constructor(private factory: () => SessionWorker = () => new TerminalHost()) {
    super();
    this.active = this.create();
  }
  get runtime() { return this.active.snapshot; }
  get pendingDialogs() { return this.active.worker.pendingDialogs; }
  snapshot(): DesktopSnapshot | undefined {
    const snapshot = this.active.snapshot;
    if (!snapshot) return undefined;
    return {
      ...snapshot,
      backendId: this.backendId,
      revision: this.revision,
      recentWorkspaces: this.workspaces ?? snapshot.recentWorkspaces,
      changing: snapshot.changing || this.navigating,
      busy: snapshot.busy || this.navigating,
      sessionActivity: [...this.entries].flatMap(entry => entry.snapshot ? [{
        id: entry.snapshot.sessionId,
        running: entry.snapshot.running,
        needsAttention: entry.failed || !!entry.auth || entry.worker.pendingDialogs.length > 0 ||
          !!entry.snapshot.desktopSurfaces?.some(surface => surface.slot === "dialog" && !surface.overlay?.hidden),
        completed: entry.completed,
      }] : []),
    };
  }
  private publish() {
    this.revision++;
    const data = this.snapshot();
    if (data) this.emit("event", { type: "snapshot", data } satisfies DesktopEvent);
    return data;
  }
  private create() {
    const entry: Entry = { worker: this.factory(), completed: 0, failed: false, notices: [] };
    this.entries.add(entry);
    entry.worker.on("event", (event: DesktopEvent) => {
      if (!this.entries.has(entry)) return;
      if (this.disposal) {
        // Drain final SDK cleanup events before the supervisor closes transport.
        if (entry === this.active) this.emit("event", event);
        return;
      }
      if (event.type === "snapshot") {
        const before = entry.snapshot;
        entry.snapshot = event.data;
        if (before?.running && !event.data.running) entry.completed++;
        if (entry === this.active || before?.running !== event.data.running ||
          JSON.stringify(before?.desktopSurfaces?.filter(surface => surface.slot === "dialog")) !==
          JSON.stringify(event.data.desktopSurfaces?.filter(surface => surface.slot === "dialog")))
          this.publish();
        return;
      }
      if (event.type === "shutdown" || event.type === "terminal_exit") {
        entry.failed = true;
        if (entry.snapshot) entry.snapshot = { ...entry.snapshot, running: false, busy: false, changing: false };
        this.publish();
        if (event.type === "shutdown" && this.entries.size === 1)
          this.emit("event", event);
        // A worker exiting must not shut down other sessions or the desktop.
        if (entry === this.active && event.type === "terminal_exit") this.emit("event", event);
        return;
      }
      if (event.type === "auth_url") entry.auth = event;
      if (event.type === "workspace_closed") entry.snapshot = undefined;
      if (event.type === "dialog" || event.type === "dialog_closed" || event.type === "auth_url") this.publish();
      if (entry === this.active) this.emit("event", event);
      else if (event.type === "notice") {
        entry.notices.push(event);
        if (entry.notices.length > 20) entry.notices.shift();
      }
    });
    return entry;
  }
  private select(entry: Entry) {
    for (const dialog of this.pendingDialogs)
      this.emit("event", { type: "dialog_closed", id: dialog.id } satisfies DesktopEvent);
    this.active = entry;
    const selected = entry.snapshot;
    if (selected?.sessionFile)
      rememberDesktopSessionFile(selected.agentDir, selected.cwd, selected.sessionId, selected.sessionFile);
    this.emit("event", { type: "activity", name: "desktop_session_selected" } satisfies DesktopEvent);
    const snapshot = this.publish();
    for (const data of this.pendingDialogs) this.emit("event", { type: "dialog", data } satisfies DesktopEvent);
    if (entry.auth) this.emit("event", entry.auth);
    for (const notice of entry.notices.splice(0)) this.emit("event", notice);
    return snapshot;
  }
  private findPath(path: string) {
    return [...this.entries].find(entry => entry.snapshot?.sessionFile && resolve(entry.snapshot.sessionFile) === resolve(path));
  }
  private async open(args: Record<string, unknown>) {
    const entry = this.create();
    try {
      const snapshot = await entry.worker.action({ action: "initialize", args: { appearance: this.appearance, ...args } });
      if (!snapshot?.sessionId) throw new Error("会话初始化失败");
      entry.snapshot = snapshot;
      this.workspaces = snapshot.recentWorkspaces;
      if (this.disposal) throw new Error("Pi 正在关闭");
      return this.select(entry);
    } catch (error) {
      this.entries.delete(entry);
      await entry.worker.dispose().catch(() => {});
      throw error;
    }
  }
  private async navigate(request: ActionRequest) {
    if (this.navigating) throw new Error("会话正在切换，请稍后重试");
    this.navigating = true;
    this.publish();
    try {
      const args = request.args ?? {};
      if (request.action === "session.delete") {
        if (typeof args.path !== "string" || typeof args.id !== "string") throw new Error("缺少会话路径或 ID");
        const history: SessionItem[] = await this.active.worker.action({ action: "sessions.list", args: { all: true } });
        const target = history.find(session => session.id === args.id && resolve(session.path) === resolve(String(args.path)));
        if (!target) throw new Error("会话不存在或已被删除");
        const entry = this.findPath(target.path);
        if (entry?.snapshot?.busy || entry?.worker.pendingDialogs.length) throw new Error("请先停止要删除的会话任务");
        const agentDir = this.active.snapshot!.agentDir;
        if (entry === this.active) {
          const next = history.find(session => session.id !== target.id && session.cwd === target.cwd);
          if (next) {
            const existing = this.findPath(next.path);
            if (existing) this.select(existing);
            else await this.open({ cwd: next.cwd, sessionFile: next.path });
          } else await this.open({ cwd: target.cwd, newSession: true, unsaved: true });
        }
        if (entry) {
          this.entries.delete(entry);
          await entry.worker.dispose();
        }
        await unlink(target.path);
        forgetDesktopSession(agentDir, target.id, target.path);
        return this.publish();
      }
      if (request.action === "workspace.remove") {
        if (typeof args.cwd !== "string") throw new Error("缺少工作区路径");
        const cwd = resolve(args.cwd);
        const affected = [...this.entries].filter(entry => entry.snapshot?.cwd === cwd);
        if (affected.some(entry => entry.snapshot?.busy || entry.worker.pendingDialogs.length)) throw new Error("请先停止此工作区中的任务");
        // Update preferences on a worker with no session, so the SDK cannot
        // implicitly open a file that another worker already owns.
        const admin = this.create();
        try {
          await admin.worker.action(request);
          this.workspaces = await admin.worker.action({ action: "workspaces.list" });
          if (affected.includes(this.active)) {
            const next = [...this.entries].find(entry => entry.snapshot && !affected.includes(entry));
            if (next) this.select(next);
            else if (this.workspaces?.length) await this.open({ cwd: this.workspaces[0] });
            else {
              this.select(admin);
              this.emit("event", { type: "workspace_closed", workspaces: this.workspaces ?? [] } satisfies DesktopEvent);
            }
          }
          for (const entry of affected) {
            this.entries.delete(entry);
            await entry.worker.dispose();
          }
          return this.publish();
        } finally {
          if (admin !== this.active) {
            this.entries.delete(admin);
            await admin.worker.dispose();
          }
        }
      }
      if (request.action === "session.switch") {
        if (typeof args.path !== "string") throw new Error("缺少会话路径");
        const existing = this.findPath(args.path);
        if (existing) return this.select(existing);
        const activeSnapshot = this.active.snapshot;
        const canReuseActiveWorker =
          this.entries.size === 1 &&
          !!activeSnapshot &&
          !activeSnapshot.busy &&
          this.pendingDialogs.length === 0 &&
          typeof args.cwd === "string" &&
          resolve(args.cwd) === resolve(activeSnapshot.cwd);
        if (canReuseActiveWorker) {
          const result = await this.active.worker.action(request);
          if (result?.sessionId) {
            this.active.snapshot = result;
            this.workspaces = result.recentWorkspaces;
          }
          return this.select(this.active);
        }
        // The session rail already has the session's cwd. Avoid rescanning
        // every history file just to recover data that the caller supplied.
        if (typeof args.cwd === "string" && args.cwd.length > 0)
          return await this.open({ cwd: args.cwd, sessionFile: args.path });
        const history: SessionItem[] = await this.active.worker.action({ action: "sessions.list", args: { all: true } });
        const target = history.find(session => resolve(session.path) === resolve(args.path as string));
        if (!target) throw new Error("会话不存在或已被删除");
        return await this.open({ cwd: target.cwd, sessionFile: target.path });
      }
      if (request.action === "session.new") {
        const cwd = args.cwd ?? this.active.snapshot?.cwd;
        if (!cwd) throw new Error("请先选择工作区");
        return await this.open({ cwd, newSession: true });
      }
      if (args.appearance !== undefined) this.appearance = args.appearance;
      if (this.active.snapshot) {
        if (args.resumeExisting === true || !args.cwd || resolve(String(args.cwd)) === this.active.snapshot.cwd)
          return this.snapshot();
        const existing = [...this.entries].find(entry => entry.snapshot?.cwd === resolve(String(args.cwd)));
        return existing ? this.select(existing) : await this.open(args);
      }
      const data = await this.active.worker.action(request);
      if (data?.sessionId) {
        this.active.snapshot = data;
        this.workspaces = data.recentWorkspaces;
      }
      return data?.sessionId ? this.publish() : data;
    } finally {
      this.navigating = false;
      this.publish();
    }
  }
  async action(request: ActionRequest): Promise<any> {
    if (request.action === "shutdown") return this.dispose().then(() => null);
    if (this.disposal) throw new Error("Pi 正在关闭");
    if (request.action === "initialize" && request.args?.resumeExisting === true && this.active.snapshot)
      return this.snapshot();
    if (["initialize", "session.new", "session.switch", "session.delete", "workspace.remove"].includes(request.action)) {
      if (this.navigating) throw new Error("会话正在切换，请稍后重试");
      const navigation = this.navigate(request);
      this.navigation = navigation;
      const result = await navigation;
      return result?.sessionId ? this.snapshot() : result;
    }
    const args = request.args ?? {};
    const scope = args.__sessionId;
    let entry = typeof scope === "string"
      ? [...this.entries].find(candidate => candidate.snapshot?.sessionId === scope)
      : this.active;
    if (!entry) throw new Error("会话已关闭，请重新打开");
    if (typeof args.instanceId === "string" && request.action.startsWith("desktop.")) {
      entry = [...this.entries].find(candidate => candidate.snapshot?.desktopSurfaces?.some(surface => surface.instanceId === args.instanceId)) ?? entry;
    }
    if (request.action === "snapshot") {
      if (this.active.failed) return this.active.worker.action(request);
      return this.snapshot();
    }
    if (request.action === "dialog.list") return this.pendingDialogs;
    if (request.action === "dialog.answer") {
      entry = [...this.entries].find(candidate => candidate.worker.pendingDialogs.some(dialog => dialog.id === args.id)) ?? entry;
    }
    if (request.action === "desktop.appearance") {
      this.appearance = args.appearance;
      await Promise.all([...this.entries].map(candidate => candidate.worker.action(request)));
      return this.publish();
    }
    const forwarded = args.backendId === this.backendId
      ? { ...request, args: { ...args, backendId: entry.snapshot?.backendId } }
      : request;
    const result = await entry.worker.action(forwarded);
    if (["workspace.add", "workspace.remove"].includes(request.action))
      this.workspaces = await entry.worker.action({ action: "workspaces.list" });
    if (request.action === "auth.cancel" || request.action === "auth.login") { entry.auth = undefined; this.publish(); }
    if (result?.sessionId && result?.backendId) {
      if (!entry.snapshot || result.revision >= entry.snapshot.revision)
        entry.snapshot = result;
      // A late result from a background worker must never select it again.
      return entry === this.active ? this.publish() : null;
    }
    return result;
  }
  dispose(): Promise<void> {
    return this.disposal ??= Promise.resolve().then(async () => {
      const results = await Promise.allSettled([...this.entries].map(entry => entry.worker.dispose()));
      await this.navigation?.catch(() => {});
      this.entries.clear();
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    });
  }
}
