import type {
  DesktopMarkdownBlock,
  DesktopTextStyle,
} from "../shared/desktop-ui.ts";
import {
  componentField as field,
  requiredComponentField as required,
  callComponentMethod,
  componentMarkdownSource,
  withComponentMarkdownLinks,
  type PiComponent,
  type loadComponentRuntime,
} from "./component-runtime.ts";
import { componentText } from "./component-text.ts";

type TextApi = Awaited<ReturnType<typeof loadComponentRuntime>>["text"];
type InlineContext = { applyText(text: string): string; stylePrefix: string };
const objects = (value: unknown): object[] =>
  Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object")
    : [];
const string = (value: unknown) => (typeof value === "string" ? value : "");

/** Reuse Pi's parser and theme renderer, retaining semantic block structure for DOM layout. */
export function componentMarkdown(
  target: PiComponent,
  width: number,
  api: TextApi,
) {
  const source = componentMarkdownSource(target, width);
  const theme = required(target, "theme") as object;
  const options = required(target, "options") as object;
  const themeText = (name: string, text: string): string => {
    const transform = required(theme, name) as (text: string) => string;
    return Reflect.apply(transform, theme, [text]);
  };
  const inline = (tokens: object[], context?: InlineContext) =>
    withComponentMarkdownLinks(target, tokens, () =>
      string(
        callComponentMethod(target, "renderInlineTokens", tokens, context),
      ),
    );
  const render = (token: object, context?: InlineContext) =>
    withComponentMarkdownLinks(target, [token], () => {
      const lines = callComponentMethod(
        target,
        "renderToken",
        token,
        width,
        undefined,
        context,
      );
      if (
        !Array.isArray(lines) ||
        lines.some((line) => typeof line !== "string")
      )
        throw new Error("Pi Markdown renderer returned invalid lines");
      return lines as string[];
    });
  const firstStyle = (value: string): DesktopTextStyle | undefined =>
    componentText(value, api).runs?.find((run) => run.text.trim())?.style;
  const blocks = (
    tokens: object[],
    context?: InlineContext,
    decorate: (text: string) => string = (text) => text,
  ): DesktopMarkdownBlock[] => {
    const text = (value: string) => componentText(decorate(value), api);
    return tokens.flatMap((token): DesktopMarkdownBlock[] => {
      const type = field(token, "type");
      switch (type) {
        case "space":
          return [];
        case "heading":
          return [
            {
              kind: "heading",
              depth: Number(field(token, "depth")),
              ...text(render(token, context).join("\n")),
            },
          ];
        case "paragraph":
        case "text": {
          const tokens =
            type === "text" ? [token] : objects(field(token, "tokens"));
          const preformatted =
            tokens.some((item) => field(item, "type") === "codespan") &&
            tokens.every(
              (item) =>
                field(item, "type") === "codespan" ||
                field(item, "type") === "br" ||
                (field(item, "type") === "text" &&
                  !string(field(item, "text")).trim()),
            );
          return [
            {
              kind: "paragraph",
              ...(preformatted ? { preformatted: true } : {}),
              ...text(
                inline(
                  type === "text" ? [token] : objects(field(token, "tokens")),
                  context,
                ),
              ),
            },
          ];
        }
        case "code": {
          const lines = render(token, context);
          return [
            {
              kind: "code",
              language: string(field(token, "lang")) || undefined,
              copyText: string(field(token, "text")),
              opening: text(lines[0] ?? ""),
              closing: text(lines.at(-1) ?? ""),
              ...text(lines.slice(1, -1).join("\n")),
            },
          ];
        }
        case "blockquote": {
          const quote = (value: string) =>
            themeText("quote", themeText("italic", value));
          const prefix = string(
            callComponentMethod(target, "getStylePrefix", quote),
          );
          const quoted = (value: string) =>
            decorate(
              value
                .split("\n")
                .map((line) =>
                  quote(
                    prefix
                      ? line.replace(/\x1b\[0m/g, `\x1b[0m${prefix}`)
                      : line,
                  ),
                )
                .join("\n"),
            );
          return [
            {
              kind: "quote",
              children: blocks(
                objects(field(token, "tokens")),
                { applyText: (value) => value, stylePrefix: prefix },
                quoted,
              ),
              borderStyle: firstStyle(
                decorate(themeText("quoteBorder", "\u2502 ")),
              ),
            },
          ];
        }
        case "list": {
          const ordered = !!field(token, "ordered");
          const start =
            typeof field(token, "start") === "number"
              ? Number(field(token, "start"))
              : 1;
          return [
            {
              kind: "list",
              ordered,
              start,
              items: objects(field(token, "items")).map((item, index) => {
                const preserved = field(options, "preserveOrderedListMarkers")
                  ? callComponentMethod(
                      target,
                      ordered
                        ? "getOrderedListMarker"
                        : "getUnorderedListMarker",
                      item,
                    )
                  : undefined;
                const marker =
                  string(preserved) || (ordered ? `${start + index}. ` : "- ");
                const task = field(item, "task")
                  ? `[${field(item, "checked") ? "x" : " "}] `
                  : "";
                return {
                  marker: text(themeText("listBullet", marker + task)),
                  children: blocks(
                    objects(field(item, "tokens")),
                    context,
                    decorate,
                  ),
                };
              }),
            },
          ];
        }
        case "table":
          return [
            {
              kind: "table",
              headers: objects(field(token, "header")).map((cell) =>
                text(
                  themeText(
                    "bold",
                    inline(objects(field(cell, "tokens")), context),
                  ),
                ),
              ),
              rows: (field(token, "rows") as unknown[]).map((row) =>
                objects(row).map((cell) =>
                  text(inline(objects(field(cell, "tokens")), context)),
                ),
              ),
              align: (field(token, "align") as unknown[]).map((value) =>
                value === "left" || value === "center" || value === "right"
                  ? value
                  : null,
              ),
            },
          ];
        case "hr":
          return [
            {
              kind: "divider",
              style: firstStyle(render(token, context).join("\n")),
            },
          ];
        default: {
          const lines = render(token, context);
          return lines.length
            ? [{ kind: "paragraph", ...text(lines.join("\n")) }]
            : [];
        }
      }
    });
  };
  return {
    text: componentText(source.source, api).text,
    blocks: blocks(source.tokens),
  };
}
