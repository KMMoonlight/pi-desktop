import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

type InputGate = {
  fetch: typeof fetch;
  waiting: boolean;
  used: boolean;
  release?: () => void;
};
type GateWindow = Window & { dialogInputGate?: InputGate };

export async function verifyDialogOrder(page: Page) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  for (const kind of ["input", "editor"] as const) {
    for (const cancel of [false, true]) {
      await sdkAction(page, "prompt", {
        message: `/dialog-text-probe ${kind}`,
      });
      const dialog = page.getByRole("dialog");
      const input = dialog.getByRole("textbox");
      await input.fill("old");
      await expect(input).toHaveValue("old");
      await input.press("End");
      await page.evaluate(() => {
        const target = window as GateWindow;
        const gate: InputGate = {
          fetch: target.fetch,
          waiting: false,
          used: false,
        };
        target.dialogInputGate = gate;
        target.fetch = async (input, options) => {
          const url = new URL(
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
            location.href,
          );
          const request = ["/api/action", "/sdk_action"].includes(
            decodeURIComponent(url.pathname),
          )
            ? (JSON.parse(String(options?.body ?? "{}")) as {
                action?: string;
                args?: { event?: { key?: string }; dialogId?: string };
              })
            : undefined;
          const response = await gate.fetch.call(window, input, options);
          if (
            !gate.used &&
            request?.action === "desktop.input" &&
            request.args?.dialogId &&
            request.args.event?.key === "x"
          ) {
            gate.used = true;
            gate.waiting = true;
            await new Promise<void>((resolve) => {
              gate.release = resolve;
            });
            gate.waiting = false;
          }
          return response;
        };
      });
      try {
        await input.pressSequentially("x");
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as GateWindow).dialogInputGate?.waiting,
            ),
          )
          .toBe(true);
        await dialog.getByRole("button", { name: "确认", exact: true }).click();
        if (cancel) {
          await dialog
            .getByRole("button", { name: "取消", exact: true })
            .click();
          await expect(dialog).toBeHidden();
          await sdkAction(page, "prompt", {
            message: `/dialog-text-probe ${kind}`,
          });
          await expect(dialog).toBeVisible();
          await input.fill("replacement");
        }
        await page.evaluate(() =>
          (window as GateWindow).dialogInputGate?.release?.(),
        );
        if (cancel) {
          await expect(input).toHaveValue("replacement");
          await dialog
            .getByRole("button", { name: "确认", exact: true })
            .click();
        }
        await expect(dialog).toBeHidden();
        await expect
          .poll(
            async () =>
              (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
                "dialog-text-result"
              ],
          )
          .toBe(JSON.stringify({ value: cancel ? "replacement" : "oldx" }));
      } finally {
        await page.evaluate(() => {
          const target = window as GateWindow;
          const gate = target.dialogInputGate;
          gate?.release?.();
          if (gate) target.fetch = gate.fetch;
          delete target.dialogInputGate;
        });
      }
    }
  }
}
