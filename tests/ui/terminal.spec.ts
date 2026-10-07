import { test, expect } from "@playwright/test";
import {
  verifyTerminal,
  verifyTerminalMouse,
  verifyTerminalFocus,
} from "../terminal-workflows.ts";

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
