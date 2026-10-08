import { decodeString } from "micromark-util-decode-string";
import type {
  DesktopMarkdownText,
  DesktopTextRun,
} from "../shared/desktop-ui.ts";
import { desktopExternalLink, desktopFileReference } from "../shared/links.ts";
import {
  componentField as field,
  requiredComponentField as required,
  callComponentMethod,
  type PiComponent,
  type loadComponentRuntime,
} from "./component-runtime.ts";
import { componentText } from "./component-text.ts";

export type InlineContext = {
  applyText(text: string): string;
  stylePrefix: string;
};
type TextApi = Awaited<ReturnType<typeof loadComponentRuntime>>["text"];
const identity = (text: string) => text;
const string = (value: unknown) => (typeof value === "string" ? value : "");
const children = (token: object): object[] => {
  const tokens = field(token, "tokens");
  return Array.isArray(tokens) ? tokens : [];
};

// Decode text tokens, never source, code or escaped literals. Decoding before
// parsing would turn &lt;script&gt; and &#35; into different Markdown syntax.
export function markdownEntities(value: string): string {
  return value.replace(
    /&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi,
    (raw) => decodeString(raw),
  );
}

/** Keep Pi's leaf rendering and theme callbacks; retain DOM-only inline semantics. */
export function componentMarkdownInline(
  target: PiComponent,
  tokens: object[],
  api: TextApi,
  context?: InlineContext,
  decorate = identity,
): DesktopMarkdownText {
  const theme = required(target, "theme") as object;
  const themed = (key: string, value: string) =>
    Reflect.apply(required(theme, key) as (text: string) => string, theme, [
      value,
    ]);
  const chunks: {
    value: string;
    href?: string;
    code?: boolean;
    image?: DesktopTextRun["image"];
  }[] = [];
  const visit = (
    values: object[],
    wrap: (value: string) => string,
    href?: string,
  ) => {
    for (const token of values) {
      const type = field(token, "type");
      const nested = children(token);
      if (["strong", "em", "del"].includes(String(type))) {
        const key =
          type === "strong"
            ? "bold"
            : type === "em"
              ? "italic"
              : "strikethrough";
        visit(nested, (value) => wrap(themed(key, value)), href);
        continue;
      }
      if ((type === "text" || type === "paragraph") && nested.length) {
        visit(nested, wrap, href);
        continue;
      }
      if (type === "link") {
        const destination = markdownEntities(string(field(token, "href")));
        const safe =
          desktopExternalLink(destination) ??
          (desktopFileReference(destination) ? destination : undefined);
        visit(
          nested,
          (value) => wrap(themed("link", themed("underline", value))),
          safe,
        );
        continue;
      }
      const leaf =
        type === "text" || type === "image"
          ? { ...token, text: markdownEntities(string(field(token, "text"))) }
          : token;
      const value = string(
        callComponentMethod(target, "renderInlineTokens", [leaf], context),
      );
      const rendered =
        type === "codespan" && context ? context.applyText(value) : value;
      const image =
        type === "image"
          ? {
              src: markdownEntities(string(field(token, "href"))),
              alt: markdownEntities(string(field(token, "text"))),
            }
          : undefined;
      chunks.push({
        value: decorate(wrap(rendered)),
        ...(href ? { href } : {}),
        ...(type === "codespan" ? { code: true } : {}),
        ...(image ? { image } : {}),
      });
    }
  };
  visit(tokens, identity);
  // Parse the complete ANSI stream once. Extension colors can start in a text
  // token and end after emphasis/code; resetting the parser per token loses them.
  const styled = componentText(
    chunks.map((chunk) => chunk.value).join(""),
    api,
  );
  const styledRuns = styled.runs ?? [{ text: styled.text }];
  const runs: DesktopTextRun[] = [];
  let index = 0;
  let offset = 0;
  for (const chunk of chunks) {
    let remaining = componentText(chunk.value, api).text.length;
    if (chunk.image) runs.push({ text: chunk.image.alt, image: chunk.image });
    while (remaining > 0 && index < styledRuns.length) {
      const run = styledRuns[index];
      const length = Math.min(remaining, run.text.length - offset);
      if (!chunk.image && length)
        runs.push({
          ...run,
          text: run.text.slice(offset, offset + length),
          ...(chunk.href ? { href: chunk.href } : {}),
          ...(chunk.code ? { code: true } : {}),
        });
      remaining -= length;
      offset += length;
      if (offset === run.text.length) {
        index++;
        offset = 0;
      }
    }
  }
  const text = runs.map((run) => run.text).join("");
  return {
    text,
    ...(runs.some(
      (run) => run.style || run.href || run.code || run.image || run.blink,
    )
      ? { runs }
      : {}),
  };
}
