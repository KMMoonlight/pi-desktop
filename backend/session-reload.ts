import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** Attach desktop lifecycle to this hosted instance, leaving SDK prototypes and exports intact. */
export function bindSessionReload(
  session: AgentSession,
  lifecycle: {
    current(): boolean;
    beforeSessionStart(): Promise<void>;
    afterReload(): Promise<void>;
  },
): () => void {
  const original = session.reload;
  const descriptor = Object.getOwnPropertyDescriptor(session, "reload");
  let active = true;
  let generation = 0;
  const reload: AgentSession["reload"] = async function (
    this: AgentSession,
    options,
  ) {
    if (this !== session || !active || !lifecycle.current())
      return original.call(this, options);
    const request = ++generation;
    const current = () =>
      active && request === generation && lifecycle.current();
    const requireCurrent = () => {
      if (!current())
        throw new DOMException("重载已被后续操作取消", "AbortError");
    };
    await original.call(this, {
      ...options,
      beforeSessionStart: async () => {
        requireCurrent();
        await lifecycle.beforeSessionStart();
        requireCurrent();
        await options?.beforeSessionStart?.();
        requireCurrent();
      },
    });
    if (current()) await lifecycle.afterReload();
  };
  Object.defineProperty(session, "reload", {
    configurable: true,
    writable: true,
    enumerable: descriptor?.enumerable ?? false,
    value: reload,
  });
  return () => {
    active = false;
    // A custom runtime may replace the method later; never overwrite that replacement.
    if (Object.getOwnPropertyDescriptor(session, "reload")?.value !== reload)
      return;
    if (descriptor) Object.defineProperty(session, "reload", descriptor);
    else Reflect.deleteProperty(session, "reload");
  };
}
