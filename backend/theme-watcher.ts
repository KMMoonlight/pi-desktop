import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";

export function watchThemeFile(
  path: string,
  load: () => Theme,
  changed: (theme: Theme) => void,
): () => void {
  let watcher: FSWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const close = () => {
    stopped = true;
    clearTimeout(timer);
    watcher?.close();
  };
  try {
    // Watching the directory survives editors replacing the file by rename.
    watcher = watch(dirname(path), { persistent: false }, (_, filename) => {
      if (stopped || (filename && filename.toString() !== basename(path)))
        return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (stopped) return;
        try {
          changed(load());
        } catch {
          // Keep the last valid theme while a file is missing or being edited.
        }
      }, 100);
      timer.unref();
    });
    watcher.on("error", close);
  } catch {
    close();
  }
  return close;
}
