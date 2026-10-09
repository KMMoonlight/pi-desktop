import { t, useLocale } from "./i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Folder, Plus } from "lucide-react";
import { baseName } from "./ui";
import { menuKeyboard } from "./menuKeyboard";

export function WorkspacePicker({
  cwd,
  workspaces,
  disabled,
  pending,
  choose,
  add,
}: {
  cwd: string;
  workspaces: string[];
  disabled: boolean;
  pending?: boolean;
  choose: (cwd: string) => void;
  add: () => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 12,
    top: 0,
    maxHeight: 300,
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const paths = [...new Set([cwd, ...workspaces])];
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (disabled || pending) setOpen(false);
  }, [disabled, pending]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current!.getBoundingClientRect();
      const above = bounds.top - 18,
        below = innerHeight - bounds.bottom - 18;
      const maxHeight = Math.min(360, Math.max(above, below));
      const element = menu.current!;
      const previousMaxHeight = element.style.maxHeight;
      // Measure the full border box at its final cap; scrollHeight omits borders
      // and would squeeze a short options list enough to create a scrollbar.
      element.style.maxHeight = `${maxHeight}px`;
      const height = element.getBoundingClientRect().height;
      element.style.maxHeight = previousMaxHeight;
      setPosition({
        left: Math.max(
          12,
          Math.min(
            bounds.left,
            innerWidth - Math.min(360, innerWidth - 24) - 12,
          ),
        ),
        top:
          below >= height
            ? bounds.bottom + 6
            : Math.max(12, bounds.top - height - 6),
        maxHeight,
      });
    };
    place();
    menu.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  return (
    <div className="composer-workspace-picker" data-desktop-native-input>
      <button
        ref={trigger}
        type="button"
        aria-label={t("选择工作区")}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        aria-disabled={disabled || pending || undefined}
        aria-busy={pending || undefined}
        title={cwd}
        onClick={() => { if (!pending) setOpen(!open); }}
        onKeyDown={(event) => {
          if (pending) return;
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Folder size={15} />
        <span>{baseName(cwd)}</span>
        <ChevronDown size={12} />
      </button>
      {open &&
        createPortal(
          <div
            className="workspace-picker-menu"
            ref={menu}
            style={position}
            role="menu"
            aria-label={t("选择工作区")}
            data-desktop-native-input
            onKeyDown={(event) => {
              if (event.key === "Tab") close();
              else menuKeyboard(event, close);
            }}
          >
            <div className="workspace-picker-options">
              {paths.map((path) => (
                <button
                  type="button"
                  key={path}
                  role="menuitemradio"
                  aria-checked={path === cwd}
                  title={path}
                  onClick={() => {
                    close();
                    if (path !== cwd) choose(path);
                  }}
                >
                  <Folder size={16} />
                  <span>
                    <strong>{baseName(path)}</strong>
                    <small>{path}</small>
                  </span>
                  {path === cwd && <Check size={16} />}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="workspace-picker-add"
              role="menuitem"
              onClick={() => {
                close();
                add();
              }}
            >
              <Plus size={16} />
              {t("添加工作区…")}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
