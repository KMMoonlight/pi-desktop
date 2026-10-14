import { randomUUID } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type Message = Parameters<AgentSession["agent"]["steer"]>[0];
const identifiers = new WeakMap<object, string>();

// Pi 1.2.0 has no public operation to move a single queued message. Keep the
// version-specific access here, validate it before writing, and move the actual
// message so images, timestamps and input-hook transformations remain intact.
function queues(session: AgentSession) {
  const queue = Reflect.get(session.agent, "followUpQueue");
  const messages: unknown = queue && Reflect.get(queue, "messages");
  const followUp: unknown = Reflect.get(session, "_followUpMessages");
  const steering: unknown = Reflect.get(session, "_steeringMessages");
  const emit: unknown = Reflect.get(session, "_emitQueueUpdate");
  if (!Array.isArray(messages) || !Array.isArray(followUp) || !Array.isArray(steering) || typeof emit !== "function") return;
  return { messages: messages as Message[], followUp: followUp as string[], steering: steering as string[], emit };
}

function messageText(message: Message) {
  return message.role === "user" && Array.isArray(message.content)
    ? message.content.filter(block => block.type === "text").map(block => block.text).join("")
    : undefined;
}

function pendingRows(session: AgentSession) {
  const state = queues(session);
  if (!state) return;
  const used = new Set<Message>();
  const rows = state.followUp.map(text => {
    const message = state.messages.find(message => !used.has(message) && messageText(message) === text);
    if (!message) return undefined; // Already taken by the agent loop.
    used.add(message);
    let id = identifiers.get(message);
    if (!id) { id = randomUUID(); identifiers.set(message, id); }
    return { id, message };
  });
  return { ...state, rows };
}

export function followUpMessageIds(session: AgentSession): (string | null)[] {
  return pendingRows(session)?.rows.map(row => row?.id ?? null) ?? [];
}

export function promoteFollowUp(session: AgentSession, id: string): boolean {
  const state = pendingRows(session);
  if (!state) throw new Error("当前 SDK 不支持调整排队消息");
  const index = state.rows.findIndex(row => row?.id === id);
  if (index < 0) return false; // A stale click or retry must not send it again.
  const message = state.rows[index]!.message;
  // No await between removal and insertion: the agent cannot drain half a move.
  state.messages.splice(state.messages.indexOf(message), 1);
  state.steering.push(state.followUp.splice(index, 1)[0]);
  session.agent.steer(message);
  state.emit.call(session);
  return true;
}
