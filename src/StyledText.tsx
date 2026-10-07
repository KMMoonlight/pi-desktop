import type { DesktopTextRun } from "../shared/desktop-ui";
import { localizeText, useLocale } from "./i18n";
import { DesktopLink } from "./DesktopLink";

export function StyledText({
  text,
  runs,
  desktopCopy,
}: {
  text: string;
  runs?: DesktopTextRun[];
  desktopCopy?: boolean;
}) {
  useLocale();
  if (desktopCopy) {
    const localized = localizeText(text);
    if (localized !== text) return <span style={runs?.[0]?.style}>{localized}</span>;
  }
  if (!runs) return <>{text}</>;
  return (
    <>
      {runs.map((run, index) => {
        const lines = run.style?.textDecorationLine?.split(" ") ?? [];
        const otherLines = lines.filter((line) => line !== "underline");
        const separateUnderline =
          lines.includes("underline") &&
          otherLines.length > 0 &&
          (run.style?.textDecorationStyle || run.style?.textDecorationColor);
        const presentation = {
          style: separateUnderline
            ? {
                ...run.style,
                textDecorationLine: otherLines.join(" "),
                textDecorationStyle: undefined,
                textDecorationColor: undefined,
              }
            : run.style,
          className: run.blink ? "desktop-text-blink" : undefined,
        };
        const content = separateUnderline ? (
          <span
            style={{
              textDecorationLine: "underline",
              textDecorationStyle: run.style?.textDecorationStyle,
              textDecorationColor: run.style?.textDecorationColor,
            }}
          >
            {run.text}
          </span>
        ) : (
          run.text
        );
        return run.href ? (
          <DesktopLink key={index} {...presentation} href={run.href}>
            {content}
          </DesktopLink>
        ) : (
          <span key={index} {...presentation}>
            {content}
          </span>
        );
      })}
    </>
  );
}
