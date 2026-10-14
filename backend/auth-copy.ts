import {
  desktopKeyFromId,
  desktopKeyId,
  encodeDesktopKey,
} from "../shared/keyboard.ts";
import type { DesktopKeybindings } from "./tui-api.ts";

/** Browser candidates are matched by Pi, including shifted symbols and remapped keys. */
export function authCopyKeys(keys: DesktopKeybindings): string[] {
  const matches = new Set<string>();
  for (const binding of keys.getKeys("app.message.copy")) {
    const candidate = desktopKeyFromId(
      binding.replace(
        /(^|\+)(esc|return)$/,
        (_, prefix, key) => `${prefix}${key === "esc" ? "escape" : "enter"}`,
      ),
    );
    if (!candidate) continue;
    for (let modifiers = 0; modifiers < 16; modifiers++) {
      const event = {
        key: candidate.key,
        ctrlKey: !!(modifiers & 1),
        altKey: !!(modifiers & 2),
        shiftKey: !!(modifiers & 4),
        metaKey: !!(modifiers & 8),
      };
      const data = encodeDesktopKey(event);
      if (data && keys.matches(data, "app.message.copy"))
        matches.add(desktopKeyId(event));
    }
  }
  return [...matches];
}
