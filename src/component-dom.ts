export function componentControlOwner(target: Element): Element {
  const owner = target.closest<HTMLElement>("[data-desktop-owner]")?.dataset
    .desktopOwner;
  return owner ? (document.getElementById(owner) ?? target) : target;
}

export function componentControlVersion(target: Element): number | undefined {
  const value = target.getAttribute("data-control-version");
  if (value === null) return undefined;
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 ? version : undefined;
}

type LayoutSender = (
  action: string,
  value: { contentHeight: number; viewportHeight: number },
) => Promise<unknown>;
const scrollLayouts = new WeakMap<
  HTMLElement,
  { key: string; valid: boolean; pending: Promise<void> }
>();

/** Join and order actual DOM measurements before original component input. */
export function syncComponentScrollLayout(
  element: HTMLElement,
  send: LayoutSender,
): Promise<void> {
  const content = element.firstElementChild;
  const action = element.dataset.desktopScrollAction;
  const previous = scrollLayouts.get(element);
  if (
    !element.isConnected ||
    !content ||
    !action ||
    element.closest("[inert]") ||
    !element.getClientRects().length
  ) {
    if (previous) previous.valid = false;
    return Promise.resolve();
  }
  const surface = element.closest<HTMLElement>("[data-surface-id]");
  const instance = surface?.dataset.instanceId;
  const epoch = surface?.dataset.layoutEpoch;
  const line = Number.parseFloat(getComputedStyle(element).lineHeight) || 20;
  const value = {
    contentHeight: Math.ceil(content.scrollHeight / line),
    viewportHeight: Math.floor(element.clientHeight / line),
  };
  const key = `${instance}:${epoch}:${action}:${value.contentHeight}:${value.viewportHeight}`;
  if (previous?.key === key && previous.valid) return previous.pending;
  const record = {
    key,
    valid: true,
    pending: (previous?.pending ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (
          !element.isConnected ||
          surface?.dataset.instanceId !== instance ||
          surface?.dataset.layoutEpoch !== epoch ||
          element.dataset.desktopScrollAction !== action ||
          element.closest("[inert]")
        ) {
          record.valid = false;
          return;
        }
        await send(`${action}:layout`, value);
      }),
  };
  scrollLayouts.set(element, record);
  void record.pending.catch(() => {
    record.valid = false;
  });
  return record.pending;
}

export async function syncComponentScrollLayouts(
  target: Element | null,
  send: LayoutSender,
): Promise<void> {
  const surface = target?.closest<HTMLElement>("[data-surface-id]");
  if (!surface?.isConnected) return;
  const elements = [
    ...surface.querySelectorAll<HTMLElement>("[data-desktop-scroll-action]"),
  ];
  for (const element of elements.reverse())
    await syncComponentScrollLayout(element, send);
}

/** Measure the rendered xterm grid, including horizontal scroll offsets. */
export function componentTerminalGeometry(terminal?: HTMLElement) {
  const columns = Number(terminal?.dataset.terminalCols);
  const rows = Number(terminal?.dataset.terminalRows);
  const screen = terminal
    ?.querySelector(".xterm-screen")
    ?.getBoundingClientRect();
  if (!screen?.width || !screen.height || !columns || !rows) return undefined;
  return {
    columns,
    rows,
    screen,
    cell: screen.width / columns,
    line: screen.height / rows,
    owner: terminal!.closest<HTMLElement>("[data-component-key]"),
  };
}
