import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

function terminalNode(
  node: DesktopNode,
): Extract<DesktopNode, { kind: "terminal" }> | undefined {
  if (node.kind === "terminal") return node;
  if (node.kind === "region") return terminalNode(node.child);
  if ("children" in node)
    for (const child of node.children) {
      const terminal = terminalNode(child);
      if (terminal) return terminal;
    }
}

export async function verifyTerminalMouse(page: Page, nested = false) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: "/terminal-mouse-probe" + (nested ? " nested" : ""),
  });
  const fallback = page.getByLabel("扩展终端组件");
  const screen = fallback.locator(".xterm-screen");
  await expect(screen).toBeVisible();
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const surface = snapshot.desktopSurfaces.find((s) => s.slot === "dialog")!;
  const node = terminalNode(surface.view)!;
  expect(node).toBeTruthy();
  await expect
    .poll(() =>
      screen.evaluate((element) =>
        Number(
          element.closest<HTMLElement>("[data-component-columns]")?.dataset
            .componentColumns,
        ),
      ),
    )
    .toBe(node.cols);
  const box = (await screen.boundingBox())!;
  const cell = box.width / node.cols;
  const line = box.height / node.rows;
  const events = async () => {
    const value = await sdkAction<DesktopSnapshot>(page, "snapshot");
    return JSON.parse(value.statuses["terminal-mouse-events"]);
  };
  await page.mouse.click(box.x + cell * 3.5, box.y + line * 1.5);
  await expect
    .poll(
      async () =>
        (await events()).filter((e: any) => e.type === "click").length,
    )
    .toBe(1);
  const press = (await events()).find(
    (e: any) => e.owner === "child" && e.type === "press",
  );
  expect(press).toMatchObject({
    x: 3,
    y: 1,
    width: node.cols,
    height: node.rows,
    button: "left",
  });
  await sdkAction(page, "prompt", { message: "/terminal-mouse-state" });
  expect(
    JSON.parse(
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
        "terminal-mouse-focus"
      ],
    ),
  ).toMatchObject({ target: true, input: true });
  await page.keyboard.press("x");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "terminal-mouse-key"
        ],
    )
    .toBe("x");
  await page.mouse.move(box.x + cell * 2.5, box.y + line * 0.5);
  await page.mouse.down();
  await expect
    .poll(
      async () =>
        (await events()).filter((e: any) => e.type === "press").length,
    )
    .toBe(2);
  await page.mouse.move(box.x + cell * 6.5, box.y + box.height + line * 2.5);
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await events()).some(
        (e: any) => e.type === "release" && e.y >= node.rows,
      ),
    )
    .toBe(true);
  expect((await events()).filter((e: any) => e.type === "click")).toHaveLength(
    1,
  );
  await page.mouse.move(box.x + cell * 3.5, box.y + line * 1.5);
  await page.mouse.wheel(0, line * 2);
  await expect
    .poll(
      async () =>
        (await events()).filter((e: any) => e.type === "wheel").length,
    )
    .toBe(nested ? 2 : 1);
  const wheel = (await events()).filter((e: any) => e.type === "wheel");
  expect(wheel[0]).toMatchObject({ owner: "child", x: 3, y: 1, wheelDelta: 2 });
  if (nested) expect(wheel[1].owner).toBe("parent");
  const scroll = await fallback.evaluate((element, offset) => {
    element.scrollLeft = offset;
    return {
      left: element.scrollLeft,
      maximum: element.scrollWidth - element.clientWidth,
    };
  }, cell * 20);
  if (scroll.maximum > 0) expect(scroll.left).toBeGreaterThan(0);
  const scrolled = (await screen.boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.click(scrolled.x + cell * 25.5, scrolled.y + line * 1.5);
  await page.keyboard.up("Shift");
  await expect
    .poll(
      async () =>
        (await events()).filter((e: any) => e.type === "press").length,
    )
    .toBe(3);
  expect(
    (await events()).filter((e: any) => e.type === "press").at(-1),
  ).toMatchObject({ x: 25, y: 1, shift: true, width: node.cols });
  await fallback.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.screenshot({
    path: `.local/screenshots/terminal-mouse-${nested ? "nested" : "root"}-${page.viewportSize()?.width ?? "native"}.png`,
  });
  await fallback.locator(".xterm-helper-textarea").press("Enter");
  await pending;
  await expect(fallback).toHaveCount(0);
}

export async function verifyTerminalFocus(page: Page) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: "/terminal-focus-probe",
  });
  const terminal = page.getByLabel("扩展终端组件");
  await expect(terminal.locator(".xterm-helper-textarea")).toBeFocused();
  await page.keyboard.press("f");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "terminal-focus-key"
        ],
    )
    .toBe("f");
  await pending;
  await expect(terminal).toHaveCount(0);
}

