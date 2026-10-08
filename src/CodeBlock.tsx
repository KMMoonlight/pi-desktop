import { t, useLocale } from "./i18n";
import { useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "./ui";

export function CodeBlock({
  text,
  copyText,
  language,
  children,
}: {
  text: string;
  copyText?: string;
  language?: string;
  children: ReactNode;
}) {
  useLocale();
  const [copied, setCopied] = useState(false);
  const content = useRef<HTMLPreElement>(null);
  return (
    <div data-theme="dark" className="code-block overflow-hidden rounded-xl bg-code text-on-code">
      <div className="code-toolbar flex min-h-9 items-center justify-end border-b border-white/10 bg-code-raised px-2 text-code-muted">
        <IconButton
          icon={copied ? Check : Copy}
          label={language ? t("复制 {value1} 代码", { value1: language }) : t("复制代码")}
          onClick={() => {
            void navigator.clipboard
              .writeText(copyText ?? content.current?.textContent ?? text)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
          }}
        />
      </div>
      <pre ref={content}>{children}</pre>
    </div>
  );
}
