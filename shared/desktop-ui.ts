export interface DesktopComponentIdentity {
  action: string;
  occurrence: string;
  columns?: number;
}
export interface DesktopPasteSpan {
  start: number;
  end: number;
  marker: string;
  text: string;
}
export interface DesktopTextStyle {
  color?: string;
  backgroundColor?: string;
  fontWeight?: "bold";
  fontStyle?: "italic";
  opacity?: number;
  textDecorationLine?: string;
  textDecorationStyle?: "solid" | "double" | "wavy" | "dotted" | "dashed";
  textDecorationColor?: string;
  visibility?: "hidden";
}
export interface DesktopTextRun {
  text: string;
  style?: DesktopTextStyle;
  href?: string;
  blink?: boolean;
}
export interface DesktopMarkdownText {
  text: string;
  runs?: DesktopTextRun[];
}
export interface DesktopRenderAdditions {
  before: DesktopMarkdownText[];
  after: DesktopMarkdownText[];
  replacement?: DesktopMarkdownText[];
  control?: {
    action: string;
    label: string;
    desktopLabel?: boolean;
    cursor?: { row: number; col: number };
  };
  composition?: (
    | { child: number }
    | { lines: DesktopMarkdownText[]; columns?: number; trailing?: boolean }
  )[];
}
export type DesktopMarkdownBlock =
  | (DesktopMarkdownText & {
      kind: "paragraph" | "heading";
      depth?: number;
      preformatted?: boolean;
    })
  | {
      kind: "quote";
      children: DesktopMarkdownBlock[];
      borderStyle?: DesktopTextStyle;
    }
  | {
      kind: "list";
      ordered: boolean;
      start: number;
      items: {
        marker: DesktopMarkdownText;
        children: DesktopMarkdownBlock[];
      }[];
    }
  | (DesktopMarkdownText & {
      kind: "code";
      language?: string;
      copyText?: string;
      opening: DesktopMarkdownText;
      closing: DesktopMarkdownText;
    })
  | {
      kind: "table";
      headers: DesktopMarkdownText[];
      rows: DesktopMarkdownText[][];
      align: ("left" | "center" | "right" | null)[];
    }
  | { kind: "divider"; style?: DesktopTextStyle };
export type DesktopNode = {
  /** The mapper generated this label, rather than reading it from an extension. */
  desktopLabel?: boolean;
  appearance?: "composer" | "completion";
  inert?: boolean;
  component?: DesktopComponentIdentity;
  style?: DesktopTextStyle;
  labelRuns?: DesktopTextRun[];
  labelPrefix?: DesktopMarkdownText;
  rendered?: DesktopRenderAdditions;
} & (
  | {
      kind: "terminal";
      action: string;
      data: string;
      effectSequence?: number;
      cols: number;
      rows: number;
      cursor?: { row: number; col: number };
      showCursor?: boolean;
    }
  | {
      kind: "text" | "markdown";
      text: string;
      runs?: DesktopTextRun[];
      blocks?: DesktopMarkdownBlock[];
      padding?: { x: number; y: number };
      truncate?: boolean;
    }
  | {
      kind: "image";
      src: string;
      alt: string;
      width?: number;
      aspectRatio?: number;
      fallback?: DesktopMarkdownText;
    }
  | { kind: "divider" }
  | {
      kind: "row" | "column";
      children: DesktopNode[];
      gap?: number;
      align?: "stretch" | "start" | "center" | "end";
      padding?: { x: number; y: number };
      sizes?: {
        basis: number | "auto";
        grow: number;
        shrink: number;
        min?: number;
        max?: number;
      }[];
    }
  | { kind: "spacer"; lines: number }
  | {
      kind: "scroll";
      action: string;
      children: DesktopNode[];
      scrollTop: number;
      followEnd?: boolean;
      overscroll?: "auto" | "contain";
      scrollbar?: "hidden" | "auto" | "always";
      scrollbarVisible?: boolean;
      scrollbarActive?: boolean;
      scrollbarColors?: { thumb?: string; track?: string };
    }
  | {
      kind: "region";
      action: string;
      child: DesktopNode;
      nativeControls?: boolean;
    }
  | {
      kind: "button";
      action: string;
      label: string;
      icon?: string;
      disabled?: boolean;
      mouseControl?: "setting";
    }
  | {
      kind: "input" | "textarea";
      action: string;
      label: string;
      value: string;
      revision?: number;
      controlVersion?: number;
      placeholder?: string;
      placeholderStyle?: DesktopTextStyle;
      placeholderRuns?: DesktopTextRun[];
      borderColor?: string;
      paddingX?: number;
      secret?: boolean;
      disabled?: boolean;
      selectionAction?: string;
      selection?: DesktopSelection & { revision: number; text?: string };
      autocomplete?: boolean;
      completionAction?: string;
      pasteAction?: string;
      pastes?: DesktopPasteSpan[];
      completionKeys?: Partial<Record<DesktopCompletionAction, string[]>>;
    }
  | {
      kind: "select";
      action: string;
      submitAction?: string;
      label: string;
      value: string;
      options: {
        value: string;
        label: string;
        style?: DesktopTextStyle;
        runs?: DesktopTextRun[];
      }[];
      disabled?: boolean;
      visibleOptions?: number;
    }
  | {
      kind: "toggle";
      action: string;
      label: string;
      value: boolean;
      disabled?: boolean;
    }
  | {
      kind: "number" | "slider";
      action: string;
      label: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
      disabled?: boolean;
    }
  | {
      kind: "tabs";
      action: string;
      value: string;
      tabs: { value: string; label: string; children: DesktopNode[] }[];
    }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | {
      kind: "progress";
      label: string;
      value?: number;
      max?: number;
      indicator?: DesktopMarkdownText;
      indicatorColor?: string;
    }
);
export type DesktopSlot =
  | "dialog"
  | "aboveEditor"
  | "belowEditor"
  | "header"
  | "footer"
  | "editor"
  | "message"
  | "entry"
  | "tool";
