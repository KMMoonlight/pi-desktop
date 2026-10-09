import React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import "../src/tailwind.css";

const state = { checks: 0, downloads: 0, installs: 0, restarts: 0, confirmed: false, finish: () => {} };
Object.assign(window, { isTauri: true, updateTest: state });
mockIPC(async (command, raw) => {
  const args = raw as { onEvent?: { onmessage: (event: unknown) => void } };
  if (command === "plugin:app|version") return "0.1.2";
  if (command === "updater_configured") return true;
  if (command === "plugin:updater|check") {
    state.checks++;
    return { rid: 1, currentVersion: "0.1.2", version: "0.2.0", body: "修复问题并改善性能。", rawJson: {} };
  }
  if (command === "plugin:updater|download") {
    state.downloads++;
    args.onEvent?.onmessage({ event: "Started", data: { contentLength: 100 } });
    args.onEvent?.onmessage({ event: "Progress", data: { chunkLength: 50 } });
    await new Promise<void>(resolve => { state.finish = resolve; });
    args.onEvent?.onmessage({ event: "Finished" });
    return 2;
  }
  if (command === "plugin:dialog|message") return state.confirmed ? "安装并重启" : "取消";
  if (command === "plugin:updater|install") { state.installs++; return; }
  if (command === "plugin:process|restart") { state.restarts++; return; }
  throw new Error(`Unexpected update IPC: ${command}`);
});
const { AppUpdates } = await import("../src/AppUpdates");
const { startUpdateChecks } = await import("../src/updates");
createRoot(document.getElementById("root")!).render(<main className="settings-view bg-canvas p-6 text-ink" style={{ display: "block", maxWidth: 700, margin: "40px auto" }}><AppUpdates /></main>);
startUpdateChecks();
