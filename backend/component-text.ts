import type Anser from "anser";
import { ComponentSgr } from "./component-sgr.ts";
import { desktopExternalLink, desktopFileReference } from "../shared/links.ts";
import type { DesktopTextRun, DesktopTextStyle } from "../shared/desktop-ui.ts";
import type { loadComponentRuntime } from "./component-runtime.ts";

type TextApi = Awaited<ReturnType<typeof loadComponentRuntime>>["text"];

const namedColors = new Map<string, number>(
  [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
  ].flatMap(
    (name, index) =>
      [
        [`ansi-${name}`, index],
        [`ansi-bright-${name}`, index + 8],
      ] as const,
  ),
);

function color(value: string, rgb: string, api: TextApi) {
  if (!value) return undefined;
  if (value === "ansi-truecolor") return rgb ? `rgb(${rgb})` : undefined;
  const index =
    namedColors.get(value) ??
    (/^ansi-palette-(\d+)$/.exec(value)?.[1] !== undefined
      ? Number(value.slice("ansi-palette-".length))
      : undefined);
  return index !== undefined
    ? api.colorToHex({ kind: "indexed", index })
    : undefined;
}

function style(
  entry: Anser.AnserJsonEntry,
  api: TextApi,
  sgr: ComponentSgr,
): DesktopTextStyle | undefined {
  const decorations = new Set(entry.decorations);
  let foreground = color(entry.fg, entry.fg_truecolor, api);
  let backgroundColor = color(entry.bg, entry.bg_truecolor, api);
  if (decorations.has("reverse")) {
    [foreground, backgroundColor] = [
      backgroundColor ?? "var(--desktop-text-background, var(--page))",
      foreground ?? "var(--desktop-text-foreground, var(--text))",
    ];
  }
  const textDecorationLine = [
    ...(decorations.has("underline") ? ["underline"] : []),
    ...(decorations.has("strikethrough") ? ["line-through"] : []),
    ...(sgr.overline ? ["overline"] : []),
  ].join(" ");
  const result: DesktopTextStyle = {
    ...(foreground ? { color: foreground } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(decorations.has("bold") ? { fontWeight: "bold" } : {}),
    ...(decorations.has("italic") ? { fontStyle: "italic" } : {}),
    ...(decorations.has("dim") ? { opacity: 0.6 } : {}),
    ...(decorations.has("hidden") ? { visibility: "hidden" } : {}),
    ...(textDecorationLine ? { textDecorationLine } : {}),
    ...(decorations.has("underline") && sgr.underlineStyle
      ? { textDecorationStyle: sgr.underlineStyle }
      : {}),
    ...(decorations.has("underline") && sgr.underlineColor
      ? { textDecorationColor: sgr.underlineColor }
      : {}),
  };
  return Object.keys(result).length ? result : undefined;
}

export function componentText(value: string, api: TextApi) {
  if (!value.includes("\x1b")) return { text: value };
  const parser = new ComponentSgr((index) =>
    api.colorToHex({ kind: "indexed", index }),
  );
  let text = "";
  let href: string | undefined;
  let presentation: DesktopTextStyle | undefined;
  let blink = false;
  const runs: DesktopTextRun[] = [];
  for (let index = 0; index < value.length;) {
    const ansi = api.extractAnsiCode(value, index);
    if (ansi) {
      if (/^\x1b\[[\d;:]*m$/.test(ansi.code)) {
        // Raw parser state retains default colors for desktop-aware reverse styling.
        const entry = parser.process(ansi.code);
        presentation = style(entry, api, parser);
        blink = entry.decorations.includes("blink");
      } else if (ansi.code.startsWith("\x1b]8;")) {
        const url = api.getOsc8LinkAtColumn(`${ansi.code}x`, 0);
        href = url
          ? (desktopExternalLink(url) ??
            (desktopFileReference(url) ? url : undefined))
          : undefined;
      }
      index += ansi.length;
      continue;
    }
    let end = index + 1;
    while (end < value.length && !api.extractAnsiCode(value, end)) end++;
    const content = value.slice(index, end);
    runs.push({
      text: content,
      ...(presentation ? { style: presentation } : {}),
      ...(href ? { href } : {}),
      ...(blink ? { blink: true } : {}),
    });
    text += content;
    index = end;
  }
  return {
    text,
    ...(runs.some((run) => run.style || run.href || run.blink) ? { runs } : {}),
  };
}

export function componentBackground(value: unknown, api: TextApi) {
  if (typeof value !== "function") return undefined;
  const result = componentText(value(" "), api).runs?.find(
    (run) => run.style?.backgroundColor,
  )?.style?.backgroundColor;
  return result ? { backgroundColor: result } : undefined;
}

export function componentLabel(value: string, api: TextApi) {
  const { text, runs } = componentText(value, api);
  return { label: text, ...(runs ? { labelRuns: runs } : {}) };
}

export function componentTextStyle(value: string, api: TextApi) {
  return componentText(value, api).runs?.find((run) => run.text.trim())?.style;
}
