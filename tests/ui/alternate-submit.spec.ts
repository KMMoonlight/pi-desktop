import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";
import { selectField } from "../select-field.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const mode of ["steer", "followUp"] as const) {
  for (const modifier of ["Meta", "Control"]) {
    test(`${modifier}+Enter reverses ${mode} while running without changing the preference`, async ({ page }) => {
      await page.goto("/");
      const editor = page.getByRole("textbox", { name: "消息", exact: true });
      await expect(editor).toBeVisible();
      await sdkAction(page, "session.new");
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: "常规", exact: true }).click();
      await selectField(settings.getByRole("combobox", { name: "运行中发送消息", exact: true }), mode);
      await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
      try {
        await editor.fill("application-status-gate");
        await editor.press("Enter");
        await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).running).toBe(true);
        const alternate = mode === "steer" ? "followUp" : "steer";
        for (const [key, expected, message] of [
          [`${modifier}+Enter`, alternate, "alternate delivery"],
          ["Enter", mode, "normal delivery"],
        ]) {
          await editor.fill(message);
          const submitted = page.waitForRequest(request =>
            request.method() === "POST" && request.postDataJSON()?.action === "prompt",
          );
          await editor.press(key);
          expect((await submitted).postDataJSON().args).toMatchObject({ message, mode: expected });
          await expect(editor).toHaveValue("");
          await expect.poll(async () => {
            const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
            return snapshot.queue[expected === "steer" ? "steering" : "followUp"];
          }).toContain(message);
        }
        expect(await page.evaluate(() => localStorage.getItem("pi.messageMode"))).toBe(mode);
      } finally {
        await sdkAction(page, "abort");
      }
    });
  }
}
