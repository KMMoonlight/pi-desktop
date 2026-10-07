import { AsyncLocalStorage } from "node:async_hooks";

interface Disposable {
  dispose?(): void;
}
interface Disposal {
  target: object;
  original?: () => void;
  own?: PropertyDescriptor;
  installed?: PropertyDescriptor;
  guard(): void;
  makeGuard(original?: () => void): () => void;
  result?: unknown;
  intercepted: boolean;
  available: boolean;
  active: boolean;
  disposed: boolean;
}

interface Guard {
  record: Disposal;
  original?: () => void;
  own?: PropertyDescriptor;
}

const guards = new WeakMap<Function, Guard>();
const mounts = new WeakMap<object, Set<Disposal>>();
interface DisposalScope {
  owner: object;
  records: ReadonlyMap<object, Disposal>;
  children: ReadonlyMap<object, readonly object[]>;
  protected: ReadonlySet<object>;
  delegated?: Set<object>;
}
interface Invocation {
  record: Disposal;
  calls: Map<Function, unknown>;
  parent?: Invocation;
}
const scopes = new AsyncLocalStorage<DisposalScope>();
const invocations = new AsyncLocalStorage<Invocation>();

function guardRecord(target: object, value: unknown) {
  const record = typeof value === "function" ? guards.get(value) : undefined;
  return record?.record.target === target ? record : undefined;
}

function invocationFor(record: Disposal) {
  for (let entry = invocations.getStore(); entry; entry = entry.parent)
    if (entry.record === record) return entry;
}

function invokeOriginal(entry: Invocation, dispose: unknown) {
  if (typeof dispose !== "function") return;
  if (entry.calls.has(dispose)) return entry.calls.get(dispose);
  entry.calls.set(dispose, undefined);
  const result = dispose.call(entry.record.target);
  entry.calls.set(dispose, result);
  return result;
}

function descriptor(target: object): PropertyDescriptor | undefined {
  const seen = new Set<object>();
  for (
    let owner: object | null = target;
    owner && !seen.has(owner);
    owner = Object.getPrototypeOf(owner)
  ) {
    seen.add(owner);
    const entry = Object.getOwnPropertyDescriptor(owner, "dispose");
    if (entry) return entry;
  }
}

/** Preserve original cleanup authority when a component cannot expose a guard. */
export class ComponentDisposal<T extends Disposable> {
  private tracked = new Set<T>();
  private records = new WeakMap<T, Disposal>();
  private children = new WeakMap<T, readonly T[]>();

  private captureScope(
    protectedTargets: ReadonlySet<object>,
    delegated?: Set<object>,
  ): DisposalScope {
    const records = new Map<object, Disposal>();
    const children = new Map<object, readonly object[]>();
    for (const target of this.tracked) {
      const record = this.records.get(target);
      if (!record?.active) continue;
      records.set(target, record);
      children.set(target, this.children.get(target) ?? []);
    }
    return {
      owner: this,
      records,
      children,
      protected: protectedTargets,
      delegated,
    };
  }

  has(target: T) {
    return this.tracked.has(target);
  }

  private makeGuard(target: T, record: Disposal, original?: () => void) {
    const guard = () => {
      const scope = scopes.getStore();
      const owner = scope?.records.get(target);
      const entry = invocationFor(owner ?? record);
      // A replacement callback may hold a guard from an earlier revision or
      // mount. Async continuations keep that callback's mounted ownership.
      if (entry) return invokeOriginal(entry, original);
      if (!record.active && !owner) return;
      if (owner && owner !== record) return owner.guard();
      if (record.disposed) return record.result;
      if (
        scope?.owner === this &&
        (scope.protected.has(target) || scope.delegated?.has(target))
      )
        return;
      record.disposed = true;
      const current = owner
        ? scope!
        : this.captureScope(
            scope?.owner === this ? scope.protected : new Set(),
          );
      return scopes.run(current, () => {
        this.delegate(target);
        const dispose = record.intercepted ? original : target.dispose;
        const forwarded = guardRecord(target, dispose);
        const entry: Invocation = {
          record,
          calls: new Map(),
          parent: invocations.getStore(),
        };
        record.result = invocations.run(entry, () =>
          invokeOriginal(entry, forwarded ? forwarded.original : dispose),
        );
        return record.result;
      });
    };
    guards.set(guard, { record, original, own: record.own });
    return guard;
  }

  track(target: T) {
    const entry = descriptor(target);
    let record = this.tracked.has(target)
      ? this.records.get(target)
      : undefined;
    this.tracked.add(target);
    if (record?.intercepted && entry?.value === record.guard) return;
    if (!record) {
      const created: Disposal = {
        target,
        intercepted: false,
        available: false,
        active: true,
        disposed: false,
        guard() {},
        makeGuard: (original) => this.makeGuard(target, created, original),
      };
      record = created;
      this.records.set(target, record);
      let active = mounts.get(target);
      if (!active) mounts.set(target, (active = new Set()));
      active.add(record);
    }
    record.intercepted = false;
    record.available = !!entry?.get || typeof entry?.value === "function";
    const previous = guardRecord(target, entry?.value);
    record.original = previous
      ? previous.original
      : typeof entry?.value === "function"
        ? entry.value
        : undefined;
    const own = Object.getOwnPropertyDescriptor(target, "dispose");
    record.own = previous ? previous.own : own;
    record.guard = record.makeGuard(record.original);
    if (!record.original) return;
    if (own && !own.configurable && !("value" in own && own.writable)) return;
    if (!own && !Object.isExtensible(target)) return;
    Object.defineProperty(
      target,
      "dispose",
      own
        ? { ...own, value: record.guard }
        : { configurable: true, writable: true, value: record.guard },
    );
    record.installed = Object.getOwnPropertyDescriptor(target, "dispose");
    record.intercepted = true;
  }

