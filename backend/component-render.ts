import type {
  DesktopMarkdownText,
  DesktopRenderAdditions,
} from "../shared/desktop-ui.ts";
import type { loadComponentRuntime } from "./component-runtime.ts";
import { componentText } from "./component-text.ts";

type Runtime = Awaited<ReturnType<typeof loadComponentRuntime>>;
export interface ComponentRenderRange {
  child: number;
  start: number;
  length: number;
  interactive?: boolean;
  column?: number;
  columns?: number;
  contentRow?: number;
}

export function componentRenderLines(
  lines: string[],
  runtime: Pick<Runtime, "text">,
  cursorMarker: string,
): DesktopMarkdownText[] {
  if (!lines.length) return [];
  // Parse one frame so SGR and OSC 8 state survives line breaks.
  const parsed = componentText(
    lines.map((line) => line.split(cursorMarker).join("")).join("\n"),
    runtime.text,
  );
  const result: DesktopMarkdownText[] = parsed.text
    .split("\n")
    .map((text) => ({ text }));
  let row = 0;
  for (const run of parsed.runs ?? []) {
    const parts = run.text.split("\n");
    for (let index = 0; index < parts.length; index++) {
      if (parts[index])
        (result[row].runs ??= []).push({ ...run, text: parts[index] });
      if (index < parts.length - 1) row++;
    }
  }
  return result.map((line) =>
    line.runs?.some((run) => run.style || run.href || run.blink)
      ? line
      : { text: line.text },
  );
}

function borderLabel(
  line: DesktopMarkdownText,
): DesktopMarkdownText | undefined {
  const clean = (text: string) => text.replace(/\u2500+/g, " ");
  const text = clean(line.text).trim();
  if (!text) return undefined;
  const runs = line.runs?.map((run) => ({ ...run, text: clean(run.text) }));
  if (runs?.length) {
    runs[0].text = runs[0].text.trimStart();
    runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
  }
  return { text, ...(runs ? { runs } : {}) };
}

