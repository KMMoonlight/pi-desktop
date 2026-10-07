import type { DesktopInputContext, DesktopInputResult } from "./desktop-ui.ts";

interface CommittedInput {
  context: DesktopInputContext;
  committedData?: string;
  optimisticText?: string;
  editor?: NonNullable<DesktopInputResult["editor"]>;
}

/** Rebase queued input onto the original component's confirmed result. */
export function committedInputContext<T extends DesktopInputContext>(
  context: T,
  previous?: CommittedInput,
): T {
  if (
    context.controlVersion !== undefined &&
    previous?.editor?.controlVersion !== undefined &&
    context.controlVersion > previous.editor.controlVersion
  )
    return context;
  const before = previous?.optimisticText,
    after = previous?.editor?.text;
  const followsCaret =
    previous?.editor?.controlVersion !== undefined &&
    (context.controlVersion ?? 0) <= previous.editor.controlVersion &&
    previous.context.selection !== undefined &&
    previous.committedData !== undefined &&
    context.selection?.start ===
      previous.context.selection.start + previous.committedData.length &&
    context.selection.end === context.selection.start;
  if (
    before !== undefined &&
    context.controlText === before &&
    previous?.editor?.controlVersion !== undefined
  )
    context = {
      ...context,
      controlVersion: Math.max(
        context.controlVersion ?? 0,
        previous.editor.controlVersion,
      ),
    };
  if (
    before === undefined ||
    after === undefined ||
    context.controlText !== before
  )
    return context;
  if (followsCaret)
    return {
      ...context,
      controlText: after,
      ...(context.editorText !== undefined ? { editorText: after } : {}),
      selection: previous!.editor!.selection,
    };
  if (before === after) return context;
  let start = 0,
    end = before.length,
    nextEnd = after.length;
  while (start < end && start < nextEnd && before[start] === after[start])
    start++;
  while (
    end > start &&
    nextEnd > start &&
    before[end - 1] === after[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  const position = (offset: number) =>
    offset <= start
      ? offset
      : offset >= end
        ? offset + nextEnd - end
        : start + Math.min(offset - start, nextEnd - start);
  return {
    ...context,
    controlText: after,
    ...(context.editorText !== undefined ? { editorText: after } : {}),
    ...(context.selection
      ? {
          selection: {
            start: position(context.selection.start),
            end: position(context.selection.end),
          },
        }
      : {}),
  };
}
