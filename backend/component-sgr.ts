import Anser from "anser";
import type { DesktopTextStyle } from "../shared/desktop-ui.ts";

const enables = new Set([1, 2, 3, 4, 5, 7, 8, 9]);
const resets: Record<number, number[]> = {
  21: [1],
  22: [1, 2],
  23: [3],
  24: [4],
  25: [5],
  27: [7],
  28: [8],
  29: [9],
};
const underlines: DesktopTextStyle["textDecorationStyle"][] = [
  undefined,
  "solid",
  "double",
  "wavy",
  "dotted",
  "dashed",
];

/** Normalize SGR groups without treating color channels as independent styles. */
export class ComponentSgr {
  private parser = new Anser();
  private active = new Set<number>();
  private entry = this.parser.processChunkJson(
    "0m",
    { use_classes: true },
    true,
  );
  underlineStyle: DesktopTextStyle["textDecorationStyle"];
  underlineColor: string | undefined;
  overline = false;

  constructor(private indexedColor: (index: number) => string) {}

  private feed(parameters: string) {
    this.entry = this.parser.processChunkJson(
      `${parameters}m`,
      { use_classes: true },
      true,
    );
  }

  process(sequence: string) {
    const parts = sequence.slice(2, -1).split(";");
    for (let index = 0; index < parts.length; index++) {
      const group = parts[index].split(":");
      const code = Number(group[0]);
      if (!Number.isSafeInteger(code)) continue;
      if ([38, 48, 58].includes(code)) {
        let channels: string[];
        const mode = group.length > 1 ? group[1] : parts[++index];
        const count = mode === "5" ? 1 : mode === "2" ? 3 : 0;
        if (!count) continue;
        if (group.length > 1) {
          channels = group.slice(2);
          if (mode === "2" && channels.length === 4) {
            if (channels[0] !== "" && channels[0] !== "0") continue;
            channels.shift();
          }
        } else {
          channels = parts.slice(index + 1, index + 1 + count);
          index += count;
        }
        if (
          channels.length !== count ||
          channels.some((value) => !/^\d+$/.test(value) || Number(value) > 255)
        )
          continue;
        const values = channels.map(Number);
        if (code === 58) {
          this.underlineColor =
            mode === "5"
              ? this.indexedColor(values[0])
              : `rgb(${values.join(", ")})`;
        } else this.feed(`${code};${mode};${values.join(";")}`);
        continue;
      }
      if (group.length > 1) {
        if (code !== 4 || group.length !== 2 || !/^[0-5]$/.test(group[1]))
          continue;
        const mode = Number(group[1]);
        this.underlineStyle = underlines[mode];
        if (mode === 0) {
          this.active.delete(4);
          this.feed("24");
        } else if (!this.active.has(4)) {
          this.active.add(4);
          this.feed("4");
        }
        continue;
      }
      if (code === 53 || code === 55) {
        this.overline = code === 53;
        continue;
      }
      if (code === 59) {
        this.underlineColor = undefined;
        continue;
      }
      if (code === 0) {
        this.active.clear();
        this.underlineStyle = undefined;
        this.underlineColor = undefined;
        this.overline = false;
      }
      if (code === 4 || code === 24) this.underlineStyle = undefined;
      if (enables.has(code)) {
        if (this.active.has(code)) continue;
        this.active.add(code);
      }
      for (const enabled of resets[code] ?? []) this.active.delete(enabled);
      this.feed(String(code));
    }
    return this.entry;
  }
}
