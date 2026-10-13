import { useCallback, useEffect, useRef, useState } from "react";
import { action } from "./client";
import { t } from "./i18n";
import type { DesktopSnapshot, SessionItem } from "../shared/types";

type Selection = {
  session: SessionItem;
  status: "loading" | "ready" | "error";
  error?: string;
};

/** Present navigation immediately, but serialize backend selection and keep only
 * the latest queued destination. An older load must never replace that page. */
export function useSessionNavigation(snapshot?: DesktopSnapshot) {
  const [selection, setSelection] = useState<Selection>();
  const wanted = useRef<Selection | undefined>(undefined);
  const queued = useRef<Selection | undefined>(undefined);
  const draining = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    wanted.current = undefined;
    queued.current = undefined;
    draining.current = false;
    setSelection(undefined);
    return () => {
      epoch.current++;
    };
  }, [snapshot?.backendId]);

  const select = useCallback((session: SessionItem) => {
    const request: Selection = { session, status: "loading" };
    wanted.current = request;
    queued.current = request;
    setSelection(request);
    if (draining.current) return;
    draining.current = true;
    const generation = epoch.current;
    void (async () => {
      try {
        while (queued.current && epoch.current === generation) {
          const next = queued.current;
          queued.current = undefined;
          try {
            const result = await action<{
              cwd: string;
              selectedSessionId: string;
            }>("session.switch", {
              path: next.session.path,
              cwd: next.session.cwd,
              selectionOnly: true,
            });
            if (epoch.current !== generation) return;
            if (wanted.current !== next) continue;
            if (result.selectedSessionId !== next.session.id)
              throw new Error(t("未能切换到所选会话"));
            try {
              localStorage.setItem("pi.workspace.userSelection", result.cwd);
            } catch {}
            const ready: Selection = { ...next, status: "ready" };
            wanted.current = ready;
            setSelection(ready);
          } catch (error) {
            if (epoch.current !== generation) return;
            if (wanted.current !== next) continue;
            const failed: Selection = {
              ...next,
              status: "error",
              error: error instanceof Error ? error.message : String(error),
            };
            wanted.current = failed;
            setSelection(failed);
          }
        }
      } finally {
        if (epoch.current === generation) draining.current = false;
      }
    })();
  }, []);

  useEffect(() => {
    if (
      selection?.status === "ready" &&
      snapshot?.sessionId === selection.session.id &&
      !snapshot.changing
    ) {
      if (wanted.current === selection) wanted.current = undefined;
      setSelection((current) => (current === selection ? undefined : current));
    }
  }, [selection, snapshot?.sessionId, snapshot?.changing]);
  return { selection, select };
}
