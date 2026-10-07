import { t, useLocale } from "./i18n";
import { useEffect, useState } from "react";

export function DialogCountdown({ expiresAt }: { expiresAt?: number }) {
  useLocale();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (expiresAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (expiresAt === undefined) return null;
  return (
    <span role="timer" aria-label={t("自动关闭倒计时")}>
      {t("（{value1} 秒）", { value1: Math.max(0, Math.ceil((expiresAt - now) / 1000)) })}
    </span>
  );
}
