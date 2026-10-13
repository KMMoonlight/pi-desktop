import type { DesktopEvent, DesktopSnapshot } from "./types.ts";

type Path = (string | number)[];
export type SnapshotChange = [Path, unknown] | [Path];
export type DesktopWireEvent =
  | DesktopEvent
  | {
      type: "snapshot_patch";
      backendId: string;
      sessionId: string;
      baseRevision: number;
      revision: number;
      changes: SnapshotChange[];
    };

// Retain our own JSON-shaped copy: SDK objects may be mutated in place after
// publication. Unchanged branches retain identity on both sides of the wire.
function reconcile(
  previous: any,
  next: any,
  path: Path,
  changes: SnapshotChange[],
): any {
  if (Object.is(previous, next)) return previous;
  if (next === null || typeof next !== "object") {
    changes.push([path, next]);
    return next;
  }
  const array = Array.isArray(next);
  if (
    !previous ||
    typeof previous !== "object" ||
    Array.isArray(previous) !== array ||
    (array && previous.length !== next.length)
  ) {
    const value = JSON.parse(JSON.stringify(next));
    changes.push([path, value]);
    return value;
  }
  let result = previous;
  const copy = () => {
    if (result === previous)
      result = array ? previous.slice() : { ...previous };
  };
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) continue;
    const part = array ? Number(key) : key;
    const value = reconcile(previous[key], next[key], [...path, part], changes);
    if (!Object.hasOwn(previous, key) || value !== previous[key]) {
      copy();
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  for (const key of Object.keys(previous)) {
    if (Object.hasOwn(next, key) && next[key] !== undefined) continue;
    copy();
    delete result[key];
    changes.push([[...path, array ? Number(key) : key]]);
  }
  return result;
}

// Bound retained histories independently on each transport connection. Both ends
// use the same LRU order; a missing revision still takes the normal resync path.
class SnapshotBaselines {
  private backendId?: string;
  private entries = new Map<string, DesktopSnapshot>();
  clear() { this.entries.clear(); this.backendId = undefined; }
  get(backendId: string, sessionId: string) {
    return backendId === this.backendId ? this.entries.get(sessionId) : undefined;
  }
  set(snapshot: DesktopSnapshot) {
    if (this.backendId !== snapshot.backendId) this.clear();
    this.backendId = snapshot.backendId;
    this.entries.delete(snapshot.sessionId);
    this.entries.set(snapshot.sessionId, snapshot);
    if (this.entries.size > 3) this.entries.delete(this.entries.keys().next().value!);
  }
}

export class SnapshotEncoder {
  private baselines = new SnapshotBaselines();
  reset() {
    this.baselines.clear();
  }
  encode(event: DesktopEvent): DesktopWireEvent {
    if (event.type === "workspace_closed" || event.type === "shutdown")
      this.reset();
    if (event.type !== "snapshot") return event;
    const next = event.data;
    const previous = this.baselines.get(next.backendId, next.sessionId);
    if (
      !previous ||
      previous.backendId !== next.backendId ||
      previous.sessionId !== next.sessionId
    ) {
      const data = JSON.parse(JSON.stringify(next));
      this.baselines.set(data);
      return { type: "snapshot", data };
    }
    const changes: SnapshotChange[] = [];
    this.baselines.set(reconcile(previous, next, [], changes));
    return {
      type: "snapshot_patch",
      backendId: next.backendId,
      sessionId: next.sessionId,
      baseRevision: previous.revision,
      revision: next.revision,
      changes,
    };
  }
}

export class SnapshotDecoder {
  private baselines = new SnapshotBaselines();
  decode(event: DesktopWireEvent): DesktopEvent | undefined {
    if (event.type === "workspace_closed" || event.type === "shutdown")
      this.baselines.clear();
    if (event.type === "snapshot") this.baselines.set(event.data);
    if (event.type !== "snapshot_patch") return event;
    const previous = this.baselines.get(event.backendId, event.sessionId);
    if (
      !previous ||
      previous.backendId !== event.backendId ||
      previous.sessionId !== event.sessionId ||
      previous.revision !== event.baseRevision
    )
      return undefined;
    // Clone each changed ancestor once even when many leaves change.
    const copies = new WeakMap<object, any>();
    const copy = (value: any) => {
      let result = copies.get(value);
      if (!result) {
        result = Array.isArray(value) ? value.slice() : { ...value };
        copies.set(value, result);
        copies.set(result, result);
      }
      return result;
    };
    let result: any = copy(previous);
    for (const change of event.changes) {
      const [path, value] = change;
      if (!path.length) {
        result = value;
        continue;
      }
      let node = result;
      for (const key of path.slice(0, -1)) node = node[key] = copy(node[key]);
      const key = path.at(-1)!;
      if (change.length === 1) delete node[key];
      else
        Object.defineProperty(node, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    this.baselines.set(result);
    return { type: "snapshot", data: result };
  }
}
