import { useEffect, useRef, useState } from "react";
import type { DesktopSnapshot } from "../shared/types";

const storageKey = "pi.unreadCompletedSessions";

export function useSessionActivity(
  snapshot: DesktopSnapshot | undefined,
  viewingChat: boolean,
) {
  const [unread, setUnread] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? "[]",
      );
      return Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  const previous = useRef<
    { backend: string; id: string; running: boolean } | undefined
  >(undefined);
  const id = snapshot?.sessionId;
  const running = snapshot?.running ?? false;
  useEffect(() => {
    if (!snapshot) return;
    const last = previous.current;
    previous.current = {
      backend: snapshot.backendId,
      id: snapshot.sessionId,
      running,
    };
    if (running) {
      setUnread((ids) =>
        ids.includes(snapshot.sessionId)
          ? ids.filter((value) => value !== snapshot.sessionId)
          : ids,
      );
    } else if (
      last?.backend === snapshot.backendId &&
      last.id === snapshot.sessionId &&
      last.running
    ) {
      setUnread((ids) =>
        ids.includes(snapshot.sessionId) ? ids : [...ids, snapshot.sessionId],
      );
    }
  }, [snapshot?.backendId, id, running]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(unread));
    } catch {
      /* The indicator still works for this window. */
    }
  }, [unread]);
  useEffect(() => {
    if (!id || running || !viewingChat || !unread.includes(id)) return;
    const transcript = document.querySelector<HTMLElement>(".transcript");
    if (!transcript) return;
    const viewed = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus())
        return;
      if (
        transcript.scrollHeight -
          transcript.clientHeight -
          transcript.scrollTop >
        24
      )
        return;
      setUnread((ids) =>
        ids.includes(id) ? ids.filter((value) => value !== id) : ids,
      );
    };
    const frame = requestAnimationFrame(viewed);
    transcript.addEventListener("scroll", viewed, { passive: true });
    window.addEventListener("focus", viewed);
    document.addEventListener("visibilitychange", viewed);
    return () => {
      cancelAnimationFrame(frame);
      transcript.removeEventListener("scroll", viewed);
      window.removeEventListener("focus", viewed);
      document.removeEventListener("visibilitychange", viewed);
    };
  }, [id, running, viewingChat, unread]);
  return unread;
}
