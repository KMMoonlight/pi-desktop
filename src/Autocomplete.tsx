import { t, useLocale } from "./i18n";
import { useEffect, useRef, useState, type RefObject } from "react";
import { CompletionMenu } from "./CompletionMenu";
import { action } from "./client";
import type { DesktopCompletionAction } from "../shared/desktop-ui";
import { desktopKeyId } from "../shared/keyboard";

const defaultKeys: Record<DesktopCompletionAction, string[]> = {
  up: ["up"],
  down: ["down"],
  pageUp: ["pageUp"],
  pageDown: ["pageDown"],
  confirm: ["enter"],
  cancel: ["escape", "ctrl+c"],
  trigger: ["tab"],
};
const normalizedKey = (key: string) =>
  key.toLowerCase().split("+").sort().join("+");

interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}
interface Suggestions {
  prefix: string;
  items: CompletionItem[];
}

export function Autocomplete({
  text,
  editor,
  onComplete,
  enabled,
  keybindings,
}: {
  text: string;
  editor: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  onComplete(text: string): void;
  enabled: boolean;
  keybindings?: Partial<Record<DesktopCompletionAction, string[]>>;
}) {
  useLocale();
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [selected, setSelected] = useState(0);
  const [caret, setCaret] = useState(-1);
  const location = useRef({ lines: [""], line: 0, column: 0 });
  const requestRevision = useRef(0);
  useEffect(() => {
    const control = editor.current;
    if (!control) return;
    control.dataset.autocompleteActive = String(!!suggestions?.items.length);
    return () => {
      delete control.dataset.autocompleteActive;
    };
  }, [suggestions, editor]);
  useEffect(() => {
    const changed = () => {
      if (editor.current && document.activeElement === editor.current)
        setCaret(editor.current.selectionStart ?? 0);
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [editor]);
  useEffect(() => {
    const revision = ++requestRevision.current;
    setSuggestions(null);
    setSelected(0);
    if (
      !enabled ||
      !text ||
      !editor.current ||
      document.activeElement !== editor.current
    )
      return;
    const id = crypto.randomUUID();
    const before = text.slice(0, editor.current.selectionStart ?? 0);
    const parts = before.split("\n");
    const cursor = {
      lines: text.split("\n"),
      line: parts.length - 1,
      column: parts.at(-1)!.length,
    };
    location.current = cursor;
    let live = true;
    let requested = false;
    const timer = setTimeout(() => {
      requested = true;
      void action<Suggestions | null>("autocomplete.suggest", { id, ...cursor })
        .then((result) => {
          if (live && revision === requestRevision.current)
            setSuggestions(result);
        })
        .catch(() => {});
    }, 100);
    return () => {
      requestRevision.current++;
      live = false;
      clearTimeout(timer);
      if (requested) void action("sdk.cancel", { id }).catch(() => {});
    };
  }, [text, enabled, editor, caret]);
  const complete = (item: CompletionItem) => {
    if (!suggestions) return;
    void action<{ lines: string[]; cursorLine: number; cursorCol: number }>(
      "autocomplete.apply",
      {
        ...location.current,
        item,
        prefix: suggestions.prefix,
      },
    )
      .then((result) => {
        onComplete(result.lines.join("\n"));
        setSuggestions(null);
        requestAnimationFrame(() => {
          const offset =
            result.lines
              .slice(0, result.cursorLine)
              .reduce((sum, line) => sum + line.length + 1, 0) +
            result.cursorCol;
          editor.current?.focus();
          editor.current?.setSelectionRange(offset, offset);
        });
      })
      .catch(() => {});
  };
  useEffect(() => {
    const control = editor.current;
    if (!control) return;
    const keydown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.isComposing || event.keyCode === 229 || event.key === "Process")
        return;
      const id = normalizedKey(desktopKeyId(event));
      const command = (
        Object.keys(defaultKeys) as DesktopCompletionAction[]
      ).find((name) =>
        (keybindings?.[name] ?? defaultKeys[name]).some(
          (key) => normalizedKey(key) === id,
        ),
      );
      if (!command || (!suggestions?.items.length && command !== "trigger"))
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!suggestions?.items.length) {
        const before = control.value
          .slice(0, control.selectionStart ?? 0)
          .split("\n");
        const cursor = {
          lines: control.value.split("\n"),
          line: before.length - 1,
          column: before.at(-1)!.length,
        };
        location.current = cursor;
        const revision = ++requestRevision.current;
        const id = crypto.randomUUID();
        void (async () => {
          const normal = await action<Suggestions | null>(
            "autocomplete.suggest",
            { id, ...cursor },
          );
          return normal?.items.length
            ? normal
            : action<Suggestions | null>("autocomplete.suggest", {
                id,
                ...cursor,
                force: true,
              });
        })()
          .then((result) => {
            if (
              revision === requestRevision.current &&
              control.isConnected &&
              control.value === cursor.lines.join("\n")
            ) {
              setSelected(0);
              setSuggestions(result);
            }
          })
          .catch(() => {});
        return;
      }
      const count = Math.min(10, suggestions.items.length);
      if (command === "down") setSelected((value) => (value + 1) % count);
      else if (command === "up")
        setSelected((value) => (value - 1 + count) % count);
      else if (command === "pageDown")
        setSelected((value) => Math.min(count - 1, value + 5));
      else if (command === "pageUp")
        setSelected((value) => Math.max(0, value - 5));
      else if (command === "cancel") {
        requestRevision.current++;
        setSuggestions(null);
      } else complete(suggestions.items[selected]);
    };
    control.addEventListener("keydown", keydown);
    return () => control.removeEventListener("keydown", keydown);
  }, [suggestions, selected, editor, keybindings]);
  if (!suggestions?.items.length) return null;
  return (
    <div className="command-suggestions">
      <CompletionMenu
        options={suggestions.items}
        selected={suggestions.items[selected]?.value ?? ""}
        label={t("补全建议")}
        onSelect={(value) => {
          const item = suggestions.items.find((item) => item.value === value);
          if (item) complete(item);
        }}
      />
    </div>
  );
}