/** Preserve known child ownership while composing a custom vertical frame. */
export function componentRenderComposition(
  baseline: string[],
  original: string[],
  ranges: ComponentRenderRange[],
  runtime: Pick<Runtime, "text" | "diff">,
  cursorMarker: string,
):
  | (DesktopRenderAdditions & {
      childRanges?: ComponentRenderRange[];
      partialChildren?: (ComponentRenderRange & {
        lines: DesktopMarkdownText[];
        sourceStart: number;
        sourceLength: number;
      })[];
    })
  | undefined {
  const base = componentRenderLines(baseline, runtime, cursorMarker);
  const actual = componentRenderLines(original, runtime, cursorMarker);
  const same = (left: DesktopMarkdownText, right: DesktopMarkdownText) =>
    JSON.stringify(left) === JSON.stringify(right);
  if (!actual.length)
    return { before: [], after: [], replacement: [], childRanges: [] };
  const bodyStart = actual.findIndex((_line, start) =>
    base.every((line, index) => same(line, actual[start + index])),
  );
  if (bodyStart >= 0)
    return {
      ...(componentRenderAdditions(
        baseline,
        original,
        runtime,
        cursorMarker,
        false,
      ) ?? { before: [], after: [] }),
      childRanges: ranges.map((range) => ({
        ...range,
        start: range.start + bodyStart,
      })),
    };
  const unchanged = new Map<number, number>();
  let from = 0,
    to = 0;
  const changes = runtime.diff.diffArrays(base, actual, {
    comparator: same,
  });
  for (const change of changes) {
    if (change.removed) from += change.value.length;
    else if (change.added) to += change.value.length;
    else
      for (let row = 0; row < change.value.length; row++)
        unchanged.set(from++, to++);
  }
  const selected = new Map<number, ComponentRenderRange>();
  const occupied = new Set<number>();
  const accept = (range: ComponentRenderRange, start: number) => {
    selected.set(start, range);
    for (let row = 0; row < range.length; row++) occupied.add(start + row);
  };
  const candidates = ranges.filter(
    (range) => range.length > 0 && range.start + range.length <= base.length,
  );
  // Diff matches disambiguate unchanged occurrences before considering moved children.
  const moved: ComponentRenderRange[] = [];
  for (const range of candidates) {
    const start = unchanged.get(range.start);
    if (
      start !== undefined &&
      Array.from(
        { length: range.length },
        (_, row) => unchanged.get(range.start + row) === start + row,
      ).every(Boolean)
    )
      accept(range, start);
    else moved.push(range);
  }
  for (const range of moved.sort((left, right) => right.length - left.length)) {
    for (let start = 0; start + range.length <= actual.length; start++) {
      if (
        Array.from(
          { length: range.length },
          (_, row) =>
            !occupied.has(start + row) &&
            same(base[range.start + row], actual[start + row]),
        ).every(Boolean)
      ) {
        accept(range, start);
        break;
      }
    }
  }
  const baseOwners = new Map<number, ComponentRenderRange>();
  for (const range of candidates)
    for (let row = 0; row < range.length; row++)
      baseOwners.set(range.start + row, range);
  const actualOwners = new Map<number, ComponentRenderRange>();
  for (const [before, after] of unchanged) {
    const owner = baseOwners.get(before);
    if (owner) actualOwners.set(after, owner);
  }
  // Only attribute changed runs when the original range has a single owner.
  from = 0;
  to = 0;
  for (let index = 0; index < changes.length;) {
    const change = changes[index];
    if (!change.added && !change.removed) {
      from += change.value.length;
      to += change.value.length;
      index++;
      continue;
    }
    const before = from,
      after = to;
    while (index < changes.length) {
      const next = changes[index];
      if (!next.added && !next.removed) break;
      if (next.removed) from += next.value.length;
      else to += next.value.length;
      index++;
    }
    const owner =
      from === before
        ? candidates.find(
            (range) =>
              before > range.start && before < range.start + range.length,
          )
        : baseOwners.get(before);
    if (
      owner &&
      Array.from(
        { length: from - before },
        (_, row) => baseOwners.get(before + row) === owner,
      ).every(Boolean)
    )
      for (let row = after; row < to; row++) actualOwners.set(row, owner);
  }
  const partialChildren: (ComponentRenderRange & {
    lines: DesktopMarkdownText[];
    sourceStart: number;
    sourceLength: number;
  })[] = [];
  const complete = new Set([...selected.values()].map((range) => range.child));
  for (const range of candidates) {
    if (!range.interactive || complete.has(range.child)) continue;
    const rows = [...actualOwners]
      .filter(([, owner]) => owner === range)
      .map(([row]) => row);
    if (!rows.length) continue;
    const start = Math.min(...rows),
      end = Math.max(...rows) + 1;
    if (
      Array.from({ length: end - start }, (_, offset) => {
        const row = start + offset;
        return (
          !occupied.has(row) &&
          (!actualOwners.has(row) || actualOwners.get(row) === range)
        );
      }).every(Boolean)
    ) {
      const partial = { ...range, start, length: end - start };
      accept(partial, start);
      partialChildren.push({
        ...partial,
        sourceStart: range.start,
        sourceLength: range.length,
        lines: actual.slice(start, end),
      });
    }
  }
  if (!selected.size)
    return { before: [], after: [], replacement: actual, childRanges: [] };
  const bodyRows = new Set(
    candidates.flatMap((range) =>
      Array.from({ length: range.length }, (_, row) => range.start + row),
    ),
  );
  const layoutRows = new Set(
    [...unchanged]
      .filter(([row]) => !bodyRows.has(row) && !base[row].text.trim())
      .map(([, row]) => row),
  );
  const composition: NonNullable<DesktopRenderAdditions["composition"]> = [];
  for (let row = 0; row < actual.length;) {
    const child = selected.get(row);
    if (child) {
      composition.push({ child: child.child });
      row += child.length;
    } else if (layoutRows.has(row)) row++;
    else {
      const previous = composition[composition.length - 1];
      if (previous && "lines" in previous) previous.lines.push(actual[row++]);
      else composition.push({ lines: [actual[row++]] });
    }
  }
  return {
    before: [],
    after: [],
    composition,
    childRanges: [...selected].map(([start, range]) => ({ ...range, start })),
    ...(partialChildren.length ? { partialChildren } : {}),
  };
}

/** Retain subclass rendering while preserving mapped component ownership. */
export function componentRenderAdditions(
  baseline: string[],
  original: string[],
  runtime: Pick<Runtime, "text" | "diff">,
  cursorMarker: string,
  editor: boolean,
  replaceContent = false,
  borderRows: number[] = [],
): DesktopRenderAdditions | undefined {
  if (!original.length) return { before: [], after: [], replacement: [] };
  const base = componentRenderLines(baseline, runtime, cursorMarker);
  const actual = componentRenderLines(original, runtime, cursorMarker);
  const same = (left: DesktopMarkdownText, right: DesktopMarkdownText) =>
    JSON.stringify(left) === JSON.stringify(right);
  if (
    replaceContent &&
    !editor &&
    base.length &&
    !actual.some((_line, start) =>
      base.every((line, index) => same(line, actual[start + index])),
    )
  )
    return { before: [], after: [], replacement: actual };
  const additions: DesktopRenderAdditions = { before: [], after: [] };
  let row = 0;
  let removed: DesktopMarkdownText[] = [];
  for (const change of runtime.diff.diffArrays(base, actual, {
    comparator: same,
  })) {
    if (change.removed) {
      if (
        replaceContent &&
        change.value.some(
          (_line, index) => !editor || !borderRows.includes(row + index),
        )
      )
        return { before: [], after: [], replacement: actual };
      removed = change.value;
      row += change.value.length;
    } else if (change.added) {
      const destination =
        row <= (editor ? 1 : 0) ? additions.before : additions.after;
      for (const line of change.value) {
        const border =
          editor && removed.some((item) => item.text.includes("\u2500"));
        const addition = border ? borderLabel(line) : line;
        if (addition) destination.push(addition);
      }
      removed = [];
    } else {
      row += change.value.length;
      removed = [];
    }
  }
  return additions.before.length || additions.after.length
    ? additions
    : undefined;
}
