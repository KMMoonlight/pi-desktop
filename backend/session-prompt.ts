import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** Scope this hosted instance's prompt work without changing SDK exports or prototypes. */
export function bindSessionPrompt(
  session: AgentSession,
  run: (operation: () => Promise<void>) => Promise<void>,
): () => void {
  const original = session.prompt;
  const descriptor = Object.getOwnPropertyDescriptor(session, "prompt");
  let active = true;
  const prompt: AgentSession["prompt"] = function (
    this: AgentSession,
    ...args
  ) {
    return this === session && active
      ? run(() => original.apply(this, args))
      : original.apply(this, args);
  };
  Object.defineProperty(session, "prompt", {
    configurable: true,
    writable: true,
    enumerable: descriptor?.enumerable ?? false,
    value: prompt,
  });
  return () => {
    active = false;
    if (Object.getOwnPropertyDescriptor(session, "prompt")?.value !== prompt)
      return;
    if (descriptor) Object.defineProperty(session, "prompt", descriptor);
    else Reflect.deleteProperty(session, "prompt");
  };
}
