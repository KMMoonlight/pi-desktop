import type { DesktopEvent } from "./types";

type NoticePayload = Omit<Extract<DesktopEvent, { type: "notice" }>, "type">;

export function httpNoticeError(message: string):
  | {
      status: number;
      body?: Record<string, unknown>;
    }
  | undefined {
  const text = message.trim();
  const prefix = text.match(/^(?:HTTP\s+)?([45]\d{2})(?=$|[\s:([{])/i);
  let status = prefix ? Number(prefix[1]) : undefined;
  const json = prefix
    ? text.slice(prefix[0].length).replace(/^[\s:]+/, "")
    : text;
  let body: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
      const value = Number(body.status);
      if (!status && Number.isInteger(value) && value >= 400 && value <= 599)
        status = value;
    }
  } catch {
    /* Plain text and malformed bodies retain their exact identity. */
  }
  return status ? { status, body } : undefined;
}

export function enqueueNotice<T extends NoticePayload>(
  previous: T[],
  incoming: T,
  limit: number,
): T[] {
  const index = incoming.retry
    ? previous.findIndex((notice) => notice.retry)
    : -1;
  if (index < 0) return [...previous, incoming].slice(-limit);
  return previous.map((notice, i) => (i === index ? incoming : notice));
}
