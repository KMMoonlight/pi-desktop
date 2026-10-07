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
  labelledBy,
  describedBy,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  labelledBy?: string;
  describedBy?: string;
}) {
  useLocale();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const options = optionsFrom(children);
  const selected = options.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 300,
  });
  const close = () => setOpen(false);
  const choose = (index: number) => {
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
        if (box.top < bounds.top || box.bottom > bounds.bottom) { close(); return; }
      }
      const above = box.top - 12,
        below = innerHeight - box.bottom - 12;
      const maxHeight = Math.min(360, Math.max(above, below));
      const width = Math.min(innerWidth - 24, 420, Math.max(box.width, 240));
      // Measure wrapped labels at the final width before placing above/below.
      if (list.current) {
        list.current.style.width = `${width}px`;
        list.current.style.maxHeight = `${maxHeight}px`;
      }
      const height = Math.min(maxHeight, list.current?.scrollHeight ?? options.length * 34 + 8);
      setPosition({
        left: Math.max(12, Math.min(box.left, innerWidth - width - 12)),
        top:
          below >= height || below >= above
            ? box.bottom + 6
            : Math.max(6, box.top - height - 6),
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
  }, [open, options.length]);
  useLayoutEffect(() => {
    if (open)
      list.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        data-desktop-native-input
        role="combobox"
        aria-label={name}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
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
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
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
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open ? choose(active) : reveal();
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (event.key === "Tab") close();
          else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            event.preventDefault();
            const now = Date.now();
            const query =
              now - typeahead.current.at < 700
                ? typeahead.current.text + event.key
                : event.key;
            typeahead.current = { text: query, at: now };
            const index = options.findIndex(
              (option) =>
                !option.disabled &&
                option.text.toLowerCase().startsWith(query.toLowerCase()),
            );
            if (index >= 0) {
              setActive(index);
              setOpen(true);
            }
          }
        }}
      >
        <span>{options[selected]?.label ?? t("请选择")}</span>
        <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label={name}
            className="select-popover"
            data-desktop-native-input
            style={position}
            onPointerDown={(event) => event.preventDefault()}
          >
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
