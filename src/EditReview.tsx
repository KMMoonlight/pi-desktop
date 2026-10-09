import { useContext, useEffect, useState } from "react";
import {
  Check,
  Copy,
  FileCode2,
  LoaderCircle,
  CircleAlert,
} from "lucide-react";
import type {
  ChatMessage,
  ContentBlock,
  ToolPresentation,
} from "../shared/types";
import type {
  DesktopNode,
  DesktopSurface,
  DesktopMarkdownText,
  DesktopTextRun,
} from "../shared/desktop-ui";
import { t, useLocale } from "./i18n";
import { DesktopLink } from "./DesktopLink";
import { FileWorkspace } from "./FileNavigation";
import { StyledText } from "./StyledText";
import { IconButton } from "./ui";

// Read the SDK's live preview, including its inline change highlights.
function textNodes(node?: DesktopNode): DesktopMarkdownText[] {
  if (!node) return [];
  if (node.kind === "text") return [node];
  if (node.kind === "region") return textNodes(node.child);
  if ("children" in node) return node.children.flatMap(textNodes);
  return [];
}

function sliceRuns(
  runs: DesktopTextRun[] | undefined,
  start: number,
  end: number,
) {
  let offset = 0;
  return runs?.flatMap((run) => {
    const from = Math.max(0, start - offset);
    const to = Math.min(run.text.length, end - offset);
    offset += run.text.length;
    // The native inverse highlight becomes a softer changed-word highlight.
    return to > from
      ? [
          {
            ...run,
            text: run.text.slice(from, to),
            style: run.style?.backgroundColor
              ? {
                  backgroundColor: "var(--edit-word-background)",
                  color: "inherit",
                }
              : undefined,
          },
        ]
      : [];
  });
}

function diffRows(source: DesktopMarkdownText) {
  let offset = 0;
  return source.text.split("\n").map((line) => {
    const match = /^([+\- ])\s*(\d+) (.*)$/.exec(line);
    const code = match?.[3] ?? line;
    const kind = match
      ? match[1] === "+"
        ? "addition"
        : match[1] === "-"
          ? "deletion"
          : "context"
      : "gap";
    const start = offset + line.length - code.length;
    const runs = sliceRuns(source.runs, start, offset + line.length);
    offset += line.length + 1;
    return { kind, number: match?.[2], text: code, runs };
  });
}

export function EditReview({
  call,
  result,
  surface,
  state,
  expanded,
}: {
  call: ContentBlock;
  result?: ChatMessage;
  surface?: DesktopSurface;
  state: ToolPresentation["state"];
  expanded: boolean;
}) {
  useLocale();
  const workspace = useContext(FileWorkspace)
    ?.replace(/\\/g, "/")
    .replace(/\/$/, "");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const args =
    call.arguments && typeof call.arguments === "object"
      ? (call.arguments as Record<string, unknown>)
      : {};
  const path = String(args.file_path ?? args.path ?? "");
  const absolute = path.replace(/\\/g, "/");
  const normalized =
    workspace && absolute.startsWith(`${workspace}/`)
      ? absolute.slice(workspace.length + 1)
      : absolute;
  const separator = normalized.lastIndexOf("/");
  const filename = normalized.slice(separator + 1) || t("修改文件");
  const parent = normalized.slice(0, Math.max(0, separator));
  const texts = textNodes(surface?.view);
  const preview = texts.find((text) => /^[+\- ]\s*\d+ /m.test(text.text));
  const details = result?.details as { diff?: unknown } | undefined;
  const completedDiff =
    !result?.isError && typeof details?.diff === "string"
      ? details.diff
      : undefined;
  const source =
    completedDiff !== undefined &&
    completedDiff.replace(/\t/g, "   ") !== preview?.text
      ? { text: completedDiff }
      : preview;
  const rows = source ? diffRows(source) : [];
  const additions = rows.filter((row) => row.kind === "addition").length;
  const deletions = rows.filter((row) => row.kind === "deletion").length;
  const href = texts[0]?.runs?.find((run) => run.href)?.href ?? path;
  const errors =
    state === "error"
      ? (result?.content
          .filter((block) => block.type === "text" && block.text)
          .map((block) => block.text!) ?? [])
      : state === "pending"
        ? texts
            .slice(1)
            .filter((text) => text !== preview && text.text.trim())
            .map((text) => text.text)
        : [];
  return (
    <div
      className="tool-self tool-execution tool-edit-review"
      data-tool-call-id={call.id}
      data-tool-state={state}
      data-tool-expanded={expanded}
      data-tool-details-visible="true"
      data-tool-interactive="false"
    >
      <div className="edit-review-card">
        <header className="edit-review-header">
          <FileCode2
            className="edit-review-file-icon"
            size={16}
            aria-hidden="true"
          />
          <div className="edit-review-file">
            <DesktopLink href={href} title={path}>
              {filename}
            </DesktopLink>
            {parent && <span title={path}>{parent}</span>}
          </div>
          <div
            className="edit-review-status"
            title={
              state === "pending"
                ? t("执行中")
                : state === "error"
                  ? t("失败")
                  : t("完成")
            }
          >
            {state === "pending" ? (
              <LoaderCircle className="spin" size={13} />
            ) : state === "error" ? (
              <CircleAlert size={14} />
            ) : (
              <Check size={14} />
            )}
            {state !== "success" && (
              <span>{state === "pending" ? t("执行中") : t("失败")}</span>
            )}
          </div>
          {source && (
            <>
              <span className="edit-review-counts">
                <span
                  className="edit-review-added"
                  title={t("新增 {value1} 行", { value1: additions })}
                >
                  +{additions}
                </span>
                <span
                  className="edit-review-removed"
                  title={t("删除 {value1} 行", { value1: deletions })}
                >
                  −{deletions}
                </span>
              </span>
              <IconButton
                icon={copied ? Check : Copy}
                label={copied ? t("已复制") : t("复制文件 diff")}
                onClick={() => {
                  setCopyError(false);
                  void navigator.clipboard
                    .writeText(completedDiff ?? source.text)
                    .then(() => setCopied(true))
                    .catch(() => setCopyError(true));
                }}
              />
            </>
          )}
        </header>
        {source && (
          <div
            className="edit-review-viewport"
            role="region"
            aria-label={t("代码修改")}
            tabIndex={0}
          >
            <pre className="edit-review-code">
              {rows.map((row, index) => (
                <div className={`edit-review-line ${row.kind}`} key={index}>
                  <span className="edit-review-number" aria-hidden="true">
                    {row.number}
                  </span>
                  <span className="edit-review-sign" aria-hidden="true">
                    {row.kind === "addition"
                      ? "+"
                      : row.kind === "deletion"
                        ? "−"
                        : ""}
                  </span>
                  <code>
                    <StyledText text={row.text} runs={row.runs} />
                    {"\n"}
                  </code>
                </div>
              ))}
            </pre>
          </div>
        )}
        {[...new Set(errors)].map((error) => (
          <p className="edit-review-error" key={error}>
            {error}
          </p>
        ))}
        {copyError && (
          <p className="edit-review-error" role="alert">
            {t("复制失败")}
          </p>
        )}
      </div>
    </div>
  );
}
