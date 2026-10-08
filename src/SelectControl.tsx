import { t, useLocale } from "./i18n";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type Option = {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
};
const plain = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? plain(child.props.children)
        : String(child),
    )
    .join("");
function optionsFrom(children: ReactNode, inherited = false): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === "option")
      return [
        {
          value: String(child.props.value ?? plain(child.props.children)),
          label: child.props.children,
          text: plain(child.props.children),
          disabled: inherited || !!child.props.disabled,
        },
      ];
    return optionsFrom(
      child.props.children,
      inherited || !!child.props.disabled,
    );
  });
}

export function SelectControl({
  name,
  value,
  onChange,
  children,
  disabled,
  pending,
  labelledBy,
  describedBy,
  searchable = false,
  searchPlaceholder,
  emptyText,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  pending?: boolean;
  labelledBy?: string;
  describedBy?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  useLocale();
  const id = useId();
  const trigger = useRef<HTMLButtonElement | HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const [query, setQuery] = useState("");
  const allOptions = optionsFrom(children);
  const options =
    searchable && query.trim()
      ? allOptions.filter((option) =>
          option.text
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
      : allOptions;
  const selected = options.findIndex((option) => option.value === value);
  const selectedOption = allOptions.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 300,
  });
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (index: number) => {
    if (disabled || pending) return;
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
    trigger.current?.focus();
  };
  const move = (direction: number) => {
    for (let step = 1; step <= options.length; step++) {
      const index =
        (active + direction * step + options.length) % options.length;
      if (!options[index].disabled) {
        setActive(index);
        break;
      }
    }
  };
  const reveal = () => {
    if (disabled || pending) return;
    setQuery("");
    setActive(
      selected >= 0 && !options[selected].disabled
        ? selected
        : options.findIndex((option) => !option.disabled),
    );
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const update = () => {
      const box = trigger.current!.getBoundingClientRect();
      const scroller = trigger.current!.closest(".settings-content");
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        if (box.top < bounds.top || box.bottom > bounds.bottom) {
          close();
          return;
        }
      }
      const gap = 6;
      const above = Math.max(0, box.top - 12 - gap),
        below = Math.max(0, innerHeight - box.bottom - 12 - gap);
      const maxHeight = Math.min(360, Math.max(above, below));
      const maxWidth = Math.min(innerWidth - 24, 420);
      const minWidth = Math.min(maxWidth, Math.max(box.width, 160));
      // Size to the labels, then measure the final border box before placing it.
      if (list.current) {
        list.current.style.width = "max-content";
        list.current.style.minWidth = `${minWidth}px`;
        list.current.style.maxWidth = `${maxWidth}px`;
        list.current.style.maxHeight = `${maxHeight}px`;
      }
      const width = Math.ceil(
        list.current?.getBoundingClientRect().width ?? minWidth,
      );
      if (list.current) list.current.style.width = `${width}px`;
      const height = list.current?.getBoundingClientRect().height ?? 0;
      const preferAbove = !!trigger.current!.closest(".composer");
      const placeAbove =
        (preferAbove && above >= height) || (below < height && above > below);
      setPosition({
        left: Math.max(12, Math.min(box.left, innerWidth - width - 12)),
        top: placeAbove ? box.top - height - gap : box.bottom + gap,
        width,
        maxHeight,
      });
    };
    update();
    const dismiss = (event: Event) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !list.current?.contains(event.target as Node)
      )
        close();
    };
    const scroll = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) update();
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open, options.map((option) => option.text).join("\n")]);
  useLayoutEffect(() => {
    if (open)
      list.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  useEffect(() => {
    if (disabled || pending) close();
  }, [disabled, pending]);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (pending || event.nativeEvent.isComposing) return;
    if (
      ["ArrowDown", "ArrowUp"].includes(event.key) ||
      (!searchable && ["Home", "End"].includes(event.key))
    ) {
      event.preventDefault();
      if (!open) reveal();
      else if (event.key === "Home")
        setActive(options.findIndex((option) => !option.disabled));
      else if (event.key === "End")
        setActive(
          options
            .map((option, index) => (option.disabled ? -1 : index))
            .filter((index) => index >= 0)
            .pop() ?? -1,
        );
      else move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" || (!searchable && event.key === " ")) {
      event.preventDefault();
      open ? choose(active) : reveal();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") close();
    else if (
      !searchable &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const now = Date.now();
      const text =
        now - typeahead.current.at < 700
          ? typeahead.current.text + event.key
          : event.key;
      typeahead.current = { text, at: now };
      const index = options.findIndex(
        (option) =>
          !option.disabled &&
          option.text.toLowerCase().startsWith(text.toLowerCase()),
      );
      if (index >= 0) {
        setActive(index);
        setOpen(true);
      }
    }
  };
  return (
    <>
      {searchable ? (
        <div className="relative min-w-0">
          <input
            ref={(node) => {
              trigger.current = node;
            }}
            className="select-trigger w-full appearance-none rounded-lg border border-line bg-canvas px-3 py-1.5 pr-9 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
            data-desktop-native-input
            role="combobox"
            aria-label={name}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            aria-activedescendant={
              open && active >= 0 && options[active]
                ? `${id}-${active}`
                : undefined
            }
            aria-busy={pending || undefined}
            disabled={disabled}
            name={name}
            data-value={value}
            autoComplete="off"
            value={open ? query : (selectedOption?.text ?? value)}
            placeholder={open ? searchPlaceholder : undefined}
            onClick={() => {
              if (!open) reveal();
            }}
            onChange={(event) => {
              if (pending) return;
              const next = event.target.value;
              setQuery(next);
              setActive(
                allOptions
                  .filter((option) =>
                    option.text
                      .toLocaleLowerCase()
                      .includes(next.trim().toLocaleLowerCase()),
                  )
                  .findIndex((option) => !option.disabled),
              );
              setOpen(true);
            }}
            onBlur={close}
            onKeyDown={handleKeyDown}
          />
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
          />
        </div>
      ) : (
        <button
          ref={(node) => {
            trigger.current = node;
          }}
          type="button"
          className="select-trigger appearance-none flex min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
          data-desktop-native-input
          role="combobox"
          aria-label={name}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-haspopup="listbox"
          aria-busy={pending || undefined}
          aria-disabled={disabled || pending || undefined}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-activedescendant={
            open && active >= 0 ? `${id}-${active}` : undefined
          }
          data-value={value}
          name={name}
          value={value}
          disabled={disabled}
          title={options[selected]?.text}
          onClick={() => (open ? close() : reveal())}
          onBlur={close}
          onKeyDown={handleKeyDown}
        >
          <span>{options[selected]?.label ?? t("请选择")}</span>
          <ChevronDown size={14} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label={name}
            className="select-popover fixed z-[10000] overflow-auto rounded-xl border border-line bg-canvas p-1 text-ink shadow-sm"
            data-desktop-native-input
            style={position}
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted">
                {emptyText ?? t("没有匹配项")}
              </p>
            )}
            {options.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-${index}`}
                key={`${option.value}-${index}`}
                tabIndex={-1}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={active === index ? "is-highlighted" : ""}
                data-index={index}
                data-value={option.value}
                disabled={option.disabled}
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={14} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
