import type { DesktopEvent, DialogRequest } from "../shared/types";

/** Subscribe before reading pending dialogs so concurrent opens/closes cannot be lost. */
export async function subscribeWithDialogReplay(
  listen: (handler: (event: DesktopEvent) => void) => Promise<() => void>,
  read: () => Promise<DialogRequest[]>,
  handler: (event: DesktopEvent) => void,
): Promise<() => void> {
  let pending: DesktopEvent[] | undefined = [];
  const unlisten = await listen((event) => {
    if (pending && (event.type === "dialog" || event.type === "dialog_closed"))
      pending.push(event);
    else handler(event);
  });
  try {
    const current = new Map(
      (await read()).map((dialog) => [dialog.id, dialog]),
    );
    for (const event of pending) {
      if (event.type === "dialog") current.set(event.data.id, event.data);
      else if (event.type === "dialog_closed") current.delete(event.id);
    }
    pending = undefined;
    for (const data of current.values()) handler({ type: "dialog", data });
    return unlisten;
  } catch (error) {
    pending = undefined;
    unlisten();
    throw error;
  }
}
