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
  await expect(panel.getByRole("button", { name: "中断 Ctrl+C" })).toHaveCount(
    0,
  );
  await expect(
    panel.getByRole("button", { name: "清屏", exact: true }),
  ).toHaveCount(0);
  const collapse = panel.getByRole("button", { name: "收起终端", exact: true });
  const initial = await sdkAction<{ terminalId: string }>(
    page,
    "shell.snapshot",
  );
  await collapse.click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "终端", exact: true }).click();
  expect(
    (await sdkAction<{ terminalId: string }>(page, "shell.snapshot"))
      .terminalId,
  ).toBe(initial.terminalId);
  await expect(shell.locator(".xterm-rows")).toContainText("UI_SHELL_WORKS");
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
  await collapse.click();
});

test("shell tabs isolate input, preserve hidden processes and close independently", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "终端", exact: true }).click();
  const panel = page.getByRole("region", { name: "Pi 终端", exact: true });
  await expect(
    panel.getByRole("button", { name: "Shell 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const initialIds = await sdkAction<string[]>(page, "shell.list");
  await panel.getByRole("button", { name: "新建终端", exact: true }).click();
  await expect
    .poll(async () => (await sdkAction<string[]>(page, "shell.list")).length)
    .toBe(initialIds.length + 1);
  const ids = await sdkAction<string[]>(page, "shell.list");
  const newId = ids.find((id) => !initialIds.includes(id))!;
  const selected = panel.locator('[data-terminal-source="shell"]:visible');
  await selected.locator(".xterm-helper-textarea").fill("echo TAB_TWO_ONLY");
  await page.keyboard.press("Enter");
  await expect(selected.locator(".xterm-rows")).toContainText("TAB_TWO_ONLY");
  await panel.getByRole("button", { name: "Shell 1", exact: true }).click();
  await expect(selected.locator(".xterm-rows")).not.toContainText(
    "TAB_TWO_ONLY",
  );
  await panel.getByRole("button", { name: "Shell 2", exact: true }).click();
  await panel.getByRole("button", { name: "收起终端", exact: true }).click();
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Shell 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(selected.locator(".xterm-rows")).toContainText("TAB_TWO_ONLY");
  await panel
    .getByRole("button", { name: "关闭终端 Shell 2", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Shell 2", exact: true }),
  ).toHaveCount(0);
  expect(await sdkAction<string[]>(page, "shell.list")).not.toContain(newId);
  await panel.getByRole("button", { name: "收起终端", exact: true }).click();
});

test("terminal links require a modifier and use the external opener", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as any).__openedLinks = [];
    window.open = ((url: string) => {
      (window as any).__openedLinks.push(url);
      return null;
    }) as typeof window.open;
  });
  await page.getByRole("button", { name: "终端", exact: true }).click();
  const shell = page.locator('[data-terminal-source="shell"]:visible');
  await shell.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("printf 'https://example.com/terminal-link\\n'");
  await page.keyboard.press("Enter");
  const link = shell
    .locator(".xterm-rows > div")
    .filter({ hasText: /^https:\/\/example.com\/terminal-link\s*$/ });
  await expect(link).toHaveCount(1);
  await link.click({ position: { x: 40, y: 8 }, force: true });
  expect(await page.evaluate(() => (window as any).__openedLinks)).toEqual([]);
  await link.click({
    position: { x: 40, y: 8 },
    modifiers: ["Meta"],
    force: true,
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__openedLinks))
    .toEqual(["https://example.com/terminal-link"]);
  await shell.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(
    "printf '\\033]8;;https://example.com/osc-link\\007OSC_LINK\\033]8;;\\007\\n'",
  );
  await page.keyboard.press("Enter");
  const osc = shell
    .locator(".xterm-rows > div")
    .filter({ hasText: /^OSC_LINK\s*$/ });
  await expect(osc).toHaveCount(1);
  await osc.hover({ position: { x: 30, y: 8 }, force: true });
  await expect(shell.locator(".xterm-screen")).toHaveClass(
    /xterm-cursor-pointer/,
  );
  await osc.click({
    position: { x: 30, y: 8 },
    modifiers: ["Meta"],
    force: true,
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__openedLinks))
    .toEqual([
      "https://example.com/terminal-link",
      "https://example.com/osc-link",
    ]);
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
