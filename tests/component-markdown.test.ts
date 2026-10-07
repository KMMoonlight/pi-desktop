import test from "node:test";
import assert from "node:assert/strict";
import { loadTuiApi } from "../backend/tui-api.ts";
import {
  loadComponentRuntime,
  withComponentMarkdownLinks,
} from "../backend/component-runtime.ts";
import { componentMarkdown } from "../backend/component-markdown.ts";
import type { DesktopMarkdownBlock } from "../shared/desktop-ui.ts";

const identity = (text: string) => text;
const theme = Object.fromEntries(
  [
    "heading",
    "link",
    "linkUrl",
    "code",
    "codeBlock",
    "codeBlockBorder",
    "quote",
    "quoteBorder",
    "hr",
    "listBullet",
    "bold",
    "italic",
    "strikethrough",
    "underline",
  ].map((name) => [name, identity]),
);
const color = (red: number, green: number, blue: number) => (text: string) =>
  `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`;
async function markdown(
  text: string,
  overrides: object = {},
  options?: object,
) {
  const api = await loadTuiApi();
  const Markdown = Reflect.get(api, "Markdown");
  return new Markdown(
    text,
    1,
    0,
    { ...theme, ...overrides },
    undefined,
    options,
  );
}
function flatten(blocks: DesktopMarkdownBlock[]): DesktopMarkdownBlock[] {
  return blocks.flatMap((block) => [
    block,
    ...(block.kind === "quote"
      ? flatten(block.children)
      : block.kind === "list"
        ? block.items.flatMap((item) => flatten(item.children))
        : []),
  ]);
}

test("Markdown email and telephone links retain original labels and themes", async () => {
  const api = (await loadComponentRuntime()).text;
  const component = await markdown(
    "[Email](mailto:pi@example.invalid?subject=Hello%20Pi) and [Call](tel:+15550123456) and [App](obsidian://open?vault=Notes&file=hello%20world)",
    { link: color(12, 34, 56) },
  );
  const block = componentMarkdown(component, 80, api).blocks[0];
  assert.ok(block.kind === "paragraph");
  const links = block.runs?.filter((run) => run.href);
  assert.deepEqual(
    links?.map((run) => run.href),
    [
      "mailto:pi@example.invalid?subject=Hello%20Pi",
      "tel:+15550123456",
      "obsidian://open?vault=Notes&file=hello%20world",
    ],
  );
  assert.ok(links?.every((run) => run.style?.color === "rgb(12, 34, 56)"));
});

test("Markdown uses Pi tokens, original theme transformations, code highlighting and semantic blocks", async () => {
  const api = (await loadComponentRuntime()).text;
  const seen: [string, string | undefined][] = [];
  const component = await markdown(
    "# Title\n\nNormal **bold** and `inline`\n\n> Quote\n\n7) List\n8) Next\n\n| Head | Other |\n| :--- | ---: |\n| Cell | Value |\n\n```js\nlet value = 1;\n```\n\n---",
    {
      heading: (text: string) =>
        color(11, 22, 33)(text.replace("Title", "TITLE")),
      bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
      italic: (text: string) => `\x1b[3m${text}\x1b[23m`,
      code: color(44, 55, 66),
      quote: color(77, 88, 99),
      quoteBorder: color(101, 102, 103),
      listBullet: color(104, 105, 106),
      hr: color(107, 108, 109),
      codeBlockBorder: color(110, 111, 112),
      highlightCode: (code: string, lang?: string) => {
        seen.push([code, lang]);
        return [color(113, 114, 115)(code.toUpperCase())];
      },
    },
    { preserveOrderedListMarkers: true },
  );
  const mapped = componentMarkdown(component, 60, api);
  const blocks = flatten(mapped.blocks);
  const heading = blocks.find((block) => block.kind === "heading");
  assert.ok(heading?.kind === "heading");
  assert.equal(heading.text, "TITLE");
  assert.equal(
    heading.runs?.find((run) => run.text === "TITLE")?.style?.color,
    "rgb(11, 22, 33)",
  );
  const paragraph = blocks.find(
    (block) => block.kind === "paragraph" && block.text.startsWith("Normal"),
  );
  assert.ok(paragraph?.kind === "paragraph");
  assert.equal(
    paragraph.runs?.find((run) => run.text === "bold")?.style?.fontWeight,
    "bold",
  );
  assert.equal(
    paragraph.runs?.find((run) => run.text === "inline")?.style?.color,
    "rgb(44, 55, 66)",
  );
  const quote = blocks.find((block) => block.kind === "quote");
  assert.ok(quote?.kind === "quote");
  assert.equal(quote.borderStyle?.color, "rgb(101, 102, 103)");
  const quoted = quote.children[0];
  assert.ok(quoted.kind === "paragraph");
  assert.equal(quoted.runs?.[0].style?.color, "rgb(77, 88, 99)");
  assert.equal(quoted.runs?.[0].style?.fontStyle, "italic");
  const list = blocks.find((block) => block.kind === "list");
  assert.ok(list?.kind === "list");
  assert.equal(list.start, 7);
  assert.equal(list.items[0].marker.text, "7) ");
  assert.equal(
    list.items[0].marker.runs?.[0].style?.color,
    "rgb(104, 105, 106)",
  );
  const table = blocks.find((block) => block.kind === "table");
  assert.ok(table?.kind === "table");
  assert.deepEqual(table.align, ["left", "right"]);
  assert.equal(table.headers[0].runs?.[0].style?.fontWeight, "bold");
  const code = blocks.find((block) => block.kind === "code");
  assert.ok(code?.kind === "code");
  assert.equal(code.language, "js");
  assert.equal(code.text, "  LET VALUE = 1;");
  assert.equal(
    code.runs?.find((run) => run.text === "LET VALUE = 1;")?.style?.color,
    "rgb(113, 114, 115)",
  );
  assert.ok(
    seen.every(([text, lang]) => text === "let value = 1;" && lang === "js"),
  );
  assert.equal(code.opening.runs?.[0].style?.color, "rgb(110, 111, 112)");
  const rule = blocks.find((block) => block.kind === "divider");
  assert.ok(rule?.kind === "divider");
  assert.equal(rule.style?.color, "rgb(107, 108, 109)");
});

