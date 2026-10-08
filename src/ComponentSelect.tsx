import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { CompletionMenu } from "./CompletionMenu";
import type { DesktopNode, DesktopTextRun } from "../shared/desktop-ui";
import { StyledText } from "./StyledText";

export function needsRichText(runs?: DesktopTextRun[]) {
  return (
    !!runs &&
    (runs.length > 1 ||
      runs.some(
        (run) =>
          run.href ||
          run.blink ||
          run.style?.textDecorationStyle ||
          run.style?.textDecorationColor ||
          run.style?.textDecorationLine?.includes("overline"),
      ))
  );
}

function revealSelection(list: HTMLDivElement) {
  const option = list.querySelector<HTMLElement>(
    '[role="option"][aria-selected="true"]',
  );
  if (!option) return;
  if (list.contains(document.activeElement))
    option.focus({ preventScroll: true });
  const bounds = list.getBoundingClientRect();
  const item = option.getBoundingClientRect();
  const top = bounds.top + list.clientTop;
  const bottom = top + list.clientHeight;
  if (item.top < top) list.scrollTop += item.top - top;
  else if (item.bottom > bottom) list.scrollTop += item.bottom - bottom;
}

export function ComponentSelect({
  node,
  label,
  onChange,
}: {
  node: Extract<DesktopNode, { kind: "select" }>;
  label: React.ReactNode;
  onChange: (value: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const captionId = useId();
  const ownerId = useId();
  const choicesId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 320,
  });
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const update = () => {
      const box = trigger.current!.getBoundingClientRect();
      const below = innerHeight - box.bottom - 16;
      const height = Math.min(320, Math.max(below, box.top - 16));
      setPosition({
        left: Math.max(12, Math.min(box.left, innerWidth - box.width - 12)),
        top:
          below >= height ? box.bottom + 4 : Math.max(12, box.top - height - 4),
        width: box.width,
        maxHeight: height,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !choices.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const selected = node.options.find((option) => option.value === node.value);
  const mountChoices = useCallback((list: HTMLDivElement | null) => {
    choices.current = list;
    if (list) revealSelection(list);
  }, []);
  useLayoutEffect(() => {
    if (choices.current) revealSelection(choices.current);
  }, [node.value]);
  if (node.appearance === "completion")
    return (
      <CompletionMenu
        options={node.options}
        selected={node.value}
        label={node.label}
        disabled={node.disabled}
        visibleOptions={node.visibleOptions}
        listRef={mountChoices}
        onSelect={onChange}
      />
    );
  const items = node.options.map((option) => (
    <button
      type="button"
      key={option.value}
      className="desktop-rich-option block w-full rounded-md px-3 py-2 text-left text-sm aria-selected:bg-card"
      disabled={node.disabled}
      {...{
        role: "option",
        "aria-label": option.label,
        "aria-selected": option.value === node.value,
        "data-desktop-action": node.action,
        "data-desktop-owner": ownerId,
        "data-desktop-mouse-kind": "select",
        tabIndex: -1,
        value: option.value,
        style: { color: "inherit", fontWeight: "inherit" },
      }}
      onClick={(event) => {
        if (event.defaultPrevented) return;
        onChange(option.value);
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <StyledText text={option.label} runs={option.runs} />
    </button>
  ));
  const list = (
    <div
      ref={mountChoices}
      id={choicesId}
      role="listbox"
      aria-label={node.label}
      aria-disabled={node.disabled}
      data-desktop-action={node.action}
      data-desktop-owner={ownerId}
      tabIndex={node.disabled ? -1 : 0}
      className="desktop-rich-listbox"
      style={{
        maxHeight: `calc(${node.visibleOptions ?? 8} * 40px)`,
        color: "var(--text)",
        fontWeight: "normal",
      }}
    >
      {items}
    </div>
  );
  return (
    <div ref={root} id={ownerId} className="field desktop-rich-select">
      <span id={captionId}>{label}</span>
      {node.visibleOptions ? (
        list
      ) : (
        <>
          <button
            ref={trigger}
            type="button"
            role="combobox"
            aria-labelledby={captionId}
            aria-haspopup="listbox"
            aria-controls={choicesId}
            aria-expanded={open}
            disabled={node.disabled || !node.options.length}
            data-desktop-action={node.action}
            data-desktop-mouse-kind="select"
            value={node.value}
            className="desktop-rich-select-trigger appearance-none flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-3 text-left"
            onClick={(event) => {
              if (!event.defaultPrevented) setOpen((value) => !value);
            }}
          >
            <span
              data-selected-value={node.value}
              onClick={(event) => {
                if (event.defaultPrevented) event.stopPropagation();
              }}
            >
              <StyledText text={selected?.label ?? ""} runs={selected?.runs} />
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {open &&
            createPortal(
              <div
                className="fixed z-[10010] overflow-auto rounded-xl border border-line bg-canvas p-1 shadow-sm"
                style={position}
              >
                {list}
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}
