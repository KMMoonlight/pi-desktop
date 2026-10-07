import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { PiComponent, PiMouseEvent } from "./component-runtime.ts";

export interface PiMouseTarget {
  component: PiComponent;
  originX: number;
  originY: number;
  width: number;
  height: number;
}
export interface PiMouseDispatchResult {
  handled: true;
  capture?: boolean;
  focus?: boolean;
  render?: boolean;
  target: PiMouseTarget;
  focusTarget?: PiComponent;
}

export interface PiMouseApi {
  dispatchMouseEvent(
    component: PiComponent,
    event: PiMouseEvent,
  ): PiMouseDispatchResult | undefined;
  retargetMouseEvent(event: PiMouseEvent, target: PiMouseTarget): PiMouseEvent;
}
interface PublicTuiApi {
  CURSOR_MARKER: string;
  ProcessTerminal: new () => DesktopTui["terminal"];
  getNativeClipboard(): NativeClipboard | undefined;
  Input: new (options?: {
    prompt?: string;
    placeholder?: string;
    placeholderStyle?: (text: string) => string;
  }) => PiComponent & {
    getValue(): string;
    setValue(value: string): void;
    handleInput(data: string): void;
    dispose?(): void;
    onSubmit?: (value: string) => void;
    onEscape?: () => void;
  };
  Editor: new (
    tui: DesktopTui,
    theme: ConstructorParameters<
      typeof import("@earendil-works/pi-coding-agent").CustomEditor
    >[1],
    options?: { paddingX?: number },
  ) => Pick<
    import("@earendil-works/pi-coding-agent").CustomEditor,
    | "getText"
    | "getExpandedText"
    | "onSubmit"
    | "setText"
    | "getLines"
    | "getCursor"
    | "render"
    | "handleMouse"
    | "handleInput"
    | "addToHistory"
  >;
  KeybindingsManager: new (
    definitions: PublicTuiApi["TUI_KEYBINDINGS"],
    bindings?: Record<string, string | string[]>,
  ) => DesktopKeybindings;
  getKeybindings(): DesktopKeybindings;
  setKeybindings(bindings: DesktopKeybindings): void;
  visibleWidth(text: string): number;
  sliceByColumn(
    line: string,
    startCol: number,
    length: number,
    strict?: boolean,
  ): string;
  TUI_KEYBINDINGS: Record<string, { defaultKeys: string | string[] }>;
  TuiMainScreen: new (
    terminal: DesktopTui["terminal"],
    showHardwareCursor?: boolean,
  ) => DesktopTui;
  CombinedAutocompleteProvider: new (
    commands: Parameters<
      typeof import("./autocomplete.ts").createDesktopAutocomplete
    >[0],
    cwd: string,
    fdPath?: string | null,
  ) => import("./autocomplete.ts").DesktopAutocompleteProvider;
  matchesKey(data: string, key: string): boolean;
  parseKey(data: string): string | undefined;
  isKeyRelease(data: string): boolean;
  isKeyRepeat(data: string): boolean;
  decodeKittyPrintable(data: string): string | undefined;
  stripTerminalSequences(text: string): string;
  colorToHex(
    color: import("@earendil-works/pi-coding-agent").Theme["colors"][import("@earendil-works/pi-coding-agent").ThemeToken],
  ): string;
}
export interface NativeClipboard {
  getText(): Promise<string | null | undefined>;
  getImage(): Promise<Uint8Array | null | undefined>;
  getFilePaths?(): Promise<string[] | null | undefined>;
  setText?(text: string): Promise<void>;
}
export interface DesktopKeybindings {
  matches(data: string, action: string): boolean;
  getKeys(action: string): string[];
}
export type DesktopTui = Parameters<
  Parameters<
    import("@earendil-works/pi-coding-agent").ExtensionUIContext["custom"]
  >[0]
>[0];
let publicApi: Promise<PublicTuiApi> | undefined;
export function loadTuiApi(): Promise<PublicTuiApi> {
  const require = createRequire(
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  return (publicApi ??= import(
    pathToFileURL(require.resolve("@earendil-works/pi-tui")).href
  ));
}