  private retire(target: T, record: Disposal) {
    record.active = false;
    const active = mounts.get(target);
    active?.delete(record);
    if (!active?.size) mounts.delete(target);
    const own = Object.getOwnPropertyDescriptor(target, "dispose");
    if (own?.value !== record.guard || (!own.configurable && !own.writable))
      return;
    const candidates = [...(active ?? [])].filter((entry) => entry.intercepted);
    const next = candidates.find((entry) => !entry.disposed) ?? candidates[0];
    if (next) {
      next.original = record.original;
      next.own = record.own;
      next.guard = next.makeGuard(next.original);
      Object.defineProperty(target, "dispose", { ...own, value: next.guard });
    } else if (record.own) {
      Object.defineProperty(target, "dispose", {
        ...own,
        value: record.original,
      });
    } else if (
      own.configurable === record.installed?.configurable &&
      own.enumerable === record.installed?.enumerable &&
      own.writable === record.installed?.writable
    ) {
      Reflect.deleteProperty(target, "dispose");
    } else {
      Object.defineProperty(target, "dispose", {
        ...own,
        value: record.original,
      });
    }
  }

  connect(target: T, children: readonly T[]) {
    this.track(target);
    for (const child of children) this.track(child);
    this.children.set(target, [...new Set(children)]);
  }

  private descendants(
    target: T,
    graph?: ReadonlyMap<object, readonly object[]>,
  ) {
    const children = (target: T) =>
      (graph ? graph.get(target) : this.children.get(target)) as
        readonly T[] | undefined;
    const seen = new Set<T>([target]);
    const pending = [...(children(target) ?? [])];
    while (pending.length) {
      const child = pending.pop()!;
      if (seen.has(child)) continue;
      seen.add(child);
      pending.push(...(children(child) ?? []));
    }
    seen.delete(target);
    return seen;
  }

  private delegate(target: T) {
    const scope = scopes.getStore();
    if (scope?.owner !== this || !scope.delegated) return;
    // Suppress supplemental calls only in this cleanup pass. The original
    // parent may leave an immutable cached child alive for later reuse.
    for (const child of this.descendants(target, scope.children))
      if (!scope.records.get(child)?.intercepted) scope.delegated.add(child);
  }

  release(
    preserve: Set<T>,
    cleanup: (target: T, dispose?: () => void) => void,
  ) {
    for (const target of this.tracked) this.track(target);
    const retained = new Set(preserve);
    let changed = true;
    while (changed) {
      changed = false;
      for (const target of this.tracked) {
        if (
          retained.has(target) ||
          this.records.get(target)?.disposed ||
          !this.records.get(target)?.available
        )
          continue;
        const descendants = this.descendants(target);
        if (
          ![...descendants].some(
            (child) =>
              retained.has(child) &&
              this.records.get(child)?.available &&
              !this.records.get(child)?.intercepted,
          )
        )
          continue;
        // A parent cannot protect a retained locked child during its original
        // callback. Defer that original ownership tree until it can be released.
        retained.add(target);
        for (const child of descendants) retained.add(child);
        changed = true;
      }
    }
    const released = new Set(
      [...this.tracked].filter((target) => !retained.has(target)),
    );
    const descendants = new Set(
      [...released]
        .flatMap((target) => [...(this.children.get(target) ?? [])])
        .filter((target) => released.has(target)),
    );
    const ordered: T[] = [];
    const visit = (target: T) => {
      if (!released.delete(target)) return;
      ordered.push(target);
      for (const child of this.children.get(target) ?? []) visit(child);
    };
    for (const target of released) if (!descendants.has(target)) visit(target);
    for (const target of released) visit(target);
    const previous = scopes.getStore();
    const scope = this.captureScope(
      retained,
      new Set(previous?.owner === this ? previous.delegated : undefined),
    );
    scopes.run(scope, () => {
      // A shared immutable child can be visited through a nondisposing current
      // parent before its detached original owner. Reserve native ownership
      // before any supplemental cleanup can run.
      for (const target of ordered)
        if (scope.records.get(target)?.available) this.delegate(target);
      for (const target of this.tracked)
        if (
          scope.records.get(target)?.disposed &&
          scope.records.get(target)?.available
        )
          this.delegate(target);
      for (const target of ordered) {
        const record = scope.records.get(target)!;
        if (this.records.get(target) === record) this.tracked.delete(target);
        try {
          cleanup(target, record.available ? record.guard : undefined);
        } finally {
          this.retire(target, record);
        }
      }
    });
  }
}
