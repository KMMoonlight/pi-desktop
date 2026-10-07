import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";

export function useSessionDraft(key?: string) {
  const read = () =>
    key ? (localStorage.getItem(`pi.draft.${key}`) ?? "") : "";
  const [draft, setDraft] = useState({ key, text: read() });
  const activeKey = useRef(key);
  activeKey.current = key;
  const text = draft.key === key ? draft.text : read();
  const setText = useCallback((value: SetStateAction<string>) => {
    setDraft((previous) => {
      const key = activeKey.current;
      const current =
        previous.key === key
          ? previous.text
          : key
            ? (localStorage.getItem(`pi.draft.${key}`) ?? "")
            : "";
      return {
        key,
        text: typeof value === "function" ? value(current) : value,
      };
    });
  }, []);
  useEffect(() => {
    if (key) localStorage.setItem(`pi.draft.${key}`, text);
  }, [key, text]);
  return [text, setText] as const;
}