test("Markdown links keep native callbacks, nested styles and safe link targets without changing Pi instances", async () => {
  const api = (await loadComponentRuntime()).text;
  const links: string[] = [];
  const component = await markdown(
    "**[First](https://example.com/first)** and [Second](https://example.com/second)\n\n<script>literal</script>",
    {
      link: (text: string) => {
        links.push(text);
        return color(12, 34, 56)(text);
      },
      bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    },
  );
  const originalTheme = Reflect.get(component, "theme");
  const result = componentMarkdown(component, 60, api);
  assert.equal(Reflect.get(component, "theme"), originalTheme);
  const paragraph = result.blocks[0];
  assert.ok(paragraph.kind === "paragraph");
  const first = paragraph.runs?.find((run) => run.text === "First");
  assert.equal(first?.href, "https://example.com/first");
  assert.equal(first?.style?.fontWeight, "bold");
  assert.equal(first?.style?.color, "rgb(12, 34, 56)");
  assert.equal(
    paragraph.runs?.find((run) => run.text === "Second")?.href,
    "https://example.com/second",
  );
  assert.ok(links.includes("First") && links.includes("Second"));
  const html = result.blocks[1];
  assert.ok(html.kind === "paragraph");
  assert.equal(html.text, "<script>literal</script>");
  assert.throws(
    () =>
      withComponentMarkdownLinks(
        component,
        [{ type: "link", href: "https://example.com" }],
        () => {
          throw new Error("original failure");
        },
      ),
    /original failure/,
  );
  assert.equal(Reflect.get(component, "theme"), originalTheme);
});

test("Markdown retains source options, strict strikethrough, ANSI, weak token cache recovery and blank transforms", async () => {
  const api = (await loadComponentRuntime()).text;
  const widths: number[] = [];
  const component = await markdown(
    "unused",
    {
      strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`,
    },
    {
      preserveBackslashEscapes: true,
      renderLatex: false,
      transform: (_text: string, width: number) => {
        widths.push(width);
        return "\\*escaped\\* ~~strike~~\n\n$\\alpha$\n\n\x1b[38;2;21;43;65mANSI\x1b[39m";
      },
    },
  );
  let result = componentMarkdown(component, 30, api);
  assert.equal(widths.at(-1), 28);
  const paragraph = result.blocks[0];
  assert.ok(paragraph.kind === "paragraph");
  assert.equal(paragraph.text, "\\*escaped\\* strike");
  assert.equal(
    paragraph.runs?.find((run) => run.text === "strike")?.style
      ?.textDecorationLine,
    "line-through",
  );
  const latex = result.blocks[1];
  assert.ok(latex.kind === "paragraph");
  assert.equal(latex.text, "$\\alpha$");
  const ansi = result.blocks[2];
  assert.ok(ansi.kind === "paragraph");
  assert.equal(ansi.runs?.[0].style?.color, "rgb(21, 43, 65)");
  Reflect.set(component, "cachedTokens", { deref: () => undefined });
  result = componentMarkdown(component, 30, api);
  assert.equal(result.blocks.length, 3);
  result = componentMarkdown(component, 14, api);
  assert.equal(widths.at(-1), 12);
  Reflect.set(component, "options", { transform: () => "   " });
  component.invalidate();
  result = componentMarkdown(component, 14, api);
  assert.deepEqual(result, { text: "", blocks: [] });
});