export async function verifyTerminalPresentation(page: Page) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const hostColors = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const colors = { foreground: { r: 0, g: 0, b: 0 }, background: { r: 0, g: 0, b: 0 } };
    for (const [key, property] of [["foreground", "--ui-ink"], ["background", "--ui-canvas"]] as const) {
      const sample = document.createElement("span");
      sample.style.color = styles.getPropertyValue(property);
      document.body.append(sample);
      const [r, g, b] = getComputedStyle(sample).color.match(/\d+/g)!.map(Number);
      sample.remove();
      colors[key] = { r, g, b };
    }
    return colors;
  });
  const panel = page.getByRole("region", { name: "Pi 终端", exact: true });
  await sdkAction(page, "prompt", { message: "/terminal-colors-probe" });
  await expect
    .poll(async () => {
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      return snapshot.statuses["terminal-colors"] ?? "";
    })
    .toContain('"palette"');
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const results = JSON.parse(snapshot.statuses["terminal-colors"]);
  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.foreground).toEqual(hostColors.foreground);
    expect(result.background).toEqual(hostColors.background);
    expect(result.palette).toHaveLength(16);
  }
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: "终端", exact: true }).click();
  await sdkAction(page, "prompt", { message: "/terminal-colors-change" });
  await expect(panel.locator(".xterm-rows")).toContainText(
    "COLOR_THEME_CHANGED",
  );
  await sdkAction(page, "prompt", { message: "/terminal-colors-probe" });
  await expect
    .poll(async () => {
      const current = await sdkAction<DesktopSnapshot>(page, "snapshot");
      return JSON.parse(current.statuses["terminal-colors"])[0].foreground;
    })
    .toEqual({ r: 16, g: 32, b: 48 });
  const changed = await sdkAction<DesktopSnapshot>(page, "snapshot");
  for (const result of JSON.parse(changed.statuses["terminal-colors"])) {
    expect(result.background).toEqual({ r: 64, g: 80, b: 96 });
    expect(result.palette[1]).toEqual({ r: 112, g: 128, b: 144 });
  }
  const previousTheme = changed.extensionUI.theme?.followsSystem ? "system" : changed.extensionUI.theme?.appearance ?? "light";
  await sdkAction(page, "theme.set", { theme: changed.extensionUI.theme?.appearance === "dark" ? "light" : "dark" });
  await sdkAction(page, "prompt", { message: "/terminal-colors-probe" });
  await expect.poll(async () => {
    const current = await sdkAction<DesktopSnapshot>(page, "snapshot");
    return JSON.parse(current.statuses["terminal-colors"]);
  }).toEqual(JSON.parse(changed.statuses["terminal-colors"]));
  await sdkAction(page, "theme.set", { theme: previousTheme });
  await page.getByRole("button", { name: "关闭终端", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "终端", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  const pending = sdkAction(page, "prompt", {
    message: "/terminal-cursor-probe",
  });
  const fallback = page.getByLabel("扩展终端组件");
  await fallback.locator(".xterm-screen").click({ position: { x: 20, y: 10 } });
  await expect(fallback.locator(".xterm-cursor")).toHaveText("t");
  await expect(fallback.locator(".xterm-rows > div").nth(1)).toContainText(
    "\u754cAtail",
  );
  await page.screenshot({ path: ".local/screenshots/xterm-cursor.png" });
  await page.keyboard.press("Enter");
  await pending;
  await expect(fallback).toHaveCount(0);
}

export async function verifyTerminal(page: Page) {
  await verifyTerminalFocus(page);
  await verifyTerminalMouse(page);
  await verifyTerminalMouse(page, true);
  await verifyTerminalPresentation(page);
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const running = sdkAction(page, "prompt", { message: "/terminal-probe" });
  const panel = page.getByRole("region", { name: "Pi 终端", exact: true });
  await expect(panel.locator(".xterm-screen")).toBeVisible();
  await expect
    .poll(async () => {
      const value = await sdkAction<{ chunks: { data: string }[] }>(
        page,
        "terminal.snapshot",
      );
      return value.chunks.map((chunk) => chunk.data).join("");
    })
    .toContain("PTY_READY:");
  await panel.locator(".xterm-screen").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("q");
  await running;
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "pty-result"
        ],
    )
    .toBe("PTY_EXIT:7");
  await page.setViewportSize({ width: 1024, height: 740 });
  await expect
    .poll(
      async () =>
        (await sdkAction<{ cols: number }>(page, "terminal.snapshot")).cols,
    )
    .toBeGreaterThan(20);
  await panel.getByRole("button", { name: "收起终端" }).click();
  await sdkAction(page, "prompt", { message: "/mapped-unsupported" });
  const fallback = page.getByLabel("扩展终端组件");
  await expect(fallback).toBeVisible();
  await fallback.locator(".xterm-screen").click({ position: { x: 20, y: 10 } });
  await page.keyboard.press("x");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "terminal-fallback"
        ],
    )
    .toBe("x");
  await fallback.locator(".xterm-helper-textarea").press("Enter");
  await expect(fallback).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "terminal-fallback-result"
        ],
    )
    .toBe("x");
  await sdkAction(page, "prompt", { message: "/raw-terminal-probe" });
  await expect(panel.locator(".xterm-screen")).toBeVisible();
  await panel.locator(".xterm-screen").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("z");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "raw-result"
        ],
    )
    .toBe("RAW_OK");
  await page.screenshot({ path: ".local/screenshots/xterm-terminal.png" });
}
