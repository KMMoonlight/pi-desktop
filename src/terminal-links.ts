import type { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { external } from "./client";

/** Use the desktop opener for both plain URLs and OSC 8 hyperlinks. */
export function installTerminalLinks(
  term: Terminal,
  onError: (reason: unknown) => void,
) {
  const activate = (event: MouseEvent, url: string) => {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    void external(url).catch(onError);
  };
  term.options.linkHandler = { activate };
  term.loadAddon(new WebLinksAddon(activate));
}
