import { t, localizeText } from "./i18n";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import type {
  DesktopEvent,
  DialogRequest,
  RecordValue,
} from "../shared/types.ts";
import { subscribeWithDialogReplay } from "./dialog-replay";
import { desktopExternalLink, isCustomExternalProtocol } from "../shared/links";
import { errorMessage } from "../shared/errors";
import { BrowserTransport } from "./http-client";
import { SnapshotDecoder, type DesktopWireEvent } from "../shared/snapshot-transport";

const browserTransport = new BrowserTransport();
let actionSession: string | undefined;
export function setActionSession(sessionId: string | undefined) {
  actionSession = sessionId;
}
export async function action<T = unknown>(
  name: string,
  args?: RecordValue,
): Promise<T> {
  // Capture the owner before transport/auth awaits; a tab switch must not
  // redirect an already initiated prompt, stop, or editor operation.
  args = { __sessionId: args?.sessionId ?? actionSession, ...args };
  if (isTauri())
    return invoke<T>("sdk_action", { action: name, args: args ?? {} }).catch(
      (error) => {
        throw new Error(localizeText(errorMessage(error)));
      },
    );
  return browserTransport.action<T>(name, args);
}
export async function subscribe(
  handler: (event: DesktopEvent) => void,
  connection: (connected: boolean, restarted?: boolean) => void,
): Promise<() => void> {
  if (isTauri()) {
    const snapshots = new SnapshotDecoder();
    let resync: Promise<unknown> | undefined;
    const unlisten = await subscribeWithDialogReplay(
      (receive) =>
        listen<DesktopWireEvent>("pi:event", (event) => {
          const decoded = snapshots.decode(event.payload);
          if (decoded) receive(decoded);
          else if (!resync) {
            resync = action("transport.snapshot").finally(() => { resync = undefined; });
            void resync.catch(console.error);
          }
        }),
      () => action<DialogRequest[]>("dialog.list"),
      handler,
    );
    await action("transport.snapshot");
    connection(true);
    return unlisten;
  }
  return browserTransport.subscribe(handler, connection);
}
/** Terminal output must not wait for an SDK dialog replay during spawnSync. */
export async function subscribeTerminal(
  handler: (event: DesktopEvent) => void,
  connection: (connected: boolean, restarted?: boolean) => void = () => {},
) {
  if (isTauri()) {
    const unlisten = await listen<DesktopEvent>("pi:event", (event) =>
      handler(event.payload),
    );
    connection(true);
    return unlisten;
  }
  return subscribe(handler, connection);
}
export async function selectFolder(): Promise<string | null | undefined> {
  return isTauri()
    ? await open({
        directory: true,
        multiple: false,
        title: t("选择文件夹并新建会话"),
      })
    : undefined;
}
export async function selectSession(): Promise<string | null | undefined> {
  return isTauri()
    ? await open({
        multiple: false,
        filters: [{ name: t("Pi 会话"), extensions: ["jsonl"] }],
      })
    : undefined;
}
export async function exportPath(
  format: string,
): Promise<string | null | undefined> {
  return isTauri()
    ? await save({
        defaultPath: `session.${format}`,
        filters: [{ name: t("Pi 会话"), extensions: [format] }],
      })
    : undefined;
}
export async function external(url: string) {
  const destination = desktopExternalLink(url);
  if (!destination) throw new Error(t("链接协议不受支持"));
  if (new URL(destination).protocol === "file:") {
    if (!isTauri()) throw new Error(t("文件链接需要在桌面应用中打开"));
    const { path } = await action<{ path: string }>("files.resolveLink", {
      url: destination,
      mustExist: true,
    });
    await openPath(path);
    return;
  }
  if (isTauri() && isCustomExternalProtocol(destination))
    await invoke("open_external_protocol", { url: destination });
  else if (isTauri()) await openUrl(destination);
  else window.open(destination, "_blank", "noopener,noreferrer");
}
export async function closeDesktop() {
  if (isTauri()) await getCurrentWindow().close();
}

let windowStateQueue = Promise.resolve();
export function setDesktopWindowState(title: string, progress: boolean) {
  document.title = title;
  if (!isTauri()) return Promise.resolve();
  const pending = windowStateQueue
    .catch(() => {})
    .then(async () => {
      const window = getCurrentWindow();
      await window.setTitle(title);
      await window.setProgressBar({
        status: progress
          ? ProgressBarStatus.Indeterminate
          : ProgressBarStatus.None,
      });
    });
  windowStateQueue = pending;
  return pending;
}
