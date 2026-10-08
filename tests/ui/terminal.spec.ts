import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import {
  verifyTerminal,
  verifyTerminalMouse,
  verifyTerminalFocus,
} from "../terminal-workflows.ts";

test("opening the terminal starts an interactive workspace shell with compact toolbar controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "终端", exact: true }).click();
  const panel = page.getByRole("region", { name: "Pi 终端", exact: true });
  const shell = panel.locator('[data-terminal-source="shell"]');
  const screen = shell.locator(".xterm-screen");
  await expect(screen).toBeVisible();
  await expect
    .poll(
      async () =>
        (await sdkAction<{ chunks: unknown[] }>(page, "shell.snapshot")).chunks
          .length,
    )
    .toBeGreaterThan(0);
  await screen.click({ position: { x: 20, y: 20 } });
  await page.keyboard.type('echo "UI_SHELL_WORKS"');
  await page.keyboard.press("Enter");
  await expect(
    shell
      .locator(".xterm-rows > div")
      .filter({ hasText: /^UI_SHELL_WORKS\s*$/ }),
  ).toHaveCount(1);
  const interrupt = panel.getByRole("button", { name: "中断 Ctrl+C" });
  const clear = panel.getByRole("button", { name: "清屏", exact: true });
  const close = panel.getByRole("button", { name: "关闭终端", exact: true });
  const buttons = await Promise.all([
    interrupt.boundingBox(),
    clear.boundingBox(),
    close.boundingBox(),
  ]);
  for (const button of buttons) {
    expect(button!.width).toBe(32);
    expect(button!.height).toBe(32);
  }
  expect(buttons[1]!.x - buttons[0]!.x).toBe(36);
  expect(buttons[2]!.x - buttons[1]!.x).toBe(36);
  await page.keyboard.type("unfinished_command");
  await interrupt.click();
  await expect(shell.locator(".xterm-helper-textarea")).toBeFocused();
  await page.keyboard.type('echo "UI_INTERRUPTED"');
  await page.keyboard.press("Enter");
  await expect(
    shell
      .locator(".xterm-rows > div")
      .filter({ hasText: /^UI_INTERRUPTED\s*$/ }),
  ).toHaveCount(1);
  await clear.click();
  await expect(shell.locator(".xterm-rows")).not.toContainText(
    "UI_SHELL_WORKS",
  );
  const initial = await sdkAction<{ terminalId: string }>(
    page,
    "shell.snapshot",
  );
  await close.click();
  await page.getByRole("button", { name: "终端", exact: true }).click();
  expect(
    (await sdkAction<{ terminalId: string }>(page, "shell.snapshot"))
      .terminalId,
  ).toBe(initial.terminalId);
  await page.setViewportSize({ width: 1024, height: 740 });
  await shell.locator(".xterm-helper-textarea").press("Enter");
  await page.screenshot({ path: ".local/screenshots/workspace-shell.png" });
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await panel.getByRole("button", { name: "重新启动终端" }).click();
  await expect
    .poll(
      async () =>
        (await sdkAction<{ terminalId: string }>(page, "shell.snapshot"))
          .terminalId,
    )
    .not.toBe(initial.terminalId);
  await expect(shell.locator(".xterm-helper-textarea")).toBeFocused();
  await close.click();
});

for (const width of [1440, 390])
  test(`render-only component mouse handlers receive real xterm pointer input at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyTerminalMouse(page);
    await verifyTerminalMouse(page, true);
  });

test("render-only component focus enters xterm through the original TUI focus request", async ({
  page,
}) => {
  await page.goto("/");
  await verifyTerminalFocus(page);
});

test("xterm supports inherited subprocesses, resize, terminal APIs and custom component callbacks", async ({
  page,
}) => {
  await page.goto("/");
  await verifyTerminal(page);
});

test("pending color probes replay when the renderer connects after timeout", async ({
  page,
  request,
}) => {
  const { token } = await (await request.get("/api/token")).json();
  const call = async (action: string) => {
    const response = await request.post("/api/action", {
      headers: { "x-desktop-token": token },
      data: {
        action,
        args:
          action === "prompt" ? { message: "/terminal-colors-late-probe" } : {},
      },
    });
    const value = await response.json();
    expect(value.error).toBeUndefined();
    return value.data;
  };
  await call("prompt");
  await expect
    .poll(
      async () => (await call("snapshot")).statuses["terminal-colors-partial"],
    )
    .toBe("{}");
  expect(await call("terminal.query.list")).toHaveLength(1);
  await page.goto("/");
  await expect
    .poll(
      async () =>
        (await call("snapshot")).statuses["terminal-colors-late"] ?? "",
    )
    .toContain('"palette"');
  expect(await call("terminal.query.list")).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "终端", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
});
