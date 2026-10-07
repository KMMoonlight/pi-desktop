import { t, useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, File, Folder } from "lucide-react";
import { baseName, Hint } from "./ui";
import type { Run } from "./Workspace";
import type { FileItem } from "../shared/types";

type Listing = { items: FileItem[]; loading?: boolean; error?: string };
export function FileTree({
  cwd,
  run,
  selected,
  openFile,
  revision,
}: {
  cwd: string;
  run: Run;
  selected: string;
  openFile: (path: string) => void;
  revision: number;
}) {
  useLocale();
  const [lists, setLists] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [showExcluded, setShowExcluded] = useState(false);
  const generation = useRef(0);
  const cache = useRef(new Map<string, Promise<void>>());
  const tree = useRef<HTMLDivElement>(null);
  const normalize = (value: string) => {
    const full = value.replaceAll("\\", "/"),
      root = cwd.replaceAll("\\", "/").replace(/\/$/, "");
    return full.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? full.slice(root.length + 1)
      : full;
  };
  const chosen = normalize(selected);
  const load = (path: string) => {
    if (cache.current.has(path)) return cache.current.get(path)!;
    const id = generation.current;
    setLists((previous) => ({
      ...previous,
      [path]: { items: [], loading: true },
    }));
    const pending = (async () => {
      let error = "";
      const items = await run<FileItem[]>(
        "files.list",
        { path, showExcluded },
        (message) => {
          error = message;
        },
      );
      if (id === generation.current)
        setLists((previous) => ({
          ...previous,
          [path]: { items: items ?? [], error: error || undefined },
        }));
    })();
    cache.current.set(path, pending);
    return pending;
  };
  useEffect(() => {
    generation.current++;
    cache.current.clear();
    setLists({});
    for (const path of expanded) void load(path);
    return () => {
      generation.current++;
    };
  }, [revision, showExcluded]);
  useEffect(() => {
    if (!chosen) return;
    const ancestors = chosen
      .split("/")
      .slice(0, -1)
      .map((_, index, parts) => parts.slice(0, index + 1).join("/"));
    setExpanded((previous) => new Set([...previous, ...ancestors]));
    for (const path of ancestors) void load(path);
  }, [chosen, showExcluded, revision]);
  useEffect(() => {
    tree.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [chosen, lists]);
  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      void load(path);
    }
    setExpanded(next);
  };
  const render = (path: string, depth: number) => {
    const listing = lists[path];
    return (
      <div role="group">
        {listing?.items.map((file) => (
          <div key={file.path}>
            <button
              className={`file-row ${chosen === file.path ? "selected" : ""}`}
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={chosen === file.path}
              aria-expanded={
                file.directory ? expanded.has(file.path) : undefined
              }
              data-path={file.path}
              data-parent={path}
              title={file.path}
              style={{ paddingLeft: 8 + depth * 16 }}
              onClick={() =>
                file.directory ? toggle(file.path) : openFile(file.path)
              }
              onKeyDown={(event) => {
                const row = event.currentTarget;
                if (event.key === "ArrowRight" && file.directory) {
                  event.preventDefault();
                  if (!expanded.has(file.path)) toggle(file.path);
                  else
                    row.parentElement
                      ?.querySelector<HTMLButtonElement>(
                        '[role="group"] button',
                      )
                      ?.focus();
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  if (file.directory && expanded.has(file.path))
                    toggle(file.path);
                  else
                    [
                      ...(tree.current?.querySelectorAll<HTMLButtonElement>(
                        "button[data-path]",
                      ) ?? []),
                    ]
                      .find((button) => button.dataset.path === path)
                      ?.focus();
                } else if (
                  ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const rows = [
                    ...tree.current!.querySelectorAll<HTMLButtonElement>(
                      '[role="treeitem"]',
                    ),
                  ];
                  const index = rows.indexOf(row);
                  rows[
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? rows.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              rows.length - 1,
                              index + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          )
                  ].focus();
                }
              }}
            >
              {file.directory ? (
                <ChevronRight
                  size={12}
                  className={expanded.has(file.path) ? "file-expanded" : ""}
                />
              ) : (
                <span className="file-indent" />
              )}
              {file.directory ? <Folder size={15} /> : <File size={15} />}
              <span>{file.name}</span>
            </button>
            {file.directory &&
              expanded.has(file.path) &&
              render(file.path, depth + 1)}
          </div>
        ))}
        {listing?.loading && (
          <div
            className="file-tree-feedback"
            role="status"
            style={{ paddingLeft: 16 + depth * 16 }}
          >
            {t("正在读取…")}
          </div>
        )}
        {listing?.error && (
          <div className="file-tree-feedback" role="alert">
            {listing.error}
            <button
              onClick={() => {
                cache.current.delete(path);
                void load(path);
              }}
            >
              {t("重试")}
            </button>
          </div>
        )}
        {listing &&
          !listing.loading &&
          !listing.error &&
          !listing.items.length && (
            <div
              className="file-tree-feedback"
              style={{ paddingLeft: 16 + depth * 16 }}
            >
              {t("此目录为空")}
            </div>
          )}
      </div>
    );
  };
  return (
    <div className="file-list">
      <div className="file-path">
        <Hint text={cwd}>
          <span tabIndex={0}>{baseName(cwd)}</span>
        </Hint>
      </div>
      <label className="file-visibility">
        <input
          type="checkbox"
          checked={showExcluded}
          onChange={(event) => setShowExcluded(event.target.checked)}
        />
        {t("显示隐藏与依赖目录")}
      </label>
      <div role="tree" aria-label={t("工作区文件")} ref={tree}>
        {render("", 0)}
      </div>
    </div>
  );
}
