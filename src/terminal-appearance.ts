import type { ITheme, Terminal } from "@xterm/xterm";

const paletteKeys = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] as const;
const specialKeys = ["foreground", "background", "cursor"] as const;

function color(value: string): string | undefined {
  const rgb = /^rgb:([\da-f]{1,4})\/([\da-f]{1,4})\/([\da-f]{1,4})$/i.exec(value);
  let channels: string[];
  if (rgb) {
    channels = rgb.slice(1);
    if (!channels.every(channel => channel.length === channels[0].length)) return;
  } else {
    if (!/^#(?:[\da-f]{3}){1,4}$/i.test(value)) return;
    const width = (value.length - 1) / 3;
    channels = [value.slice(1, width + 1), value.slice(width + 1, width * 2 + 1), value.slice(width * 2 + 1)];
  }
  return `#${channels.map(channel => {
    const n = rgb ? Math.round(parseInt(channel, 16) * 255 / (16 ** channel.length - 1))
      : parseInt(channel.padEnd(2, "0").slice(0, 2), 16);
    return n.toString(16).padStart(2, "0");
  }).join("")}`;
}

/** Follow the host theme without clearing colors set by the running program. */
export class TerminalAppearance {
  private defaults: ITheme = {};
  private palette = new Map<number, string>();
  private special = new Map<(typeof specialKeys)[number], string>();
  private handlers;
  constructor(private terminal: Terminal) {
    const observe = (code: number, receive: (data: string) => void) =>
      terminal.parser.registerOscHandler(code, data => { receive(data); return false; });
    this.handlers = [
      observe(4, data => {
        const pairs = data.split(";");
        for (let i = 0; i + 1 < pairs.length; i += 2) {
          const index = Number(pairs[i]), value = color(pairs[i + 1]);
          if (/^\d+$/.test(pairs[i]) && index < 256 && value) this.palette.set(index, value);
        }
      }),
      observe(104, data => {
        if (!data) this.palette.clear();
        else for (const index of data.split(";")) this.palette.delete(Number(index));
        this.apply();
      }),
      ...specialKeys.flatMap((key, offset) => [
        observe(10 + offset, data => {
          data.split(";").forEach((part, i) => {
            const target = specialKeys[offset + i], value = color(part);
            if (target && value) this.special.set(target, value);
          });
        }),
        observe(110 + offset, () => { this.special.delete(key); this.apply(); }),
      ]),
    ];
  }
  update(background: string, foreground: string) {
    if (this.defaults.background === background && this.defaults.foreground === foreground) return;
    this.defaults = { background, foreground, cursor: foreground, cursorAccent: background,
      selectionBackground: foreground, selectionForeground: background, selectionInactiveBackground: foreground };
    this.apply();
  }
  reset() { this.palette.clear(); this.special.clear(); this.apply(); }
  private apply() {
    const theme: ITheme = { ...this.defaults, ...Object.fromEntries(this.special) };
    for (const [index, value] of this.palette) {
      if (index < 16) theme[paletteKeys[index]] = value;
      else (theme.extendedAnsi ??= [])[index - 16] = value;
    }
    this.terminal.options.theme = theme;
  }
  dispose() { this.handlers.forEach(handler => handler.dispose()); }
}
