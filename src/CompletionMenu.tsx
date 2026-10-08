import { useLayoutEffect, useRef, type RefCallback } from "react";
import { Blocks, CornerDownLeft, Terminal } from "lucide-react";
import { t, useLocale } from "./i18n";

type CompletionChoice = { value: string; label: string; description?: string };

/** Shared presentation; the SDK or extension still owns completion behavior. */
export function CompletionMenu({
  options,
  selected,
  label,
  disabled,
  visibleOptions = 5,
  listRef,
  onSelect,
}: {
  options: CompletionChoice[];
  selected: string;
  label: string;
  disabled?: boolean;
  visibleOptions?: number;
  listRef?: RefCallback<HTMLDivElement>;
  onSelect: (value: string) => void;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = root.current!;
    const anchor = menu.closest(
      ".desktop-text-control, .desktop-extension-editor",
    );
    if (!anchor || !menu.closest(".composer")) return;
    const measure = () => {
      const chrome =
        menu.firstElementChild!.getBoundingClientRect().height +
        menu.lastElementChild!.getBoundingClientRect().height;
      let top = 0;
      for (
        let ancestor = anchor.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        if (getComputedStyle(ancestor).overflowY !== "visible")
          top = Math.max(top, ancestor.getBoundingClientRect().top);
      }
      const space = Math.max(
        48,
        anchor.getBoundingClientRect().top - top - chrome - 20,
      );
      menu.style.setProperty("--completion-space", `${space}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    const region = anchor.closest(".composer-region");
    if (region) observer.observe(region);
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [options]);
  useLayoutEffect(() => {
    const list = root.current?.querySelector(".desktop-completion");
    const option = list?.querySelector('[aria-selected="true"]');
    if (!list || !option) return;
    const bounds = list.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom)
      list.scrollTop += item.bottom - bounds.bottom;
  }, [selected]);
  return (
    <div ref={root} className="desktop-completion-popover">
      <div className="completion-heading">
        <span>{t("补全建议")}</span>
        <span>{options.length}</span>
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        className="desktop-completion"
        style={{
          maxHeight: `min(${visibleOptions} * 58px, 36dvh, var(--completion-space, 36dvh))`,
        }}
      >
        {options.map((option, index) => {
          const skill = option.label.replace(/^\//, "").startsWith("skill:");
          return (
            <button
              key={`${option.value}-${index}`}
              type="button"
              role="option"
              aria-label={option.label}
              aria-selected={option.value === selected}
              disabled={disabled}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(option.value)}
            >
              <span className="completion-icon" aria-hidden="true">
                {skill ? <Blocks size={16} /> : <Terminal size={16} />}
              </span>
              <span className="completion-copy">
                <span className="completion-name">
                  <strong>{option.label.replace(/^\/?skill:/, "")}</strong>
                  {skill && <small>Skill</small>}
                </span>
                {option.description && (
                  <span className="completion-description">
                    {option.description}
                  </span>
                )}
              </span>
              <CornerDownLeft size={14} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="completion-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {t("选择")}
        </span>
        <span>
          <kbd>↵</kbd> {t("确认")}
        </span>
        <span>
          <kbd>esc</kbd> {t("取消")}
        </span>
      </div>
    </div>
  );
}
