import { createHash } from "node:crypto";
const states = new WeakMap();
export function usage({
  input = 0,
  output = 0,
  cacheRead = 0,
  cacheWrite = 0,
  cost = 0,
} = {}) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}
export function assistant({
  text = "Conversation notice response",
  tokens = 60000,
  cost = 1.2,
  timestamp = Date.now(),
  dropped = 0,
  model = "desktop-test",
  stopReason = "stop",
  write = false,
} = {}) {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "desktop-test",
    model,
    stopReason,
    timestamp,
    content: [{ type: "text", text }],
    usage: usage(
      write ? { cacheWrite: tokens, cost } : { input: tokens, output: 3, cost },
    ),
    ...(dropped
      ? {
          diagnostics: [
            {
              type: "anthropic_input_transformations",
              details: {
                transformations: Array.from({ length: dropped }, () => ({
                  type: "thinking_dropped",
                })),
              },
            },
          ],
        }
      : {}),
  };
}
export function synchronize(session) {
  session.agent.state.messages =
    session.sessionManager.buildSessionProjection().messages;
}
export async function complete(session, message) {
  session.agent.state.messages.push(message);
  await session._handleAgentEvent({ type: "message_start", message });
  await session._handleAgentEvent({ type: "message_end", message });
}
export default async function (
  { host, session, desktop },
  { action = "inspect", mode = "cache" } = {},
) {
  const scope = desktop.terminalRuntime.capture(),
    application = scope.application;
  let state = states.get(host);
  if (action === "seed") {
    session.settingsManager.setShowCacheMissNotices(true);
    host.snapshot();
    state = {
      notices: application.conversationNotices,
      tui: scope.tui,
      application,
      mode,
    };
    states.set(host, state);
    const manager = session.sessionManager;
    if (mode === "cache") {
      manager.appendUsage(
        "cache_warm",
        "desktop-test",
        "desktop-test",
        usage({ cacheWrite: 60000, cost: 0.02 }),
        "leading warm",
      );
      const previous = assistant({
        text: "Previous cached response",
        cost: 0.02,
        timestamp: Date.now() - 400000,
      });
      previous.usage = usage({ cacheRead: 60000, cost: 0.02 });
      manager.appendMessage(previous);
      const warm = manager.appendUsage(
        "cache_warm",
        "desktop-test",
        "desktop-test",
        usage({ cacheRead: 60000, cost: 0.02 }),
        "mid-session warm",
      );
      session._emit({ type: "entry_appended", entry: warm });
      synchronize(session);
      await complete(
        session,
        assistant({
          dropped: 2,
          timestamp: Date.parse(warm.timestamp) + 360000,
        }),
      );
    } else {
      const first = manager.appendMessage({
        role: "user",
        content: "Retained summary message",
        timestamp: Date.now() - 1000,
      });
      const previous = assistant({
        text: "Retained summary response",
        write: true,
        cost: 0.05,
      });
      manager.appendMessage(previous);
      if (mode === "compaction") {
        const id = manager.appendCompaction(
          "Conversation compaction summary",
          first,
          65000,
          undefined,
          false,
          usage({ input: 45000, output: 200, cost: 0.27 }),
        );
        synchronize(session);
        session._emit({ type: "entry_appended", entry: manager.getEntry(id) });
      } else {
        manager.branchWithSummary(
          first,
          "Conversation branch summary",
          undefined,
          false,
          usage({ input: 30000, output: 100, cost: 0.19 }),
        );
        synchronize(session);
      }
    }
  }
  if (!state) throw new Error("Conversation notice probe is not seeded");
  if (action === "hide") session.settingsManager.setShowCacheMissNotices(false);
  if (action === "show") session.settingsManager.setShowCacheMissNotices(true);
  if (action === "mutation") {
    const snapshot = host.snapshot();
    const notice = snapshot.conversationNotices.at(-1);
    const component = state.notices
      .entries(notice.afterMessageId)
      .at(-1).component;
    component.setText("Direct native billing notice mutation");
    state.mutated = component;
  }
  const snapshot = host.snapshot();
  const components = snapshot.conversationNotices.flatMap((notice) =>
    state.notices.entries(notice.afterMessageId),
  );
  const unique = [...new Set(components.map((entry) => entry.component))];
  state.first ??= unique;
  return {
    notices: snapshot.conversationNotices,
    same:
      unique.length === state.first.length &&
      unique.every((value, index) => value === state.first[index]),
    nativeClasses: unique.map((component) => component.constructor.name),
    mutationSame: !state.mutated || unique.includes(state.mutated),
    treeShared:
      state.application === scope.application && state.tui === scope.tui,
    sdkHash: createHash("sha256")
      .update(JSON.stringify(session.sessionManager.getEntries()))
      .digest("hex"),
    messages: snapshot.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content.map((block) => block.text ?? "").join(""),
    })),
    sessionFile: snapshot.sessionFile,
  };
}
