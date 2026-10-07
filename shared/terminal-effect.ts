export type TerminalEffect =
  | { type: "title"; title: string }
  | { type: "progress"; active: boolean }
  | { type: "clipboard"; text: string };

export interface TerminalEffectFrame {
  terminalId?: string;
  sequence: number;
}

export interface TerminalEffectDelivery extends TerminalEffectFrame {
  index: number;
}

export function parseTerminalEffect(value: unknown): TerminalEffect {
  if (value && typeof value === "object" && "type" in value) {
    if (
      value.type === "title" &&
      "title" in value &&
      typeof value.title === "string"
    )
      return { type: "title", title: value.title };
    if (
      value.type === "progress" &&
      "active" in value &&
      typeof value.active === "boolean"
    )
      return { type: "progress", active: value.active };
    if (
      value.type === "clipboard" &&
      "text" in value &&
      typeof value.text === "string" &&
      new TextEncoder().encode(value.text).length <= 75000
    )
      return { type: "clipboard", text: value.text };
  }
  throw new Error("Invalid terminal effect");
}
