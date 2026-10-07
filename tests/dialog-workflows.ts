import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyDialogText(page: Page, native = false) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/dialog-text-probe" });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Styled dialog", { exact: true })).toHaveCSS(
    "color",
    "rgb(40, 90, 140)",
  );
  const choices = dialog.getByRole("button", { name: "Choice", exact: true });
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(1).getByText("Choice", { exact: true })).toHaveCSS(
    "color",
    "rgb(30, 130, 60)",
  );
  const link = dialog.getByRole("link", { name: "Read help", exact: true });
  await expect(link).toHaveAttribute("href", "https://example.com/dialog");
  await expect(dialog.locator("button a")).toHaveCount(0);
  await page.screenshot({
    path: `.local/screenshots/dialog-text-${page.viewportSize()?.width ?? "native"}.png`,
  });
  if (!native) {
    await page.evaluate(`(() => {
  const original = window.open;
  window.dialogLinkProbe = { urls: [], restore: () => { window.open = original; } };
  window.open = (url) => { window.dialogLinkProbe.urls.push(url); return null; };
})()`);
    try {
      await link.click();
      await expect(dialog).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => Reflect.get(window, "dialogLinkProbe").urls),
        )
        .toEqual(["https://example.com/dialog"]);
    } finally {
      await page.evaluate(() => {
        Reflect.get(window, "dialogLinkProbe").restore();
        Reflect.deleteProperty(window, "dialogLinkProbe");
      });
    }
  }
  await choices.nth(1).click();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(JSON.stringify({ value: "\x1b[38;2;30;130;60mChoice\x1b[0m" }));
  await sdkAction(page, "prompt", { message: "/dialog-text-probe" });
  await dialog
    .getByRole("button", { name: "选择 Read help", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(
      JSON.stringify({
        value:
          "\x1b]8;;https://example.com/dialog\x1b\\Read help\x1b]8;;\x1b\\",
      }),
    );
  await sdkAction(page, "prompt", { message: "/dialog-text-probe confirm" });
  await expect(dialog.getByText("Confirm text", { exact: true })).toHaveCSS(
    "font-style",
    "italic",
  );
  await expect(dialog).toContainText("<script>literal</script>");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toBeHidden();
  await sdkAction(page, "prompt", { message: "/dialog-text-probe input" });
  await expect(dialog.getByText("Styled hint", { exact: true })).toHaveCSS(
    "color",
    "rgb(80, 130, 30)",
  );
  await dialog
    .getByRole("textbox", { name: "Styled dialog", exact: true })
    .fill("answer");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-text-result"
        ],
    )
    .toBe(JSON.stringify({ value: "answer" }));
}

export async function verifyDialogTimeout(page: Page, native = false) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  for (const kind of ["input", "select", "confirm"]) {
    await sdkAction(page, "prompt", {
      message: `/dialog-timeout-probe ${kind}`,
    });
    const dialog = page.getByRole("dialog");
    const timer = dialog.getByRole("timer");
    await expect(timer).toHaveText("（3 秒）");
    await expect(timer).toHaveText("（2 秒）");
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
            "dialog-timeout-result"
          ],
      )
      .toBe(JSON.stringify({ kind, value: kind === "confirm" ? false : null }));
  }
  await sdkAction(page, "prompt", {
    message: "/dialog-timeout-probe negative",
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("timer")).toHaveCount(0);
  await dialog.getByRole("textbox").fill("kept answer");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-timeout-result"
        ],
    )
    .toBe(JSON.stringify({ kind: "negative", value: "kept answer" }));
  await sdkAction(page, "prompt", {
    message: "/dialog-timeout-probe reconnect",
  });
  await expect(dialog.getByRole("timer")).toHaveText("（6 秒）");
  await page.reload();
  await expect(dialog.getByRole("timer")).toHaveText(/（[1-6] 秒）/);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "dialog-timeout-result"
        ],
    )
    .toBe(JSON.stringify({ kind: "reconnect", value: null }));
}
