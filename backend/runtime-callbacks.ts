import type {
  AgentSession,
  AgentSessionRuntime,
} from "@earendil-works/pi-coding-agent";

type Rebind = Parameters<AgentSessionRuntime["setRebindSession"]>[0];
type BeforeInvalidate = Parameters<
  AgentSessionRuntime["setBeforeSessionInvalidate"]
>[0];

/** Compose public caller hooks with the hosted runtime's independent UI ownership. */
export function bindRuntimeCallbacks(
  runtime: AgentSessionRuntime,
  lifecycle: {
    current(): boolean;
    rebind(session: AgentSession): Promise<void>;
    beforeInvalidate(): void;
  },
): () => void {
  let owner: typeof lifecycle | undefined = lifecycle;
  let callerRebind: Rebind;
  let callerBefore: BeforeInvalidate;
  const originals = {
    setRebindSession: runtime.setRebindSession,
    setBeforeSessionInvalidate: runtime.setBeforeSessionInvalidate,
  };
  const restore: (() => void)[] = [];
  const rebind = function (this: AgentSessionRuntime, session: AgentSession) {
    const callback = callerRebind;
    const current = owner;
    if (!current?.current())
      return callback?.call(this, session) ?? Promise.resolve();
    return current.rebind(session).then(() => callback?.call(this, session));
  };
  const before = function (this: AgentSessionRuntime) {
    const callback = callerBefore;
    const current = owner;
    try {
      return callback?.call(this);
    } finally {
      if (current?.current()) current.beforeInvalidate();
    }
  };
  const setRebind = function (this: AgentSessionRuntime, callback: Rebind) {
    if (this !== runtime || !owner)
      return Reflect.apply(originals.setRebindSession, this, [callback]);
    const previous = callerRebind;
    callerRebind = callback;
    try {
      return Reflect.apply(originals.setRebindSession, this, [rebind]);
    } catch (error) {
      callerRebind = previous;
      throw error;
    }
  };
  const setBefore = function (
    this: AgentSessionRuntime,
    callback: BeforeInvalidate,
  ) {
    if (this !== runtime || !owner)
      return Reflect.apply(originals.setBeforeSessionInvalidate, this, [
        callback,
      ]);
    const previous = callerBefore;
    callerBefore = callback;
    try {
      return Reflect.apply(originals.setBeforeSessionInvalidate, this, [
        before,
      ]);
    } catch (error) {
      callerBefore = previous;
      throw error;
    }
  };
  for (const [name, method, callback] of [
    ["setRebindSession", setRebind, () => callerRebind],
    ["setBeforeSessionInvalidate", setBefore, () => callerBefore],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(runtime, name);
    Object.defineProperty(runtime, name, {
      configurable: true,
      writable: true,
      enumerable: descriptor?.enumerable ?? false,
      value: method,
    });
    restore.push(() => {
      const current = Object.getOwnPropertyDescriptor(runtime, name);
      if (current?.value !== method) return;
      try {
        Reflect.apply(originals[name], runtime, [callback()]);
      } catch {
        // Frozen SDK state can retain a detached composite that only calls its caller.
      }
      if (current.configurable) {
        if (descriptor) Object.defineProperty(runtime, name, descriptor);
        else Reflect.deleteProperty(runtime, name);
      } else if (current.writable) {
        Object.defineProperty(runtime, name, { value: originals[name] });
      }
    });
  }
  Reflect.apply(originals.setRebindSession, runtime, [rebind]);
  Reflect.apply(originals.setBeforeSessionInvalidate, runtime, [before]);
  return () => {
    if (!owner) return;
    owner = undefined;
    for (const operation of restore) operation();
  };
}