export interface DesktopKeyEvent {
  key: string;
  type?: "press" | "release";
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}
export type DesktopCompletionAction =
  "up" | "down" | "pageUp" | "pageDown" | "confirm" | "cancel" | "trigger";
export interface DesktopSelection {
  start: number;
  end: number;
}
export interface DesktopEditorLayout {
  direction?: "ltr" | "rtl";
  text: string;
  width: number;
  pageRows: number;
  rows: {
    logicalLine: number;
    startCol: number;
    length: number;
    carets: { offset: number; x: number }[];
  }[];
}
export interface DesktopInputResult {
  consume: boolean;
  dialogFocus?: number;
  dialogInsert?: string;
  dialogExternal?: boolean;
  data?: string;
  editor?: {
    text: string;
    selection: DesktopSelection;
    revision?: number;
    selectionRevision?: number;
    controlVersion?: number;
  };
}
export interface DesktopInputContext {
  controlAction?: string;
  raw?: boolean;
  controlText?: string;
  controlVersion?: number;
  instanceId?: string;
  autocompleteActive?: boolean;
  editorText?: string;
  selection?: DesktopSelection;
  editorLayout?: DesktopEditorLayout;
}
export interface DesktopOverlay {
  hidden: boolean;
  focused: boolean;
  order: number;
  bounds?: { row: number; col: number; width: number; height: number };
  maxHeight?: number;
  viewport?: { width: number; height: number };
  layoutKey?: string;
}
export interface DesktopSurface {
  id: string;
  instanceId: string;
  slot: DesktopSlot;
  title?: string;
  view: DesktopNode;
  overlay?: DesktopOverlay;
  target?: {
    messageId?: string;
    blockId?: string;
    toolCallId?: string;
    entryId?: string;
    phase?: "call" | "result";
  };
  acceptsKeys?: boolean;
  focusRequest?: { action: string | null; revision: number };
  terminalFocusRevision?: number;
}
export interface DesktopUIAction {
  action: string;
  value?: unknown;
}
export interface DesktopMouseEvent {
  pointerId: number;
  type: "press" | "release" | "move" | "drag" | "click" | "wheel";
  button: "left" | "middle" | "right" | "none";
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  wheelDelta?: number;
  clickCount?: number;
  cancelled?: boolean;
  nativeLink?: boolean;
  hitPath?: (DesktopComponentIdentity & {
    x: number;
    y: number;
    width: number;
    height: number;
  })[];
  nativeControl?: {
    action: string;
    kind: "input" | "textarea" | "select" | "setting";
    text?: string;
    selection?: DesktopSelection;
    value?: string;
    offset?: { x: number; y: number };
  };
}
export interface DesktopMouseResult {
  handled: boolean;
  capture: boolean;
  retainPointer?: boolean;
  focusAction?: string;
  render: boolean;
  editor?: DesktopInputResult["editor"];
}
