import type { DesktopSnapshot } from "../shared/types";
import type { DesktopSurface } from "../shared/desktop-ui";

// Transport snapshots are plain data with fresh object identities. Compare their
// contents without serializing the entire conversation on every keystroke.
export function sameTranscriptValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameTranscriptValue(value, right[index]))
    );
  }
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) => Object.hasOwn(b, key) && sameTranscriptValue(a[key], b[key]),
    )
  );
}

export function transcriptSurfaces(surfaces: DesktopSurface[]) {
  return surfaces.filter((surface) =>
    ["message", "entry", "tool"].includes(surface.slot),
  );
}

export function transcriptExtensionUI(ui: DesktopSnapshot["extensionUI"]) {
  return {
    hiddenThinkingLabel: ui.hiddenThinkingLabel,
    hiddenThinkingPresentation: ui.textPresentation?.hiddenThinkingLabel,
    workingVisible: ui.workingVisible,
    workingIndicator: ui.workingIndicator,
    workingMessage: ui.workingMessage,
    workingFrames: ui.textPresentation?.workingFrames,
    workingStatus: ui.textPresentation?.statuses.working,
  };
}
