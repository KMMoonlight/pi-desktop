import { t, useLocale, getLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Button, Switch } from "reshaped";
import {
  ChevronRight,
  Folder,
  File,
  RefreshCw,
  Paperclip,
  GitCompareArrows,
  GitBranch,
  Tag,
  FileSearch,
  Blocks,
  Wrench,
  RotateCcw,
  Search,
  Copy,
  X,
  WrapText,
} from "lucide-react";
import { action } from "./client";
import { Empty, Field, Hint, IconButton, baseName } from "./ui";
import { FileTree } from "./FileTree";
import type { FileTarget } from "./FileNavigation";
import type { DesktopSnapshot, FilePreview, TreeItem } from "../shared/types";

export type Run = <T = unknown>(
  name: string,
  args?: Record<string, unknown>,
  onError?: (message: string) => void,
) => Promise<T | undefined>;
export function FilesView({
  snapshot,
  run,
  attach,
  target,
  close,
}: {
  snapshot: DesktopSnapshot;
  run: Run;
  attach: (path: string) => void;
  target?: FileTarget;
  close?: () => void;
}) {
  useLocale();
  const [treeRevision, setTreeRevision] = useState(0);
  const [wrap, setWrap] = useState(false);
  const [preview, setPreview] = useState<FilePreview>();
  const [changes, setChanges] = useState<{ status: string; diff: string }>();
  const [mode, setMode] = useState("files");
  const [previewError, setPreviewError] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPath, setPreviewPath] = useState("");
  const [changesError, setChangesError] = useState(false);
  const [line, setLine] = useState<number>();
  const previewNode = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const openPreview = async (file: string, selectedLine?: number) => {
    const id = ++request.current;
    setLine(selectedLine);
    setPreviewPath(file);
    setPreviewError(false);
    setPreviewLoading(true);
    const result = await run<FilePreview>("files.read", { path: file });
    if (id === request.current) {
      setPreview(result);
      setPreviewError(!result);
      setPreviewLoading(false);
    }
  };
  useEffect(() => {
    if (!target) return;
    request.current++;
    setMode("files");
    setLine(target.line);
    if (target.preview) {
      setPreview(target.preview);
      setPreviewError(false);
      setPreviewLoading(false);
    } else void openPreview(target.path, target.line);
    setPreviewPath(target.path);
  }, [target]);
  useEffect(() => {
    if (line && preview)
      previewNode.current
        ?.querySelector(`[data-file-line="${line}"]`)
        ?.scrollIntoView({ block: "center" });
  }, [line, preview]);
  const refresh = () => setTreeRevision((previous) => previous + 1);
  const refreshChanges = async () => {
    setChanges(undefined);
    setChangesError(false);
    const data = await run<{ status: string; diff: string }>("git.changes");
    setChanges(data);
    setChangesError(!data);
  };
  return (
    <section className="files-view">
      <div className="section-toolbar">
        <div className="mode-switch">
          <button
            className={mode === "files" ? "selected" : ""}
            onClick={() => setMode("files")}
          >
            <Folder size={15} />
            {t("文件")}
          </button>
          <button
            className={mode === "changes" ? "selected" : ""}
            onClick={() => {
              setMode("changes");
              void refreshChanges();
            }}
          >
            <GitCompareArrows size={15} />
            {t("更改")}
          </button>
        </div>
        <IconButton
          icon={WrapText}
          label={t("自动换行")}
          active={wrap}
          attributes={{ "aria-pressed": wrap }}
          onClick={() => setWrap(!wrap)}
        />
        <IconButton
          icon={RefreshCw}
          label={t("刷新文件")}
          onClick={() => {
            if (mode === "files") void refresh();
            else void refreshChanges();
          }}
        />
        {close && <IconButton icon={X} label={t("关闭文件面板")} onClick={close} />}
      </div>
      {mode === "changes" ? (
        <div className="diff-view">
          {changes ? (
            <>
              {changes.status && (
                <details className="git-status-disclosure">
                  <summary>{t("工作区状态")}</summary>
                  <pre className="git-status">{changes.status}</pre>
                </details>
              )}
              {!changes.status && !changes.diff && (
                <Empty icon={GitCompareArrows} title={t("没有未提交的更改")} />
              )}
              <Diff
                text={changes.diff}
                wrap={wrap}
                openFile={(path) => {
                  setMode("files");
                  void openPreview(path);
                }}
              />
            </>
          ) : (
            <div
              className="loading-row"
              role={changesError ? "alert" : "status"}
            >
              {changesError ? t("更改读取失败") : t("正在读取更改")}
            </div>
          )}
        </div>
      ) : (
        <div className="file-layout">
          <FileTree
            key={snapshot.cwd}
            cwd={snapshot.cwd}
            run={run}
            revision={treeRevision}
            selected={previewPath}
            openFile={(file) => {
              void openPreview(file);
            }}
          />
          <div className="file-preview" ref={previewNode}>
            {previewLoading ? (
              <div className="loading-row" role="status">
                {t("正在读取文件")}
              </div>
            ) : preview ? (
              <>
                <div className="preview-header">
                  <Hint text={preview.path}>
                    <span tabIndex={0}>
                      {preview.path.startsWith(snapshot.cwd)
                        ? preview.path
                            .slice(snapshot.cwd.length)
                            .replace(/^[\\/]/, "")
                        : preview.path}
                    </span>
                  </Hint>
                  {!preview.image && (
                    <IconButton
                      icon={Copy}
                      label={t("复制文件内容")}
                      onClick={() => {
                        void navigator.clipboard.writeText(preview.content);
                      }}
                    />
                  )}
                  <IconButton
                    icon={Paperclip}
                    label={t("添加到消息")}
                    onClick={() => attach(preview.path)}
                  />
                </div>
                {preview.image ? (
                  <img alt={preview.path} src={preview.image} />
                ) : (
                  <pre className={`source-code ${wrap ? "wrap-code" : ""}`}>
                    {preview.content.split("\n").map((contentLine, index) => (
                      <div
                        key={index}
                        data-file-line={index + 1}
                        className={
                          index + 1 === line ? "selected-file-line" : undefined
                        }
                      >
                        <span className="line-number">{index + 1}</span>
                        <span>{contentLine || " "}</span>
                      </div>
                    ))}
                  </pre>
                )}
                {preview.truncated && (
                  <Hint text={t("文件超过预览大小限制，显示部分内容")}>
                    <span
                      className="preview-truncated"
                      tabIndex={0}
                      aria-label={t("文件预览已截断")}
                    >
                      …
                    </span>
                  </Hint>
                )}
              </>
            ) : (
              <Empty
                icon={FileSearch}
                title={previewError ? t("文件读取失败") : t("选择文件")}
              >
                {previewError && (
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => {
                      void openPreview(previewPath, line);
                    }}
                  >
                    {t("重试读取")}
                  </Button>
                )}
              </Empty>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
export function Diff({
  text,
  wrap = false,
  openFile,
}: {
  text: string;
  wrap?: boolean;
  openFile?: (path: string) => void;
}) {
  useLocale();
  if (!text.trim()) return null;
  const sections = text
    .split(/(?=^diff --git )/m)
    .filter((section) => section.trim());
  const allLines = text.split("\n");
  const addedCount = allLines.filter(
    (line) => line.startsWith("+") && !line.startsWith("+++"),
  ).length;
  const removedCount = allLines.filter(
    (line) => line.startsWith("-") && !line.startsWith("---"),
  ).length;
  return (
    <div className="diff-files">
      <header className="git-changes-summary">
        <GitCompareArrows size={20} />
        <div>
          <strong>{t("工作区更改")}</strong>
          <span>{t("{value1} 个文件", { value1: sections.length })}</span>
        </div>
        <span className="diff-counts">
          <span>+{addedCount}</span>
          <span>−{removedCount}</span>
        </span>
      </header>
      {sections.map((section, index) => {
        const lines = section.trimEnd().split("\n");
        const headerPath = lines[0]
          ?.match(/^diff --git .+ ("b\/.*"|b\/.+)$/)?.[1]
          ?.replace(/^"|"$/g, "");
        const path =
          lines
            .find(
              (line) => line.startsWith("+++ ") && !line.includes("/dev/null"),
            )
            ?.slice(4) ??
          lines.find((line) => line.startsWith("--- "))?.slice(4) ??
          headerPath ??
          t("更改");
        const additions = lines.filter(
          (line) => line.startsWith("+") && !line.startsWith("+++"),
        ).length;
        const deletions = lines.filter(
          (line) => line.startsWith("-") && !line.startsWith("---"),
        ).length;
        let filePath = path;
        if (filePath.startsWith('"')) {
          try {
            filePath = JSON.parse(filePath);
          } catch {
            filePath = filePath.slice(1, -1);
          }
        }
        filePath = filePath.replace(/^[ab]\//, "");
        const deleted = lines.some((line) =>
          line.startsWith("deleted file mode"),
        );
        const binary = lines.some(
          (line) =>
            line.startsWith("Binary files ") || line === "GIT binary patch",
        );
        let oldLine = 0,
          newLine = 0;
        return (
          <details className="diff-file" open key={index}>
            <summary>
              <File size={14} />
              <span title={filePath}>{filePath}</span>
              <span className="diff-counts">
                <span>+{additions}</span>
                <span>−{deletions}</span>
              </span>
            </summary>
            <div className="diff-file-actions">
              {openFile && (
                <IconButton
                  icon={FileSearch}
                  label={deleted ? t("源文件已删除") : t("打开源文件")}
                  disabled={deleted}
                  onClick={() => openFile(filePath)}
                />
              )}
              <IconButton
                icon={Copy}
                label={t("复制文件 diff")}
                onClick={() => {
                  void navigator.clipboard.writeText(section);
                }}
              />
            </div>
            {binary && <p className="diff-binary">{t("二进制文件已更改")}</p>}
            <pre className={`diff-code ${wrap ? "wrap-code" : ""}`}>
              {lines.map((line, lineIndex) => {
                if (/^(diff --git |index |--- |\+\+\+ )/.test(line))
                  return null;
                const hunk = line.match(
                  /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
                );
                if (hunk) {
                  oldLine = Number(hunk[1]);
                  newLine = Number(hunk[2]);
                }
                const added = line.startsWith("+") && !line.startsWith("+++");
                const removed = line.startsWith("-") && !line.startsWith("---");
                const context = line.startsWith(" ");
                const old = removed || context ? oldLine++ : "";
                const next = added || context ? newLine++ : "";
                return (
                  <div
                    key={lineIndex}
                    className={
                      hunk
                        ? "diff-range"
                        : added
                          ? "addition"
                          : removed
                            ? "deletion"
                            : context
                              ? "diff-context"
                              : "diff-meta"
                    }
                  >
                    <span className="diff-line-number">{old}</span>
                    <span className="diff-line-number">{next}</span>
                    <span className="diff-sign" aria-hidden="true">
                      {added ? "+" : removed ? "−" : ""}
                    </span>
                    <span>
                      {(added || removed || context ? line.slice(1) : line) ||
                        " "}
                    </span>
                  </div>
                );
              })}
            </pre>
          </details>
        );
      })}
    </div>
  );
}
export function TreeView({
  snapshot,
  run,
  editLabel,
}: {
  snapshot: DesktopSnapshot;
  run: Run;
  editLabel: (node: TreeItem) => void;
}) {
  useLocale();
  const [summarize, setSummarize] = useState(true);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    setCollapsed(new Set());
  }, [snapshot.sessionId]);
  const nodeTypeLabels: Record<string, string> = {
    model_change: t("切换模型"),
    thinking_level_change: t("调整思考等级"),
    compaction: t("压缩上下文"),
    branch_summary: t("分支摘要"),
  };
  const nodes = new Map(snapshot.tree.map((n) => [n.id, n]));
  function depth(node: TreeItem) {
    let d = 0;
    let p = node.parentId;
    const seen = new Set<string>();
    while (p && nodes.has(p) && !seen.has(p)) {
      seen.add(p);
      d++;
      p = nodes.get(p)!.parentId;
    }
    return d;
  }
  const children = new Map<string, TreeItem[]>();
  for (const node of snapshot.tree) {
    const parent =
      node.parentId && nodes.has(node.parentId) ? node.parentId : "";
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const matches = new Set(
    snapshot.tree
      .filter((node) =>
        `${node.text} ${node.label ?? ""}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
      .map((node) => node.id),
  );
  if (filter)
    for (const id of [...matches]) {
      let parent = nodes.get(id)?.parentId;
      const seen = new Set<string>([id]);
      while (parent && nodes.has(parent) && !seen.has(parent)) {
        seen.add(parent);
        matches.add(parent);
        parent = nodes.get(parent)?.parentId;
      }
    }
  const visible: TreeItem[] = [];
  const visited = new Set<string>();
  const append = (node: TreeItem) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    if (!filter || matches.has(node.id)) visible.push(node);
    if (filter || !collapsed.has(node.id))
      for (const child of children.get(node.id) ?? []) append(child);
  };
  for (const node of children.get("") ?? []) append(node);
  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const branch = new Set<string>();
  let pointer = snapshot.leafId;
  while (pointer && nodes.has(pointer) && !branch.has(pointer)) {
    branch.add(pointer);
    pointer = nodes.get(pointer)!.parentId;
  }
  return (
    <section className="workspace-section">
      <div className="section-toolbar">
        <Field
          name={t("搜索会话树")}
          value={filter}
          onChange={setFilter}
          placeholder={t("搜索节点")}
        />
        <Switch
          name="branch-summary"
          checked={summarize}
          onChange={({ checked }) => setSummarize(checked)}
        >
          {t("生成分支摘要")}
        </Switch>
        <Button
          size="small"
          variant="ghost"
          onClick={() => setCollapsed(new Set())}
        >
          {t("展开全部")}
        </Button>
        <Button
          size="small"
          variant="ghost"
          disabled={!!filter}
          onClick={() => setCollapsed(new Set(children.keys()))}
        >
          {t("折叠全部")}
        </Button>
      </div>
      {snapshot.tree.length === 0 ? (
        <Empty icon={GitBranch} title={t("会话树为空")} />
      ) : (
        <div className="tree-list" role="tree" aria-label={t("会话分支")}>
          {visible.map((node) => (
            <div
              className={`tree-row ${branch.has(node.id) ? "in-branch" : ""} ${node.id === snapshot.leafId ? "current" : ""}`}
              key={node.id}
              style={{ paddingLeft: 16 + depth(node) * 15 }}
              role="treeitem"
              aria-level={depth(node) + 1}
              aria-current={node.id === snapshot.leafId ? "true" : undefined}
              aria-expanded={
                children.has(node.id)
                  ? !!filter || !collapsed.has(node.id)
                  : undefined
              }
            >
              {children.has(node.id) ? (
                <button
                  type="button"
                  className="tree-toggle"
                  aria-label={t("{value1}节点", { value1: collapsed.has(node.id) && !filter ? t("展开") : t("折叠") })}
                  disabled={!!filter}
                  onClick={() => toggle(node.id)}
                >
                  <ChevronRight size={14} />
                </button>
              ) : (
                <span className="tree-toggle-spacer" />
              )}
              <div className="tree-node-dot" />
              <button
                className="tree-content"
                disabled={snapshot.busy}
                onClick={() => {
                  void run("session.navigate", { id: node.id, summarize });
                }}
              >
                <Hint text={node.type}>
                  <span className="tree-role" tabIndex={0}>
                    {node.role === "user"
                      ? t("你")
                      : node.role === "assistant"
                        ? "Pi"
                        : node.role === "toolResult"
                          ? t("工具")
                          : t("事件")}
                  </span>
                </Hint>
                <span>
                  {node.label ||
                    (node.text === node.type
                      ? (nodeTypeLabels[node.type] ?? node.text)
                      : node.text) ||
                    t("空消息")}
                </span>
                <Hint text={new Date(node.timestamp).toLocaleString(getLocale())}>
                  <time tabIndex={0}>
                    {new Date(node.timestamp).toLocaleTimeString(getLocale(), {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </Hint>
              </button>
              <IconButton
                icon={Tag}
                label={t("编辑节点标签")}
                onClick={() => editLabel(node)}
              />
            </div>
          ))}
          {!visible.length && <p className="muted small-pad">{t("没有匹配的节点")}</p>}
        </div>
      )}
    </section>
  );
}
export function ResourcesView({
  snapshot,
  run,
  useCommand,
}: {
  snapshot: DesktopSnapshot;
  run: Run;
  useCommand: (command: string) => void;
}) {
  useLocale();
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const titles: Record<string, string> = {
    extension: t("扩展"),
    skill: "Skills",
    prompt: t("提示词模板"),
    context: t("上下文"),
  };
  const resources = snapshot.resources.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      `${r.name} ${r.path}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="workspace-section">
      <div className="section-toolbar">
        <Field
          name={t("搜索资源")}
          value={search}
          onChange={setSearch}
          placeholder={t("搜索资源")}
        />
        <Button
          icon={RotateCcw}
          variant="outline"
          size="small"
          disabled={snapshot.busy}
          onClick={() => {
            void run("resources.reload");
          }}
        >
          {t("重新加载")}
        </Button>
      </div>
      <div className="filter-tabs">
        {["all", "extension", "skill", "prompt", "context"].map((k) => (
          <button
            key={k}
            className={kind === k ? "selected" : ""}
            onClick={() => setKind(k)}
          >
            {k === "all" ? t("全部") : titles[k]}
            <span>
              {
                snapshot.resources.filter((r) => k === "all" || r.kind === k)
                  .length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="resource-list">
        {resources.map((resource) => (
          <div
            className="resource-row"
            key={`${resource.kind}-${resource.path}`}
          >
            <Blocks size={18} />
            <div>
              <Hint text={resource.path}>
                <strong tabIndex={0}>{resource.name}</strong>
              </Hint>
              {resource.description && <p>{resource.description}</p>}
            </div>
            <span className="type-label">{titles[resource.kind]}</span>
            {["skill", "prompt"].includes(resource.kind) && (
              <Button
                size="small"
                variant="ghost"
                onClick={() =>
                  useCommand(
                    resource.kind === "skill"
                      ? `/skill:${resource.name} `
                      : `/${resource.name} `,
                  )
                }
              >
                {t("使用")}
              </Button>
            )}
          </div>
        ))}
        {resources.length === 0 && (
          <Empty icon={Blocks} title={t("没有匹配的资源")} />
        )}
      </div>
      {snapshot.commands.length > 0 && (
        <>
          <h3 className="section-title">{t("扩展操作")}</h3>
          <div className="command-list">
            {snapshot.commands.map((command) => (
              <Button
                key={command.name}
                icon={Wrench}
                variant="outline"
                size="small"
                onClick={() => useCommand(`/${command.name} `)}
                attributes={{ title: command.description }}
              >
                {command.name}
              </Button>
            ))}
          </div>
        </>
      )}
      {snapshot.diagnostics.length > 0 && (
        <div className="diagnostics">
          <h3>{t("加载诊断")}</h3>
          {snapshot.diagnostics.map((diagnostic, i) => (
            <p key={i}>{diagnostic}</p>
          ))}
        </div>
      )}
    </section>
  );
}
