import { t, useLocale } from "./i18n";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Image, FolderOpen, Search, Blocks, Wrench } from "lucide-react";
import type { DesktopSnapshot } from "../shared/types";
import { menuKeyboard } from "./menuKeyboard";

export function ContextMenu({
  snapshot,
  images,
  files,
  useCommand,
}: {
  snapshot: DesktopSnapshot;
  images: () => void;
  files: () => void;
  useCommand: (command: string) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: 12,
    bottom: 60,
    maxHeight: 410,
  });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current!.getBoundingClientRect();
      setPosition({
        left: Math.max(
          12,
          Math.min(
            bounds.left,
            innerWidth - Math.min(310, innerWidth - 60) - 12,
          ),
        ),
        bottom: innerHeight - bounds.top + 8,
        maxHeight: Math.min(410, Math.max(120, bounds.top - 20)),
      });
    };
    place();
    filter.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
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
  const choose = (fn: () => void) => {
    setOpen(false);
    setSearch("");
    trigger.current?.focus({ preventScroll: true });
    fn();
  };
  const resources = snapshot.resources
    .filter((resource) => ["skill", "prompt"].includes(resource.kind))
    .map((resource) => ({
      name: resource.name,
      description: resource.description,
      command:
        resource.kind === "skill"
          ? `/skill:${resource.name} `
          : `/${resource.name} `,
      kind: resource.kind === "skill" ? t("技能") : t("提示词"),
    }));
  const commands = snapshot.commands.map((command) => ({
    ...command,
    command: `/${command.name} `,
    kind: t("命令"),
  }));
  const entries = [...resources, ...commands].filter((entry) =>
    `${entry.name} ${entry.description ?? ""} ${entry.kind}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div
      className="context-add"
      data-desktop-native-input
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        ref={trigger}
        className="context-add-trigger"
        aria-label={t("添加上下文")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}
      >
        <Plus size={18} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            style={position}
            className="context-add-menu"
            role="dialog"
            aria-label={t("添加上下文")}
            data-desktop-native-input
            onKeyDown={event => {
              if (event.key === "Tab") { setOpen(false); return; }
              if (event.target instanceof HTMLInputElement && ["Home", "End"].includes(event.key)) return;
              menuKeyboard(event, () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); });
            }}
          >
            <label className="context-search">
              <Search size={14} />
              <input
                ref={filter}
                aria-label={t("搜索技能与命令")}
                placeholder={t("搜索技能、提示词或命令")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {!search && (
              <div className="context-actions">
                <button onClick={() => choose(images)}>
                  <Image size={16} />
                  {t("添加图片")}
                </button>
                <button onClick={() => choose(files)}>
                  <FolderOpen size={16} />
                  {t("项目文件")}
                </button>
              </div>
            )}
            <div className="context-entry-list">
              {entries.map((entry, index) => (
                <button
                  key={`${entry.command}-${index}`}
                  title={entry.description}
                  onClick={() => choose(() => useCommand(entry.command))}
                >
                  {entry.kind === t("命令") ? (
                    <Wrench size={15} />
                  ) : (
                    <Blocks size={15} />
                  )}
                  <span>
                    {entry.name}
                    <small>{entry.kind}</small>
                  </span>
                </button>
              ))}
              {!entries.length && <p className="muted">{t("没有匹配的技能或命令")}</p>}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
