import { t, useLocale, getLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Button } from "./primitives";
import {
  Folder,
  File,
  RefreshCw,
  Paperclip,
  GitCompareArrows,
  FileSearch,
  Search,
  Copy,
  X,
  WrapText,
} from "lucide-react";
import { action } from "./client";
import { Empty, Field, Hint, IconButton, baseName } from "./ui";
import { FileTree } from "./FileTree";
import type { FileTarget } from "./FileNavigation";
export { TreeView } from "./SessionTree";
import type { DesktopSnapshot, FilePreview } from "../shared/types";

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
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPath, setPreviewPath] = useState("");
  const [changesError, setChangesError] = useState(false);
  const [changesMessage, setChangesMessage] = useState("");
  const [line, setLine] = useState<number>();
  const previewNode = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const openPreview = async (file: string, selectedLine?: number) => {
    const id = ++request.current;
    setLine(selectedLine);
    setPreviewPath(file);
    setPreviewError(false);
    setPreviewMessage("");
    setPreviewLoading(true);
    const result = await run<FilePreview>("files.read", { path: file }, (message) => {
      if (id === request.current) setPreviewMessage(message);
    });
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
    setChangesMessage("");
    const data = await run<{ status: string; diff: string }>(
      "git.changes",
      undefined,
      setChangesMessage,
    );
    setChanges(data);
    setChangesError(!data);
  };
  return (
    <section className="files-view" aria-label={t("文件与更改")}>
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
        <div className="diff-view min-h-0 overflow-auto p-3">
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
          ) : changesError && /not a git repository/i.test(changesMessage) ? (
            <Empty icon={GitCompareArrows} title={t("当前工作区未启用 Git")}>
              <p>{t("选择包含 Git 仓库的工作区以查看更改。")}</p>
            </Empty>
          ) : (
            <div
              className="loading-row"
              role={changesError ? "alert" : "status"}
            >
              {changesError ? t("更改读取失败") : t("正在读取更改")}
              {changesError && (
                <button className="file-retry" onClick={() => { void refreshChanges(); }}>
                  {t("重试")}
                </button>
              )}
              {changesError && changesMessage && (
                <details className="file-error-details">
                  <summary>{t("错误详情")}</summary>
                  <pre>{changesMessage}</pre>
                </details>
              )}
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
          <div className="file-preview flex min-h-0 min-w-0 flex-col overflow-hidden" ref={previewNode}>
            {previewLoading ? (
              <div className="loading-row" role="status">
                {t("正在读取文件")}
              </div>
            ) : preview ? (
              <>
                <div className="preview-header flex h-10 shrink-0 items-center gap-2 border-b border-line bg-soft px-3">
                  <Hint text={preview.path}>
                    <span tabIndex={0}>
                      {baseName(preview.path)}
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
                {previewError && previewMessage && <p>{previewMessage}</p>}
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
