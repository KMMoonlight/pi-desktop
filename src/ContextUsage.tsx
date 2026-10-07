import { t, useLocale } from "./i18n";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DesktopSnapshot } from "../shared/types";
import { money, number } from "./ui";

export function ContextUsage({ snapshot, inspect }: { snapshot: DesktopSnapshot; inspect: () => void }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const usage = snapshot.stats.contextUsage;
  const percent = usage?.percent;
  const fill = Math.min(100, Math.max(0, percent ?? 0));
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const box = trigger.current!.getBoundingClientRect();
      const width = Math.min(264, innerWidth - 24);
      const height = popup.current?.getBoundingClientRect().height ?? 240;
      setPosition({
        left: Math.max(12, Math.min(box.left, innerWidth - width - 12)),
        top: box.top > height + 18 ? box.top - height - 6 : Math.min(box.bottom + 6, innerHeight - height - 12),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        setOpen(false); trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => setOpen(false), [snapshot.sessionId]);
  return <>
    <button ref={trigger} className="composer-context" aria-label={t("查看上下文与用量")} data-desktop-native-input
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      title={t("上下文 {value1} / {value2}", { value1: number(usage?.tokens ?? undefined), value2: number(snapshot.model?.contextWindow) })}
      onClick={() => setOpen(!open)}>
      <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" opacity=".2" />
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2"
          pathLength="100" strokeDasharray={`${fill} 100`} transform="rotate(-90 10 10)" />
      </svg>
      {percent != null ? `${Math.round(percent)}%` : "—"}
    </button>
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-label={t("上下文与用量")}
      className="context-usage-popup" style={position} data-desktop-native-input>
      <strong>{t("上下文与用量")}</strong>
      <p><b>{percent == null ? "—" : `${Math.round(percent)}%`}</b> {t("上下文已使用")}</p>
      <dl>
        <div><dt>{t("上下文")}</dt><dd>{number(usage?.tokens ?? undefined)} / {number(snapshot.model?.contextWindow)}</dd></div>
        <div><dt>{t("累计 token")}</dt><dd>{number(snapshot.stats.tokens.total)}</dd></div>
        <div><dt>{t("累计费用")}</dt><dd>{money(snapshot.stats.cost)}</dd></div>
      </dl>
      <button onClick={() => { setOpen(false); inspect(); }}>{t("打开完整检查器")}</button>
    </div>, document.body)}
  </>;
}
