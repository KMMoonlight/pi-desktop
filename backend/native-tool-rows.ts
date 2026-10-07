import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import {
  callComponentMethod,
  componentField,
  type PiComponent,
} from "./component-runtime.ts";
import { createToolFallback } from "./tool-rendering.ts";
import type { DesktopRenderSource } from "./desktop-ui.ts";
import type { DesktopSdkContext } from "./sdk-access.ts";
import type { DesktopTui } from "./tui-api.ts";

type Phase = "toolCall" | "toolResult";
type Renderers = NonNullable<
  ConstructorParameters<typeof ToolExecutionComponent>[4]
>;
type CallRenderer = NonNullable<Renderers["renderCall"]>;
type ResultRenderer = NonNullable<Renderers["renderResult"]>;
type RenderContext = Parameters<CallRenderer>[2];
const component = (value: unknown): value is PiComponent =>
  !!value &&
  typeof value === "object" &&
  typeof Reflect.get(value, "render") === "function" &&
  typeof Reflect.get(value, "invalidate") === "function";

/** A single original SDK row owns both render callbacks and their shared state. */
export class NativeToolRow {
  original?: ToolExecutionComponent;
  private sources = new Map<Phase, DesktopRenderSource>();
  private roots = new Map<Phase, PiComponent>();
  private signatures = new Map<string, string | undefined>();
  private syncing = false;
  private retired = false;
  private session;
  private state: Record<string, unknown>;
  constructor(
    readonly id: string,
    private tui: DesktopTui,
    private context: () => DesktopSdkContext,
  ) {
    this.session = context().session;
    this.state = context().desktop.toolState(id);
  }

