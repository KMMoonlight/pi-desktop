import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  Extension,
  ExtensionUIContext,
  LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import type {
  DesktopAdapterContext,
  DesktopComponent,
  DesktopRenderSource,
  DesktopUIRegistry,
} from "./desktop-ui.ts";
import {
  registerOfficialWorkflowAdapters,
  type OfficialWorkflowKind,
} from "./official-workflows.ts";
import { registerOfficialEditorAdapter } from "./official-editor.ts";

type QuestionKind = "question" | "questionnaire";
interface Option {
  value: string;
  label: string;
  description?: string;
}
interface Question {
  id: string;
  label: string;
  prompt: string;
  options: Option[];
  allowOther: boolean;
}
interface Answer {
  id: string;
  value: string;
  label: string;
  wasCustom: boolean;
  index?: number;
}
interface QuestionRequest {
  kind: QuestionKind;
  originalFactory: Parameters<ExtensionUIContext["custom"]>[0];
  extensionPath: string;
  questions: Question[];
  answers: Map<string, Answer>;
}
interface QuestionParams {
  question: string;
  options: { label: string; description?: string }[];
}
interface QuestionnaireParams {
  questions: Question[];
}

// Audited SDK 1.0.0 examples. Changed files need a new conversion audit.
const sourceHashes: Record<
  QuestionKind | OfficialWorkflowKind | "modal-editor",
  string
