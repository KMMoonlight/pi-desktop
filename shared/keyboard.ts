import type { DesktopKeyEvent } from "./desktop-ui.ts";

const pasteStart = "\x1b[200~",
  pasteEnd = "\x1b[201~";

export function encodeDesktopText(text: string): string {
  // Literal newlines/tabs must enter Pi's text insertion path rather than its key parser.
  return /[\x00-\x1f\x7f]/.test(text) ? pasteStart + text + pasteEnd : text;
}

export function decodeDesktopText(data: string): string {
  return data.startsWith(pasteStart) && data.endsWith(pasteEnd)
    ? data.slice(pasteStart.length, -pasteEnd.length)
    : data;
}

const names: Record<string, string> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Escape: "escape",
  Enter: "enter",
  Tab: "tab",
  Backspace: "backspace",
  Delete: "delete",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  Insert: "insert",
  " ": "space",
};
export function desktopKeyFromId(
  id: string | undefined,
): DesktopKeyEvent | undefined {
  if (!id) return undefined;
  if (Array.from(id).length === 1) return { key: id };
  const parts: string[] = [];
  let key = id.toLowerCase();
  for (;;) {
    const modifier = /^(ctrl|alt|shift|super)\+/.exec(key);
    if (!modifier) break;
    parts.push(modifier[1]);
    key = key.slice(modifier[0].length);
  }
  const name =
    Object.entries(names).find(([, value]) => value === key)?.[0] ??
    (/^f\d+$/i.test(key) ? key.toUpperCase() : key);
  if (name.length > 1 && !Object.hasOwn(names, name) && !/^f\d+$/i.test(name))
    return undefined;
  return {
    key: name,
    ctrlKey: parts.includes("ctrl"),
    altKey: parts.includes("alt"),
    shiftKey: parts.includes("shift"),
    metaKey: parts.includes("super"),
  };
}
export function desktopKeyId(
  event: Pick<
    DesktopKeyEvent,
    "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
  >,
): string {
  const key = names[event.key] ?? event.key.toLowerCase();
  return [
    event.ctrlKey && "ctrl",
    event.altKey && "alt",
    event.shiftKey && "shift",
    event.metaKey && "super",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export function encodeDesktopKey(event: DesktopKeyEvent): string | undefined {
  if (
    [
      "Shift",
      "Control",
      "Alt",
      "Meta",
      "Dead",
      "Process",
      "Unidentified",
    ].includes(event.key)
  )
    return;
  const modifier =
    1 +
    (event.shiftKey ? 1 : 0) +
    (event.altKey ? 2 : 0) +
    (event.ctrlKey ? 4 : 0) +
    (event.metaKey ? 8 : 0);
  if (event.type === "release" || event.repeat) {
    const phase = `${modifier}:${event.type === "release" ? 3 : 2}`;
    const final = {
      ArrowUp: "A",
      ArrowDown: "B",
      ArrowRight: "C",
      ArrowLeft: "D",
      Home: "H",
      End: "F",
    }[event.key];
    if (final) return `\x1b[1;${phase}${final}`;
    const number = {
      Insert: 2,
      Delete: 3,
      PageUp: 5,
      PageDown: 6,
      F1: 11,
      F2: 12,
      F3: 13,
      F4: 14,
      F5: 15,
      F6: 17,
      F7: 18,
      F8: 19,
      F9: 20,
      F10: 21,
      F11: 23,
      F12: 24,
    }[event.key];
    // Pi recognizes F-key phases but cannot match their phased identities.
    // Tilde sequences keep them out of its printable CSI-u insertion path.
    if (number) return `\x1b[${number};${phase}~`;
    const code =
      {
        Enter: 13,
        Tab: 9,
        Escape: 27,
        Backspace: 127,
      }[event.key] ??
      (Array.from(event.key).length === 1
        ? (event.ctrlKey || event.metaKey
            ? event.key.toLowerCase()
            : event.key
          ).codePointAt(0)
        : undefined);
    return code === undefined ? undefined : `\x1b[${code};${phase}u`;
  }
  const plain: Record<string, string> = {
    Enter: "\r",
    Tab: "\t",
    Escape: "\x1b",
    Backspace: "\x7f",
  };
  if (modifier === 1 && plain[event.key]) return plain[event.key];
  const arrows: Record<string, string> = {
    ArrowUp: "A",
    ArrowDown: "B",
    ArrowRight: "C",
    ArrowLeft: "D",
    Home: "H",
    End: "F",
  };
  if (arrows[event.key])
    return modifier === 1
      ? `\x1b[${arrows[event.key]}`
      : `\x1b[1;${modifier}${arrows[event.key]}`;
  const fn: Record<string, number> = {
    Insert: 2,
    Delete: 3,
    PageUp: 5,
    PageDown: 6,
    F5: 15,
    F6: 17,
    F7: 18,
    F8: 19,
    F9: 20,
    F10: 21,
    F11: 23,
    F12: 24,
  };
  if (fn[event.key])
    return `\x1b[${fn[event.key]}${modifier === 1 ? "" : `;${modifier}`}~`;
  if (/^F[1-4]$/.test(event.key)) {
    const final = ["P", "Q", "R", "S"][Number(event.key.slice(1)) - 1];
    return modifier === 1 ? `\x1bO${final}` : `\x1b[1;${modifier}${final}`;
  }
  if (Array.from(event.key).length === 1) {
    if (event.ctrlKey && !event.shiftKey && !event.metaKey) {
      const code = event.key.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95)
        return (event.altKey ? "\x1b" : "") + String.fromCharCode(code - 64);
    }
    if (!event.ctrlKey && !event.metaKey)
      return (event.altKey ? "\x1b" : "") + event.key;
  }
  const code =
    { Enter: 13, Tab: 9, Escape: 27, Backspace: 127 }[event.key] ??
    (Array.from(event.key).length === 1
      ? event.key.toLowerCase().codePointAt(0)
      : undefined);
  return code === undefined ? undefined : `\x1b[${code};${modifier}u`;
}
