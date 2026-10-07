import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

interface PendingOperation {
  completed: Promise<void>;
  excluded: Promise<void>;
  exclude(): void;
  closingCaller: boolean;
}

/** Track hosted construction without replacing original SDK results or Promises. */
export class RuntimeLifecycle {
  private pending = new Set<PendingOperation>();
  private scope = new AsyncLocalStorage<ReadonlySet<PendingOperation>>();
  private closing?: Promise<void>;

  track<T>(operation: () => T): T {
    let resolve!: () => void;
    let exclude!: () => void;
    const pending: PendingOperation = {
      completed: new Promise<void>((done) => (resolve = done)),
      excluded: new Promise<void>((done) => (exclude = done)),
      closingCaller: false,
      exclude() {
        this.closingCaller = true;
        exclude();
      },
    };
    this.pending.add(pending);
    const owners = new Set(this.scope.getStore());
    owners.add(pending);
    const finish = () => {
      this.pending.delete(pending);
      resolve();
    };
    try {
      const result = this.scope.run(owners, operation);
      void Promise.resolve(result).then(finish, finish);
      return result;
    } catch (error) {
      finish();
      throw error;
    }
  }

  close(): Promise<void> {
    for (const operation of this.scope.getStore() ?? []) operation.exclude();
    // A callback can await host shutdown. Waiting for that callback here would
    // make shutdown depend on its own completion; other operations still join.
    return (this.closing ??= Promise.all(
      [...this.pending].map((operation) =>
        Promise.race([operation.completed, operation.excluded]),
      ),
    ).then(() => {}));
  }

  canCompleteConstruction() {
    if (!this.closing) return true;
    return [...(this.scope.getStore() ?? [])].some(
      (operation) => this.pending.has(operation) && !operation.closingCaller,
    );
  }
}

export function bindRuntimeTransitions(
  runtime: AgentSessionRuntime,
  lifecycle: RuntimeLifecycle,
  current: () => boolean,
): () => void {
  const restore: (() => void)[] = [];
  for (const name of [
    "newSession",
    "switchSession",
    "fork",
    "importFromJsonl",
  ] as const) {
    const original = runtime[name];
    const descriptor = Object.getOwnPropertyDescriptor(runtime, name);
    const method = function (this: AgentSessionRuntime, ...args: unknown[]) {
      if (this !== runtime) return Reflect.apply(original, this, args);
      if (!current())
        return Promise.reject(
          new DOMException("Hosted runtime is closed", "AbortError"),
        );
      return lifecycle.track(() => Reflect.apply(original, this, args));
    };
    Object.defineProperty(runtime, name, {
      configurable: true,
      writable: true,
      enumerable: descriptor?.enumerable ?? false,
      value: method,
    });
    restore.push(() => {
      if (Object.getOwnPropertyDescriptor(runtime, name)?.value !== method)
        return;
      if (descriptor) Object.defineProperty(runtime, name, descriptor);
      else Reflect.deleteProperty(runtime, name);
    });
  }
  return () => restore.forEach((operation) => operation());
}
