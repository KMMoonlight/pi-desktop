import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { Run } from "./Workspace";

let synchronize: (() => Promise<void>) | undefined;
let pending = Promise.resolve();

export function syncTranscriptLayout(): Promise<void> {
  return synchronize?.() ?? Promise.resolve();
}

export function TranscriptLayout({
  backendId,
  sessionId,
  ready,
  outputPad,
  messagesVisible,
  run,
}: {
  backendId: string;
  sessionId: string;
  ready: boolean;
  outputPad: number;
  messagesVisible: boolean;
  run: Run;
}) {
  const probe = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ready || !probe.current) return;
    const element = probe.current;
    const chat = element.parentElement!;
    const samples = [
      ...element.querySelectorAll<HTMLElement>("[data-transcript-measure]"),
    ];
    const transcript = chat.querySelector<HTMLElement>(".transcript");
    let active = true;
    let previous = "";
    let current = Promise.resolve();
    const measure = () => {
      if (!active || !element.isConnected) return undefined;
      const scrollbar = transcript
        ? Math.max(0, transcript.offsetWidth - transcript.clientWidth)
        : 0;
      element.style.right = `${scrollbar}px`;
      const widths: Record<string, number> = {};
      for (const sample of samples) {
        const body = sample.parentElement!;
        // A zero-height child reports the browser's used content width, including
        // subpixel padding rounding, rather than subtracting computed CSS values.
        const available = body
          .querySelector<HTMLElement>(".transcript-content-width")!
          .getBoundingClientRect().width;
        const cell =
          sample.getBoundingClientRect().width / sample.textContent!.length;
        if (!(available > 0) || !(cell > 0)) return undefined;
        widths[sample.dataset.transcriptMeasure!] = Math.max(
          1,
          Math.floor(available / cell),
        );
      }
      const cell = samples.find(
        (sample) => sample.dataset.transcriptMeasure === "user",
      )!;
      const cellWidth =
        cell.getBoundingClientRect().width / cell.textContent!.length;
      const users: Record<string, number> = {};
      chat
        .querySelectorAll<HTMLElement>(".transcript .message-user")
        .forEach((message) => {
          const body = message.querySelector<HTMLElement>(
            ".transcript-markdown-body",
          );
          if (!body || !message.dataset.messageId) return;
          const width = body
            .querySelector<HTMLElement>(".transcript-content-width")!
            .getBoundingClientRect().width;
          if (width > 0 && cellWidth > 0)
            users[message.dataset.messageId] = Math.max(
              1,
              Math.floor(width / cellWidth),
            );
        });
      return { ...widths, users };
    };
    const update = () => {
      const widths = measure();
      if (!widths) return current;
      const key = JSON.stringify(widths);
      if (key === previous) return current;
      previous = key;
      current = pending.then(async () => {
        if (!active) return;
        const latest = measure();
        if (!latest) {
          previous = "";
          return;
        }
        const result = await run<{ accepted: boolean }>("transcript.layout", {
          backendId,
          sessionId,
          widths: latest,
        });
        if (!result?.accepted) previous = "";
      });
      pending = current.catch(() => {
        previous = "";
      });
      return current;
    };
    synchronize = update;
    const observer = new ResizeObserver(() => void update().catch(() => {}));
    observer.observe(chat);
    for (const sample of samples) {
      observer.observe(sample);
      observer.observe(sample.parentElement!);
    }
    if (transcript) observer.observe(transcript);
    const observeUsers = () => {
      chat
        .querySelectorAll(".transcript .message-user .message-body")
        .forEach((body) => observer.observe(body));
    };
    const mutations = new MutationObserver(() => {
      observeUsers();
      void update().catch(() => {});
    });
    if (transcript)
      mutations.observe(transcript, { childList: true, subtree: true });
    observeUsers();
    const fonts = () => void update().catch(() => {});
    document.fonts.addEventListener("loadingdone", fonts);
    void document.fonts.ready
      .then(() => {
        if (active) return update();
      })
      .catch(() => {});
    void update().catch(() => {});
    return () => {
      active = false;
      if (synchronize === update) synchronize = undefined;
      observer.disconnect();
      mutations.disconnect();
      document.fonts.removeEventListener("loadingdone", fonts);
    };
  }, [backendId, sessionId, ready, outputPad, messagesVisible, run]);
  return (
    <div
      ref={probe}
      className="transcript-layout"
      aria-hidden="true"
      inert
      style={{ "--transcript-output-pad": outputPad } as CSSProperties}
    >
      <div className="transcript-inner">
        <div className="message message-user">
          <div className="message-body transcript-user-measure">
            <div className="markdown transcript-markdown-body">
              <span className="transcript-content-width" />
              <span data-transcript-measure="user">{"0".repeat(32)}</span>
            </div>
          </div>
        </div>
        <div className="message">
          <div className="message-avatar" />
          <div className="message-body">
            <div className="markdown transcript-markdown-body">
              <span className="transcript-content-width" />
              <span data-transcript-measure="text">{"0".repeat(32)}</span>
            </div>
            <div className="thinking-block">
              <div className="transcript-markdown-body">
                <span className="transcript-content-width" />
                <span data-transcript-measure="thinking">{"0".repeat(32)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
