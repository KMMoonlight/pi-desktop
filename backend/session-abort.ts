import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** Observe the public cancellation boundary without replacing its native result. */
export function bindSessionAbort(
  session: AgentSession,
  beforeAbort: () => void,
): () => void {
  const original = session.abort;
  const descriptor = Object.getOwnPropertyDescriptor(session, "abort");
  let active = true;
  const abort: AgentSession["abort"] = function (this: AgentSession, ...args) {
    if (this === session && active) beforeAbort();
    return Reflect.apply(original, this, args);
  };
  Object.defineProperty(session, "abort", {
    configurable: true,
    writable: true,
    enumerable: descriptor?.enumerable ?? false,
    value: abort,
  });
  return () => {
    active = false;
    if (Object.getOwnPropertyDescriptor(session, "abort")?.value !== abort)
      return;
    if (descriptor) Object.defineProperty(session, "abort", descriptor);
    else Reflect.deleteProperty(session, "abort");
  };
}
