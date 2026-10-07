import type {
  AgentSession,
  AgentSessionEvent,
  SessionProjection,
} from "@earendil-works/pi-coding-agent";
import { componentText } from "./component-text.ts";
import type { loadComponentRuntime, PiComponent } from "./component-runtime.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
import { createHash } from "node:crypto";

type Runtime = Awaited<ReturnType<typeof loadComponentRuntime>>;
type Message = AgentSession["messages"][number];
type Record = { id: string; entryId?: string; message: Message };
type Row = {
  key: string;
  signature: string;
  entries: { id: string; component: PiComponent }[];
};
const messageKey = (message: Message) =>
  createHash("sha256").update(JSON.stringify(message)).digest("hex");

/** Session-owned native notices; persisted usage and transient live diagnostics differ. */
export class ConversationNotices {
  private renderer;
  private rows = new Map<string, Row>();
  private live = new Map<string, { thinking: Row; miss: Row }>();
  private placements = new Map<string | undefined, Row[]>();
  private visible = new Set<string>();
  private shown?: boolean;
  private disposed = false;
  private streaming = false;
  private chronologicalCompaction?: string;

  constructor(
    private session: () => AgentSession,
    private runtime: Runtime,
  ) {
    this.renderer = runtime.conversation.create(session);
  }
  private row(key: string, value: unknown, build: () => PiComponent[]): Row {
    const signature = JSON.stringify(value);
    let row = this.rows.get(key);
    if (!row || row.signature !== signature) {
      row = {
        key,
        signature,
        entries: build().map((component, index) => ({
          id: `conversation-notice:${key}:${index}`,
          component,
        })),
      };
      this.rows.set(key, row);
    }
    return row;
  }
  event(event: AgentSessionEvent) {
    if (this.disposed) return;
    if (event.type === "message_start" && event.message.role === "assistant")
      this.streaming = true;
    if (event.type === "message_end" && event.message.role === "assistant") {
      if (
        this.streaming &&
        !["aborted", "error"].includes(event.message.stopReason)
      ) {
        const message = event.message,
          key = messageKey(message);
        // message_end is emitted before appendMessage: use the original live
        // detector now, rather than treating the current response as its predecessor.
        this.live.set(key, {
          thinking: this.row(`thinking:${key}`, message, () =>
            this.renderer.thinking(message),
          ),
          miss: this.row(`miss:${key}`, message, () =>
            this.renderer.liveMiss(message),
          ),
        });
      }
      this.streaming = false;
    }
    if (
      (event.type === "compaction_end" && !event.aborted && event.result) ||
      (event.type === "entry_appended" && event.entry.type === "compaction")
    ) {
      const latest = this.session().sessionManager.buildContextEntries()[0];
      if (
        latest?.type === "compaction" &&
        (event.type === "compaction_end" || event.entry.id === latest.id)
      ) {
        this.clearLive();
        this.chronologicalCompaction = latest.id;
      }
    }
  }
  private clearLive() {
    for (const { thinking, miss } of this.live.values()) {
      this.rows.delete(thinking.key);
      this.rows.delete(miss.key);
    }
    this.live.clear();
  }
  sync(records: Record[], projection: SessionProjection) {
    if (this.disposed) return;
    const shown = this.session().settingsManager.getShowCacheMissNotices();
    // Native settings rebuild the transcript. Thinking-drop notices are live
    // only and must not reappear from diagnostics after a rebuild.
    if (this.shown !== undefined && this.shown !== shown) {
      this.clearLive();
      this.rows.clear();
      this.chronologicalCompaction = undefined;
    }
    this.shown = shown;
    this.placements.clear();
    this.visible.clear();
    if (!shown) return;
    const place = (after: string | undefined, row: Row) => {
      if (!row.entries.length) return;
      const list = this.placements.get(after) ?? [];
      if (list.includes(row)) return;
      list.push(row);
      this.placements.set(after, list);
      this.visible.add(row.key);
    };
    const byEntry = new Map<string, Record[]>();
    for (const record of records) {
      if (!record.entryId) continue;
      const list = byEntry.get(record.entryId) ?? [];
      list.push(record);
      byEntry.set(record.entryId, list);
    }
    const misses = this.renderer.misses();
    let previous: string | undefined;
    for (const { sourceEntry: entry } of this.projectedEntries(projection)) {
      const contributions = byEntry.get(entry.id) ?? [];
      if (entry.type === "usage" && entry.kind === "cache_warm") {
        place(
          previous,
          this.row(`warm:${entry.id}`, entry, () =>
            this.renderer.warming(entry),
          ),
        );
      }
      for (const record of contributions) {
        previous = record.id;
        if (record.message.role !== "assistant") continue;
        const key = messageKey(record.message),
          live = this.live.get(key);
        if (live) place(record.id, live.thinking);
        const original =
          entry.type === "message" && entry.message.role === "assistant"
            ? entry.message
            : undefined;
        const miss =
          original && !["aborted", "error"].includes(original.stopReason)
            ? misses.get(original)
            : undefined;
        if (miss) {
          // Adopt the live native pair after persistence; unchanged snapshots
          // retain its actual instances and extension mutations.
          const row =
            live?.miss ??
            this.row(`miss:${key}`, miss, () => this.renderer.miss(miss));
          place(record.id, row);
        }
      }
      if (
        (entry.type === "compaction" || entry.type === "branch_summary") &&
        entry.usage &&
        contributions.length
      ) {
        place(
          previous,
          this.row(`summary:${entry.id}`, entry, () =>
            this.renderer.summary(entry),
          ),
        );
      }
    }
    // Agent state owns the completed message before session persistence. The
    // projection can still lack it when a subscriber takes a synchronous snapshot.
    for (const record of records) {
      const live = this.live.get(messageKey(record.message));
      if (!live || byEntry.has(record.entryId ?? "")) continue;
      place(record.id, live.thinking);
      place(record.id, live.miss);
    }
    const retained = new Set(
      [...this.live.values()].flatMap((value) => [
        value.thinking.key,
        value.miss.key,
      ]),
    );
    for (const key of this.rows.keys())
      if (!this.visible.has(key) && !retained.has(key)) this.rows.delete(key);
  }
  entries(after?: string) {
    return (this.placements.get(after) ?? []).flatMap((row) => row.entries);
  }
  projectedEntries(projection: SessionProjection) {
    if (!this.chronologicalCompaction) return projection.entries;
    const positions = new Map(
      this.session()
        .sessionManager.getBranch()
        .map((entry, index) => [entry.id, index]),
    );
    return projection.entries
      .slice()
      .sort(
        (a, b) =>
          (positions.get(a.sourceEntry.id) ?? Infinity) -
          (positions.get(b.sourceEntry.id) ?? Infinity),
      );
  }
  order<T extends { entryId?: string }>(
    records: T[],
    projection: SessionProjection,
  ) {
    if (
      !this.chronologicalCompaction ||
      (this.shown !== undefined &&
        this.shown !== this.session().settingsManager.getShowCacheMissNotices())
    )
      return records;
    const positions = new Map(
      this.projectedEntries(projection).map((entry, index) => [
        entry.sourceEntry.id,
        index,
      ]),
    );
    return records
      .slice()
      .sort(
        (a, b) =>
          (positions.get(a.entryId ?? "") ?? Infinity) -
          (positions.get(b.entryId ?? "") ?? Infinity),
      );
  }
  presentation(
    width: number,
  ): NonNullable<DesktopSnapshot["conversationNotices"]> {
    return [...this.placements].flatMap(([afterMessageId, rows]) =>
      rows.map((row) => ({
        id: row.entries.at(-1)!.id,
        afterMessageId,
        // The shared chat tree and desktop use these same original native objects.
        presentation: componentText(
          row.entries
            .map((entry) => entry.component.render(Math.max(3, width)))
            .flat()
            .join("\n")
            .trimEnd(),
          this.runtime.text,
        ),
      })),
    );
  }
  invalidate() {
    for (const row of this.rows.values())
      for (const entry of row.entries) entry.component.invalidate();
  }
  reset() {
    this.rows.clear();
    this.live.clear();
    this.placements.clear();
    this.visible.clear();
    this.shown = undefined;
    this.streaming = false;
    this.chronologicalCompaction = undefined;
  }
  dispose() {
    this.reset();
    this.disposed = true;
  }
}
