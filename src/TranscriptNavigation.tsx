import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { MessageSquare } from "lucide-react";
import { t, useLocale } from "./i18n";
import { transcriptTurnPreview, type TranscriptTurn } from "./transcript-turns";

const hoverWidths = [24, 18, 12, 9];

export function TranscriptNavigation({
  turns,
  scroller,
  onNavigate,
}: {
  turns: TranscriptTurn[];
  scroller: RefObject<HTMLDivElement | null>;
  onNavigate: (id: string) => void;
}) {
  useLocale();
  const entries = useMemo(() => turns.map(transcriptTurnPreview), [turns]);
  const list = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [activeId, setActiveId] = useState<string>();
  const [focusedId, setFocusedId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const [previewId, setPreviewId] = useState<string>();
  const [promptClipped, setPromptClipped] = useState(false);
  const preview = entries.find((entry) => entry.id === previewId);
  const hoveredIndex = entries.findIndex((entry) => entry.id === hoveredId);
  const popupId = useId();
  const buttons = () => [
    ...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ];
  const keepOpen = () => clearTimeout(closeTimer.current);
  const close = () => {
    keepOpen();
    closeTimer.current = setTimeout(() => setPreviewId(undefined), 120);
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let frame = 0;
    let positions: { id: string; top: number }[] = [];
    const update = () => {
      const atBottom =
        element.scrollHeight - element.clientHeight - element.scrollTop < 2;
      const readingTop =
        element.scrollTop + Math.min(64, element.clientHeight / 4);
      const current = atBottom
        ? positions.at(-1)
        : (positions.filter((position) => position.top <= readingTop).at(-1) ??
          positions[0]);
      setActiveId(current?.id);
      const rail = list.current;
      const button = buttons().find(
        (button) => button.dataset.turnId === current?.id,
      );
      if (rail && button && !rail.matches(":hover, :focus-within")) {
        if (button.offsetTop < rail.scrollTop)
          rail.scrollTop = button.offsetTop;
        else if (
          button.offsetTop + button.offsetHeight >
          rail.scrollTop + rail.clientHeight
        )
          rail.scrollTop =
            button.offsetTop + button.offsetHeight - rail.clientHeight;
      }
    };
    const measure = () => {
      const top = element.getBoundingClientRect().top;
      positions = [
        ...element.querySelectorAll<HTMLElement>("[data-turn-id]"),
      ].map((turn) => ({
        id: turn.dataset.turnId!,
        top: turn.getBoundingClientRect().top - top + element.scrollTop,
      }));
      update();
    };
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element
      .querySelectorAll("[data-turn-id]")
      .forEach((turn) => observer.observe(turn));
    element.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, [scroller, turns]);

  useLayoutEffect(() => {
    if (!preview || !popup.current) return;
    const position = () => {
      const anchor = buttons().find(
        (button) => button.dataset.turnId === preview.id,
      );
      const card = popup.current;
      if (!anchor || !card) return;
      const heading = card.querySelector<HTMLElement>("strong");
      setPromptClipped(!!heading && heading.scrollWidth > heading.clientWidth);
      const rect = anchor.getBoundingClientRect();
      card.style.left = `${Math.max(12, Math.min(rect.right + 12, window.innerWidth - card.offsetWidth - 12))}px`;
      card.style.top = `${Math.max(12, Math.min(rect.top + rect.height / 2 - card.offsetHeight / 2, window.innerHeight - card.offsetHeight - 12))}px`;
    };
    const observer = new ResizeObserver(position);
    observer.observe(popup.current);
    position();
    window.addEventListener("resize", position);
    list.current?.addEventListener("scroll", position, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      list.current?.removeEventListener("scroll", position);
    };
  }, [preview]);

  const dismiss = () => {
    keepOpen();
    setPreviewId(undefined);
  };
  return (
    <>
      <nav
        className="transcript-navigation"
        aria-label={t("会话消息导航")}
        onMouseLeave={() => {
          setHoveredId(undefined);
          close();
        }}
        onMouseEnter={keepOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            dismiss();
          }
        }}
      >
        <div className="transcript-navigation-list" ref={list}>
          {entries.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              data-turn-id={entry.id}
              className="transcript-navigation-tick"
              aria-label={t("第 {value1} 轮：{value2}", {
                value1: index + 1,
                value2:
                  entry.prompt || (entry.images ? t("消息附件") : t("Pi 回复")),
              })}
              aria-current={activeId === entry.id ? "location" : undefined}
              aria-describedby={previewId === entry.id ? popupId : undefined}
              tabIndex={
                (focusedId ?? activeId ?? entries[0]?.id) === entry.id ? 0 : -1
              }
              onMouseEnter={() => {
                keepOpen();
                setHoveredId(entry.id);
                setPreviewId(entry.id);
              }}
              onMouseLeave={() => setHoveredId(undefined)}
              onFocus={() => {
                keepOpen();
                setFocusedId(entry.id);
                setPreviewId(entry.id);
              }}
              onBlur={(event) => {
                if (!list.current?.contains(event.relatedTarget))
                  setFocusedId(undefined);
                if (!popup.current?.contains(event.relatedTarget)) close();
              }}
              onClick={() => onNavigate(entry.id)}
              onKeyDown={(event) => {
                const items = buttons();
                const next =
                  event.key === "ArrowDown"
                    ? Math.min(index + 1, items.length - 1)
                    : event.key === "ArrowUp"
                      ? Math.max(0, index - 1)
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? items.length - 1
                          : undefined;
                if (next !== undefined) {
                  event.preventDefault();
                  items[next]?.focus();
                }
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: `${hoveredIndex < 0 ? 6 : (hoverWidths[Math.abs(index - hoveredIndex)] ?? 6)}px`,
                }}
              />
            </button>
          ))}
        </div>
      </nav>
      {preview &&
        createPortal(
          <aside
            ref={popup}
            id={popupId}
            className="transcript-preview"
            role="region"
            aria-label={t("消息预览")}
            onMouseEnter={keepOpen}
            onMouseLeave={close}
            onFocus={keepOpen}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) close();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                buttons()
                  .find((button) => button.dataset.turnId === preview.id)
                  ?.focus();
                dismiss();
              }
            }}
          >
            <div className="transcript-preview-heading">
              <strong>
                {preview.prompt ||
                  (preview.images ? t("消息附件") : t("Pi 回复"))}
              </strong>
              <MessageSquare size={13} aria-hidden="true" />
            </div>
            <div className="transcript-preview-body" tabIndex={0}>
              {(promptClipped || preview.prompt.includes("\n")) && (
                <p className="transcript-preview-prompt">{preview.prompt}</p>
              )}
              {preview.images > 0 && (
                <p>{t("{value1} 张图片", { value1: preview.images })}</p>
              )}
              <p>{preview.reply || t("暂无文字回复")}</p>
              {preview.replyImages > 0 && (
                <p>{t("{value1} 张图片", { value1: preview.replyImages })}</p>
              )}
            </div>
          </aside>,
          document.body,
        )}
    </>
  );
}
