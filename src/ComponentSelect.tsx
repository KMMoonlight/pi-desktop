import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { DropdownMenu, MenuItem } from "reshaped";
import { ChevronDown, CornerDownLeft } from "lucide-react";
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
      <div
        ref={mountChoices}
        role="listbox"
        aria-label={node.label}
        className="desktop-completion"
        style={{ maxHeight: `calc(${node.visibleOptions ?? 5} * 36px)` }}
      >
        {node.options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-label={option.label}
            aria-selected={option.value === node.value}
            disabled={node.disabled}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(option.value)}
          >
            <span>
              <StyledText text={option.label} runs={option.runs} />
            </span>
            <CornerDownLeft size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
    );
  const items = node.options.map((option) => (
    <MenuItem
      key={option.value}
      className="desktop-rich-option"
      color="neutral"
      selected={option.value === node.value}
      disabled={node.disabled}
      attributes={{
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
      }}
    >
      <StyledText text={option.label} runs={option.runs} />
    </MenuItem>
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
        <DropdownMenu
          active={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          containerRef={root}
          width="trigger"
          trapFocusMode={false}
          disableHideAnimation
        >
          <DropdownMenu.Trigger>
            {(attributes) => (
              <button
                {...attributes}
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
                className="desktop-rich-select-trigger"
              >
                <span
                  data-selected-value={node.value}
                  onClick={(event) => {
                    if (event.defaultPrevented) event.stopPropagation();
                  }}
                >
                  <StyledText
                    text={selected?.label ?? ""}
                    runs={selected?.runs}
                  />
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            )}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>{list}</DropdownMenu.Content>
        </DropdownMenu>
      )}
    </div>
  );
}
