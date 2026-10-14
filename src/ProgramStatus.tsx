import type { DesktopSnapshot } from "../shared/types";
import { t, useLocale } from "./i18n";

export function ProgramStatusIndicator({
  snapshot,
}: {
  snapshot: DesktopSnapshot;
}) {
  useLocale();
  const status = snapshot.extensionUI.programStatus;
  const state =
    status?.state === "blocked"
      ? "blocked"
      : snapshot.running
        ? "working"
        : status?.state;
  if (!state || state === "idle" || state === "clear") return null;
  const label =
    state === "blocked"
      ? status?.kind === "auth"
        ? t("等待登录")
        : status?.kind === "permission"
          ? t("等待确认")
          : t("等待输入")
      : state === "working"
        ? snapshot.compacting
          ? t("压缩中")
          : snapshot.retrying
            ? t("重试中")
            : t("执行中")
        : state === "error"
          ? t("失败")
          : t("完成");
  return (
    <span
      className={`status-tag ${state === "working" ? "running" : state}`}
      role="status"
      title={status?.message}
      data-program-state={state}
    >
      <span />
      {label}
    </span>
  );
}