  prepare(sources: DesktopRenderSource[]) {
    this.sources.clear();
    for (const source of sources)
      this.sources.set(source.kind as Phase, source);
  }
  private change(key: string, value: unknown, update: () => void) {
    const signature = JSON.stringify(value);
    if (this.signatures.has(key) && this.signatures.get(key) === signature)
      return;
    this.signatures.set(key, signature);
    update();
  }
  private renderContext(native: RenderContext, phase: Phase) {
    const source = this.sources.get(phase) ?? this.sources.get("toolCall")!;
    const invalidate = native.invalidate;
    return {
      ...source.context,
      ...native,
      tui: this.tui,
      state: this.state,
      invalidate: () => {
        if (this.retired || this.context().session !== this.session) return;
        invalidate();
        this.refreshRoots();
        this.context().desktop.invalidateToolRenderers(this.id, true);
      },
    };
  }
  private construct(source: DesktopRenderSource) {
    const sdk = this.context();
    const definition = sdk.session.getToolDefinition(source.context.toolName!);
    const call = definition?.renderCall,
      result = definition?.renderResult;
    const renderers: Renderers | undefined = definition && {
      renderShell: definition.renderShell,
      ...(call
        ? {
            renderCall: (
              ...[args, theme, native]: Parameters<CallRenderer>
            ) => {
              if (this.retired)
                return (
                  native.lastComponent ?? { render: () => [], invalidate() {} }
                );
              const value = call(
                args,
                theme,
                this.renderContext(native, "toolCall"),
              );
              if (!component(value))
                throw new Error(
                  "Tool call renderer did not return a Pi component",
                );
              return value;
            },
          }
        : {}),
      ...(result
        ? {
            renderResult: (
              ...[value, options, theme, native]: Parameters<ResultRenderer>
            ) => {
              if (this.retired)
                return (
                  native.lastComponent ?? { render: () => [], invalidate() {} }
                );
              const rendered = result(
                value,
                options,
                theme,
                this.renderContext(native, "toolResult"),
              );
              if (!component(rendered))
                throw new Error(
                  "Tool result renderer did not return a Pi component",
                );
              return rendered;
            },
          }
        : {}),
    };
    const original = (this.original = new ToolExecutionComponent(
      source.context.toolName!,
      this.id,
      source.context.args ?? source.value,
      {
        showImages: sdk.settingsManager.getShowImages(),
        imageWidthCells: sdk.settingsManager.getImageWidthCells(),
      },
      renderers,
      this.tui,
      source.context.cwd,
    ));
    Reflect.set(original, "rendererState", this.state);
    this.signatures.set(
      "args",
      JSON.stringify(source.context.args ?? source.value),
    );
    this.signatures.set("expanded", JSON.stringify(false));
    this.signatures.set(
      "images",
      JSON.stringify(sdk.settingsManager.getShowImages()),
    );
    this.signatures.set(
      "imageWidth",
      JSON.stringify(sdk.settingsManager.getImageWidthCells()),
    );
    const expanded = original.setExpanded;
    const row = this;
    original.setExpanded = function (value) {
      expanded.call(this, value);
      if (this === original) {
        row.refreshRoots();
        if (
          !row.syncing &&
          !row.retired &&
          row.context().session === row.session
        )
          row.context().host.setToolExpanded(row.id, value);
      }
    };
  }
  sync() {
    if (this.retired || this.syncing) return;
    const source =
      this.sources.get("toolCall") ?? this.sources.get("toolResult");
    if (!source) return;
    this.syncing = true;
    try {
      if (!this.original) this.construct(source);
      const original = this.original!;
      const sdk = this.context();
      this.change("args", source.context.args ?? source.value, () =>
        original.updateArgs(source.context.args ?? source.value),
      );
      this.change("expanded", source.context.expanded, () =>
        original.setExpanded(source.context.expanded),
      );
      this.change("images", sdk.settingsManager.getShowImages(), () =>
        original.setShowImages(sdk.settingsManager.getShowImages()),
      );
      this.change("imageWidth", sdk.settingsManager.getImageWidthCells(), () =>
        original.setImageWidthCells(sdk.settingsManager.getImageWidthCells()),
      );
      this.change("argsComplete", source.context.argsComplete, () => {
        if (source.context.argsComplete) original.setArgsComplete();
      });
      this.change("executionStarted", source.context.executionStarted, () => {
        if (source.context.executionStarted) original.markExecutionStarted();
      });
      const result = this.sources.get("toolResult");
      if (result)
        this.change(
          "result",
          [result.value, result.context.isPartial, result.context.isError],
          () =>
            original.updateResult(
              {
                ...(result.value as Parameters<
                  ToolExecutionComponent["updateResult"]
                >[0]),
                isError: result.context.isError,
              },
              result.context.isPartial,
            ),
        );
      this.refreshRoots();
    } finally {
      this.syncing = false;
    }
  }
  private refreshRoots() {
    if (!this.original) return;
    const shell = componentField(this.original, "selfRenderContainer");
    const box = componentField(this.original, "contentBox");
    const definition = componentField(this.original, "toolDefinition") as
      Renderers | undefined;
    const container = definition?.renderShell === "self" ? shell : box;
    if (!component(container))
      throw new Error("Pi tool render container is unavailable");
    const regions = componentField(container, "children") as PiComponent[];
    for (const phase of ["toolCall", "toolResult"] as const) {
      const source = this.sources.get(phase);
      if (!source) continue;
      const region = regions[phase === "toolCall" ? 0 : 1];
      let child =
        region && (componentField(region, "child") as PiComponent | undefined);
      const imageFallback =
        phase === "toolResult" &&
        !componentField(this.original, "resultRendererComponent") &&
        source.context.showImages &&
        (source.value as { content?: { type: string }[] }).content?.some(
          (block) => block.type === "image",
        );
      // The full native row retains its result and terminal fallback. Desktop
      // images have their own DOM region, so project only generic fallback text.
      if (source.context.toolDefinitionAvailable === false || imageFallback)
        child = createToolFallback(source);
      if (!child) child = { render: () => [], invalidate() {} };
      let root = this.roots.get(phase);
      if (!root) {
        root = callComponentMethod(
          this.original,
          "createResultRegion",
          child,
        ) as PiComponent;
        this.roots.set(phase, root);
      } else Reflect.set(root, "child", child);
    }
  }
  phase(source: DesktopRenderSource) {
    this.sources.set(source.kind as Phase, source);
    this.sync();
    this.refreshRoots();
    return this.roots.get(source.kind as Phase)!;
  }
  invalidate() {
    if (this.retired || !this.original) return;
    this.original.invalidate();
    this.refreshRoots();
  }
  retire() {
    this.retired = true;
  }
}

export class NativeToolRows {
  private rows = new Map<string, NativeToolRow>();
  constructor(
    private tui: DesktopTui,
    private context: () => DesktopSdkContext,
  ) {}
  prepare(specs: { source: DesktopRenderSource }[]) {
    const grouped = new Map<string, DesktopRenderSource[]>();
    for (const { source } of specs) {
      if (
        !["toolCall", "toolResult"].includes(source.kind) ||
        !source.context.toolCallId
      )
        continue;
      const id = source.context.toolCallId;
      const group = grouped.get(id) ?? [];
      group.push(source);
      grouped.set(id, group);
    }
    for (const [id, row] of this.rows)
      if (!grouped.has(id)) {
        row.retire();
        this.rows.delete(id);
      }
    for (const [id, sources] of grouped) {
      let row = this.rows.get(id);
      if (!row) {
        row = new NativeToolRow(id, this.tui, this.context);
        this.rows.set(id, row);
      }
      row.prepare(sources);
      for (const source of sources) source.nativeToolRow = row;
    }
  }
  get(id: string) {
    return this.rows.get(id);
  }
  invalidate() {
    for (const row of this.rows.values()) row.invalidate();
  }
  dispose() {
    for (const row of this.rows.values()) row.retire();
    this.rows.clear();
  }
}