> = {
  question: "a1625d2c72a65d859154a7e66bef222d48ca9e3654a8bb910829ad350378a4c4",
  questionnaire:
    "3f1f719d81152ff013f5d36a97cc3976388d43f2d89bff0f19827d3443d903e6",
  todo: "e46824d00217e25242c186d41837cc84ca81b23f978500323448502a9a424ee2",
  qna: "a639a65a486fd05a42afcf14aa59dc32e505e41ada43869167ddfd789a3c7da6",
  "message-renderer":
    "bedc198df5215c0a758e0743224599003630741a4ff72d4327837ce309e5ec8c",
  "modal-editor":
    "4742283930949fad1920359540aa9d42c833d2d24eaa49564bfc08f90e328b0d",
};
function identify(extension: Extension): keyof typeof sourceHashes | undefined {
  try {
    const source = readFileSync(extension.resolvedPath, "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const hash = createHash("sha256").update(source).digest("hex");
    return (Object.keys(sourceHashes) as (keyof typeof sourceHashes)[]).find(
      (kind) => sourceHashes[kind] === hash,
    );
  } catch {
    return undefined;
  }
}
function questionnaireResult(source: QuestionRequest, cancelled: boolean) {
  return {
    questions: source.questions,
    answers: [...source.answers.values()],
    cancelled,
  };
}

function questionComponent({
  source: raw,
  done,
}: DesktopAdapterContext): DesktopComponent {
  const source = raw as QuestionRequest;
  const drafts = source.questions.map(() => ({ selection: "0", text: "" }));
  let tab = 0;
  const multi = source.questions.length > 1;
  const complete = () =>
    source.questions.every((question) => source.answers.has(question.id));
  const submit = () => {
    if (complete()) done(questionnaireResult(source, false));
  };
  const cancel = () =>
    done(source.kind === "question" ? null : questionnaireResult(source, true));
  const save = () => {
    const question = source.questions[tab];
    const draft = drafts[tab];
    if (!question || !draft) return;
    const custom = draft.selection === "other";
    const optionIndex = Number(draft.selection);
    const option = question.options[optionIndex];
    const text = draft.text.trim();
    if (custom && source.kind === "question" && !text) return;
    if (!custom && !option) return;
    const label = custom ? text || "(no response)" : option.label;
    if (source.kind === "question") {
      done({
        answer: label,
        wasCustom: custom,
        ...(custom ? {} : { index: optionIndex + 1 }),
      });
      return;
    }
    source.answers.set(question.id, {
      id: question.id,
      value: custom ? label : option.value,
      label,
      wasCustom: custom,
      ...(custom ? {} : { index: optionIndex + 1 }),
    });
    if (!multi) submit();
    else tab = Math.min(tab + 1, source.questions.length);
  };
  const summary = (): DesktopNode => ({
    kind: "column",
    children: [
      {
        kind: "table",
        columns: ["Question", "Answer"],
        rows: source.questions.map((q) => [
          q.label,
          source.answers.get(q.id)?.label ?? "",
        ]),
      },
      {
        kind: "button",
        action: "submit",
        label: "Submit answers",
        icon: "check",
        disabled: !complete(),
      },
    ],
  });
  const questionView = (index: number): DesktopNode[] => {
    const question = source.questions[index];
    const draft = drafts[index];
    const selected = question.options[Number(draft.selection)];
    return [
      { kind: "text", text: question.prompt },
      {
        kind: "select",
        action: "selection",
        label: "Answer",
        value: draft.selection,
        options: [
          ...question.options.map((option, i) => ({
            value: String(i),
            label: option.label,
          })),
          ...(question.allowOther ? [{ value: "other", label: "Other" }] : []),
        ],
      },
      ...(question.options.some((option) => option.description)
        ? [
            {
              kind: "table" as const,
              columns: ["Option", "Description"],
              rows: question.options
                .filter((option) => option.description)
                .map((option) => [option.label, option.description!]),
            },
          ]
        : []),
      ...(draft.selection === "other"
        ? [
            {
              kind: "textarea" as const,
              action: "answer",
              label: "Your answer",
              value: draft.text,
            },
          ]
        : []),
      {
        kind: "button",
        action: "save",
        label: multi ? "Save answer" : "Confirm answer",
        icon: "check",
        disabled:
          draft.selection === "other"
            ? source.kind === "question" && !draft.text.trim()
            : !selected,
      },
    ];
  };
  return {
    title: source.kind === "question" ? "Question" : "Questionnaire",
    view: () => ({
      kind: "column",
      children: [
        ...(multi
          ? [
              {
                kind: "tabs" as const,
                action: "tab",
                value: String(tab),
                tabs: [
                  ...source.questions.map((q, index) => ({
                    value: String(index),
                    label: q.label,
                    children: questionView(index),
                  })),
                  {
                    value: String(source.questions.length),
                    label: "Review",
                    children: [summary()],
                  },
                ],
              },
            ]
          : questionView(0)),
        { kind: "button", action: "cancel", label: "Cancel", icon: "close" },
      ],
    }),
    handleAction: ({ action, value }) => {
      if (action === "cancel") cancel();
      if (action === "submit") submit();
      if (action === "save") save();
      if (action === "tab" && typeof value === "string") {
        const index = Number(value);
        if (
          Number.isInteger(index) &&
          index >= 0 &&
          index <= source.questions.length
        )
          tab = index;
      }
      const question = source.questions[tab];
      const draft = drafts[tab];
      if (!question || !draft) return;
      if (action === "selection" && typeof value === "string") {
        if (
          value === "other"
            ? !question.allowOther
            : !/^\d+$/.test(value) || !question.options[Number(value)]
        )
          return;
        draft.selection = value;
        source.answers.delete(question.id);
      }
      if (
        action === "answer" &&
        typeof value === "string" &&
        draft.selection === "other"
      ) {
        draft.text = value;
        source.answers.delete(question.id);
      }
    },
  };
}

function rendererView(source: DesktopRenderSource): DesktopNode {
  const value = (source.value ?? {}) as {
    question?: string;
    questions?: { prompt?: string }[];
    content?: { type?: string; text?: string }[];
    details?: { cancelled?: boolean; answers?: Answer[] };
  };
  if (source.kind === "toolCall") {
    const questions = Array.isArray(value.questions) ? value.questions : [];
    return {
      kind: "text",
      text:
        typeof value.question === "string"
          ? value.question
          : questions.map((q) => q.prompt).join("\n") || "Questionnaire",
    };
  }
  const details = value.details;
  const texts = (Array.isArray(value.content) ? value.content : []).flatMap(
    (block) => (block.type === "text" ? [block.text] : []),
  );
  if (
    source.context.expanded &&
    !details?.cancelled &&
    Array.isArray(details?.answers)
  ) {
    return {
      kind: "table",
      columns: ["Question", "Answer"],
      rows: details.answers.map((answer: Answer) => [answer.id, answer.label]),
    };
  }
  return { kind: "text", text: texts.join("\n") };
}

export function registerOfficialDesktopAdapters(desktop: DesktopUIRegistry) {
  const workflow = registerOfficialWorkflowAdapters(desktop);
  const editor = registerOfficialEditorAdapter(desktop);
  const requests = new WeakSet<object>();
  const renderers = new WeakSet<Function>();
  const decorated = new WeakSet<object>();
  desktop.registerAdapter({
    id: "pi:official-question-dialogs",
    matches: (source, slot) =>
      slot === "dialog" &&
      typeof source === "object" &&
      source !== null &&
      requests.has(source),
    create: questionComponent,
  });
  desktop.registerAdapter({
    id: "pi:official-question-renderers",
    matches: (source, slot) =>
      slot === "tool" &&
      !!source &&
      renderers.has((source as DesktopRenderSource).renderer),
    create: ({ source }) => {
      let current = source as DesktopRenderSource;
      return {
        view: () => rendererView(current),
        handleAction: () => {},
        update: (next) => {
          current = next;
        },
      };
    },
  });
  return (loaded: LoadExtensionsResult): LoadExtensionsResult => {
    for (const extension of loaded.extensions) {
      if (decorated.has(extension)) continue;
      decorated.add(extension);
      const kind = identify(extension);
      if (!kind) continue;
      if (kind === "modal-editor") {
        editor(extension);
        continue;
      }
      if (kind !== "question" && kind !== "questionnaire") {
        workflow(extension, kind);
        continue;
      }
      const definition = extension.tools.get(kind)?.definition;
      if (!definition) continue;
      if (definition.renderCall) renderers.add(definition.renderCall);
      if (definition.renderResult) renderers.add(definition.renderResult);
      const execute = definition.execute;
      definition.execute = function (id, params, signal, update, ctx) {
        const custom: ExtensionUIContext["custom"] = async <T>(
          originalFactory: Parameters<ExtensionUIContext["custom"]>[0],
          options?: Parameters<ExtensionUIContext["custom"]>[1],
        ) => {
          const questions: Question[] =
            kind === "question"
              ? [
                  {
                    id: "question",
                    label: "Question",
                    prompt: (params as QuestionParams).question,
                    allowOther: true,
                    options: (params as QuestionParams).options.map((o) => ({
                      ...o,
                      value: o.label,
                    })),
                  },
                ]
              : (params as QuestionnaireParams).questions.map((q, index) => ({
                  ...q,
                  label: q.label || `Q${index + 1}`,
                  allowOther: q.allowOther !== false,
                }));
          const source: QuestionRequest = {
            kind,
            originalFactory,
            extensionPath: extension.resolvedPath,
            questions,
            answers: new Map(),
          };
          requests.add(source);
          const result = await desktop.custom(source, options, signal);
          return (result ??
            (kind === "question"
              ? null
              : questionnaireResult(source, true))) as T;
        };
        const ui = new Proxy(ctx.ui, {
          get: (target, key, receiver) =>
            key === "custom" ? custom : Reflect.get(target, key, receiver),
        });
        const context = new Proxy(ctx, {
          get: (target, key, receiver) =>
            key === "ui" ? ui : Reflect.get(target, key, receiver),
        });
        return execute.call(this, id, params, signal, update, context);
      };
    }
    return loaded;
  };
}
