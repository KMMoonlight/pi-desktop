import type { TranslationKey } from "./i18n";
import { httpNoticeError } from "../shared/notices";

// Error bodies remain intact in the details. Only recognized HTTP status codes
// determine the short, owned copy shown above them.
export function retryNoticeSummary(message: string): {
  title: TranslationKey;
  status?: number;
} {
  const status = httpNoticeError(message)?.status;
  const title: TranslationKey =
    status === 429
      ? "请求过于频繁"
      : status === 401 || status === 403
        ? "请求被服务拒绝"
        : status && status >= 500
          ? "服务暂时不可用"
          : "请求暂时失败";
  return { title, status };
}
