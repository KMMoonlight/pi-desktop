import { useEffect, useRef, useState } from "react";
import { desktopKeyId } from "../shared/keyboard";
import type { DesktopEvent } from "../shared/types";
import type { Run } from "./Workspace";

type AuthLink = Extract<DesktopEvent, { type: "auth_url" }>;
export function useAuthCopy(link: AuthLink | undefined, run: Run) {
  const current = useRef({ link, run });
  current.current = { link, run };
  const [feedback, setFeedback] = useState<{
    link: AuthLink;
    message?: string;
    copied?: boolean;
  }>();
  const copy = async (event?: KeyboardEvent) => {
    const { link, run } = current.current;
    if (!link || link.copyKeys === undefined) return;
    const result = await run<{ copied: boolean }>(
      "auth.copy",
      {
        id: link.id,
        ...(event
          ? {
              event: {
                key: event.key,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                metaKey: event.metaKey,
              },
            }
          : {}),
      },
      (message) => {
        if (current.current.link === link) setFeedback({ link, message });
      },
    );
    if (result?.copied && current.current.link === link)
      setFeedback({ link, copied: true });
  };
  const copyRef = useRef(copy);
  copyRef.current = copy;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        !current.current.link?.copyKeys?.includes(desktopKeyId(event))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "keydown" && !event.repeat)
        void copyRef.current(event);
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
    };
  }, []);
  return { copy, feedback: feedback?.link === link ? feedback : undefined };
}
