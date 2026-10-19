import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronDown } from "lucide-react";
import { NoticeCard, type Notice } from "./NoticeCard";
import { t, useLocale } from "./i18n";

const NOTICE_DURATION = 8000;

export function NoticeStack({
  notices,
  onDismiss,
}: {
  notices: Notice[];
  onDismiss: (id: string) => void;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const itemsId = useId();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reading, setReading] = useState<Set<string>>(() => new Set());
  const lifetimes = useRef(
    new Map<string, { notice: Notice; remaining: number }>(),
  );
  const ordered = [...notices].reverse();
  const expanded = open && notices.length > 1;
  const depth = expanded ? 0 : Math.min(2, notices.length - 1);
  const paused =
    hovered ||
    Boolean(focused && root.current?.contains(document.activeElement)) ||
    expanded ||
    ordered.some(
      (notice, index) => (expanded || index === 0) && reading.has(notice.id),
    );
  const onReadingChange = useCallback((id: string, value: boolean) => {
    setReading((previous) => {
      if (previous.has(id) === value) return previous;
      const next = new Set(previous);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (notices.length < 2) setOpen(false);
  }, [notices.length]);

  useEffect(() => {
    const active = new Set(notices.map((notice) => notice.id));
    for (const id of lifetimes.current.keys())
      if (!active.has(id)) lifetimes.current.delete(id);
    for (const notice of notices) {
      if (lifetimes.current.get(notice.id)?.notice !== notice)
        lifetimes.current.set(notice.id, {
          notice,
          remaining: NOTICE_DURATION,
        });
    }
    if (paused) return;
    const started = Date.now();
    const entries = [...lifetimes.current.entries()];
    const timers = entries.map(([id, lifetime]) =>
      setTimeout(() => onDismiss(id), lifetime.remaining),
    );
    return () => {
      timers.forEach(clearTimeout);
      const elapsed = Date.now() - started;
      for (const [, lifetime] of entries)
        lifetime.remaining = Math.max(0, lifetime.remaining - elapsed);
    };
  }, [notices, onDismiss, paused]);

  return (
    <div
      ref={root}
      className={`notice-list notice-stack ${expanded ? "is-expanded" : ""}`}
      aria-label={t("通知")}
      style={{ "--notice-depth": depth } as CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <div className="notice-stack-cards">
        {depth > 1 && (
          <div
            className="notice-stack-back notice-stack-back-second"
            aria-hidden="true"
          />
        )}
        {depth > 0 && (
          <div
            className="notice-stack-back notice-stack-back-first"
            aria-hidden="true"
          />
        )}
        <div id={itemsId} className="notice-stack-items">
          {ordered.map((notice, index) => (
            <div
              key={notice.id}
              className="notice-layer"
              hidden={!expanded && index > 0}
            >
              <NoticeCard
                notice={notice}
                onDismiss={() => onDismiss(notice.id)}
                onReadingChange={onReadingChange}
              />
            </div>
          ))}
        </div>
      </div>
      {notices.length > 1 && (
        <div className="notice-stack-toolbar">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={itemsId}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown
              size={13}
              className={expanded ? "is-expanded" : undefined}
              aria-hidden="true"
            />
            {expanded ? t("收起通知") : t("展开通知")}
          </button>
        </div>
      )}
    </div>
  );
}
