import { useEffect, useId, useState } from "react";
import { Check, ChevronDown, CircleAlert, Copy, Info, X } from "lucide-react";
import type { DesktopEvent } from "../shared/types";
import { t, useLocale } from "./i18n";
import { StyledText } from "./StyledText";
import { retryNoticeSummary } from "./notice-content";
import { httpNoticeError } from "../shared/notices";

export type Notice = Omit<Extract<DesktopEvent, { type: "notice" }>, "type"> & {
  id: string;
};

export function NoticeCard({
  notice,
  onDismiss,
  onReadingChange,
}: {
  notice: Notice;
  onDismiss: () => void;
  onReadingChange: (id: string, reading: boolean) => void;
}) {
  useLocale();
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    onReadingChange(notice.id, expanded);
    return () => onReadingChange(notice.id, false);
  }, [notice.id, expanded, onReadingChange]);
  const [copyFeedback, setCopyFeedback] = useState<{
    message: string;
    copied: boolean;
  }>();
  const text = notice.presentation?.text ?? notice.message;
  const summary = notice.retry
    ? retryNoticeSummary(notice.retry.errorMessage)
    : notice.level !== "info" && httpNoticeError(text)
      ? retryNoticeSummary(text)
      : undefined;
  const collapsible =
    !!summary || text.length > 180 || text.split("\n").length > 3;
  const Icon = notice.level === "info" ? Info : CircleAlert;
  const feedback =
    copyFeedback?.message === notice.message ? copyFeedback : undefined;
  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(notice.message);
      setCopyFeedback({ message: notice.message, copied: true });
    } catch {
      setExpanded(true);
      setCopyFeedback({ message: notice.message, copied: false });
    }
  };

  return (
    <div
      className={`notice notice-${notice.level}`}
      role={notice.level === "error" ? "alert" : "status"}
    >
      <Icon className="notice-icon" size={17} aria-hidden="true" />
      <div className="notice-content">
        {summary ? (
          <>
            <div className="notice-heading">
              <strong>{t(summary.title)}</strong>
              {summary.status && (
                <span className="notice-code">HTTP {summary.status}</span>
              )}
            </div>
            {notice.retry && (
              <p className="notice-description">
                {t("正在自动重试（{attempt}/{maxAttempts}）", notice.retry)}
              </p>
            )}
          </>
        ) : collapsible ? (
          <p className="notice-preview">
            {text.slice(0, 160)}
            {text.length > 160 ? "…" : ""}
          </p>
        ) : (
          <StyledText
            {...(notice.presentation ?? { text: notice.message })}
            desktopCopy={notice.desktopCopy}
          />
        )}
        {collapsible && (
          <>
            <div className="notice-actions">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => setExpanded(!expanded)}
              >
                <ChevronDown
                  size={13}
                  className={expanded ? "is-expanded" : undefined}
                  aria-hidden="true"
                />
                {expanded ? t("收起详情") : t("查看详情")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyDetails();
                }}
              >
                {feedback?.copied ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <Copy size={13} aria-hidden="true" />
                )}
                {feedback?.copied ? t("已复制") : t("复制详情")}
              </button>
            </div>
            {feedback?.copied === false && (
              <p className="notice-copy-error">
                {t("复制失败，请选择详情中的文本手动复制。")}
              </p>
            )}
            <div
              id={detailsId}
              hidden={!expanded}
              className="notice-diagnostics"
            >
              <StyledText
                {...(notice.presentation ?? { text: notice.message })}
              />
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        className="notice-close"
        aria-label={t("关闭通知")}
        onClick={onDismiss}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
