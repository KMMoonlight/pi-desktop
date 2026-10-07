import { expect, type Page, type Route } from "@playwright/test";
import type { DesktopSnapshot } from "../shared/types.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import { sdkAction } from "./editor-workflows.ts";

function nodes(node: DesktopNode): DesktopNode[] {
  return [
    node,
    ...("children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : []
    ).flatMap(nodes),
  ];
}

export async function verifyLayoutOrder(
  page: Page,
  mode: "action" | "keyboard" | "mouse",
  screenshot?: string,
  blockLayoutReply = false,
) {
  let block = false;
  let layoutReplies = 0;
  let releaseLayout = () => {};
  const layoutGate = new Promise<void>((resolve) => {
    releaseLayout = resolve;
  });
  const gate = async (route: Route) => {
    const payload = route.request().postDataJSON();
    if (
      block &&
      payload.action === "desktop.action" &&
      payload.args?.action?.endsWith(":layout") &&
      payload.args.value?.contentHeight === 60
    ) {
      layoutReplies++;
      const response = await route.fetch();
      await layoutGate;
      await route.fulfill({ response });
    } else await route.continue();
  };
  if (blockLayoutReply) await page.route("**/api/action", gate);
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await page.evaluate(() => {
    const state = window as unknown as {
      holdScrollLayouts: boolean;
      originalResizeObserver: typeof ResizeObserver;
    };
    state.originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends state.originalResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          const current = entries.filter(
            (entry) =>
              !state.holdScrollLayouts ||
              !entry.target.closest(".desktop-scroll"),
          );
          if (current.length) callback(current, observer);
        });
      }
    };
  });
  try {
    await sdkAction(page, "prompt", { message: "/layout-order-probe" });
    const dialog = page.getByRole("dialog");
    const scroll = dialog.locator(".desktop-scroll");
    const select = dialog.getByRole("combobox", { name: "选择", exact: true });
    const choose = async (value: string) => {
      await select.selectOption(value);
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
    };
    const status = async (name: string) =>
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[name];
    await expect.poll(() => status("layout-order-dimensions")).toMatch(/^60:/);
    await choose("short");
    await expect(scroll).toContainText("Short layout content");
    await expect.poll(() => status("layout-order-dimensions")).toBe("1:1");
    await choose("auto");
    await page.evaluate(() => {
      (window as unknown as { holdScrollLayouts: boolean }).holdScrollLayouts =
        true;
    });
    await choose("long");
    await expect(scroll).toContainText("Layout row 60");
    expect(
      await scroll.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);
    expect(await status("layout-order-dimensions")).toBe("1:1");
    block = blockLayoutReply;
    let operation: Promise<void>;
    if (mode === "action") operation = choose("active");
    else if (mode === "keyboard") {
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      const surface = snapshot.desktopSurfaces.find(
        (item) => item.slot === "dialog",
      )!;
      const control = nodes(surface.view).find(
        (node) => node.kind === "select",
      )!;
      if (control.kind !== "select")
        throw new Error("Missing original selection");
      await sdkAction(page, "desktop.action", {
        id: surface.id,
        instanceId: surface.instanceId,
        action: control.action,
        value: "active",
      });
      await select.focus();
      operation = select.press("Enter");
    } else {
      const bounds = (await scroll.boundingBox())!;
      operation = page.mouse.click(bounds.x + 30, bounds.y + 20);
    }
    if (blockLayoutReply) {
      await expect.poll(() => layoutReplies).toBe(1);
      expect(await status("layout-order-action")).toBe("long");
      releaseLayout();
    }
    await operation;
    if (mode === "mouse")
      await expect.poll(() => status("layout-order-pointer")).toMatch(/^60:/);
    if (mode !== "mouse")
      await expect(scroll).toHaveCSS(
        "scrollbar-color",
        "rgb(128, 0, 0) rgb(0, 0, 128)",
      );
    await expect.poll(() => status("layout-order-dimensions")).toMatch(/^60:/);
    if (screenshot) await page.screenshot({ path: screenshot });
    await choose("close");
    await expect(dialog).toBeHidden();
  } finally {
    releaseLayout();
    if (blockLayoutReply) await page.unroute("**/api/action", gate);
    await page.evaluate(() => {
      const state = window as unknown as {
        holdScrollLayouts: boolean;
        originalResizeObserver: typeof ResizeObserver;
      };
      state.holdScrollLayouts = false;
      window.ResizeObserver = state.originalResizeObserver;
    });
  }
}
