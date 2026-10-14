import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
let copies = [],
  fail = false,
  release,
  originalStream,
  pending;
export default async function (
  { host, session, sdk, desktop },
  { action, bindings = {}, fallback = false },
) {
  if (action === "clipboard") {
    copies = [];
    host.setClipboard({
      getText: async () => null,
      getImage: async () => null,
      setText: async (text) => {
        if (fail) {
          fail = false;
          throw new Error("Fixture clipboard unavailable");
        }
        copies.push(text);
      },
    });
  }
  if (action === "copies") return copies;
  if (action === "fail-copy") fail = true;
  if (action === "keys") {
    const path = join(host.agentDir, "keybindings.json");
    const keys = JSON.parse(await readFile(path, "utf8"));
    Object.assign(keys, bindings);
    await writeFile(path, JSON.stringify(keys));
  }
  if (action === "editor") {
    session.settingsManager.applyOverrides({
      compaction: { keepRecentTokens: 1, reserveTokens: 100 },
    });
    session.extensionRunner
      .getUIContext()
      .setEditorComponent(
        (tui, theme, keys) =>
          new sdk.CustomEditor(
            tui,
            {
              ...theme,
              borderColor: (text) => `\x1b[38;2;11;122;99m${text}\x1b[0m`,
            },
            keys,
            { embedWorkingStatus: true },
          ),
      );
  }
  if (action === "compact") {
    originalStream = session.agent.streamFunction;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    session.agent.streamFunction = async (...args) => {
      await gate;
      return originalStream(...args);
    };
    pending = session.compact();
    void pending.catch(() => {});
  }
  if (action === "release") {
    release?.();
    await pending;
    session.agent.streamFunction = originalStream;
  }
  if (action === "cleanup") {
    release?.();
    await pending?.catch(() => {});
    if (originalStream) session.agent.streamFunction = originalStream;
    session.extensionRunner.getUIContext().setEditorComponent(undefined);
    host.setClipboard();
  }
}
