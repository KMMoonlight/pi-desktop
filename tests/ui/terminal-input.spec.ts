import { test } from "@playwright/test";
import {
  terminalInputModes,
  verifyTerminalInput,
} from "../terminal-input-workflows.ts";

for (const width of [1440, 390]) {
  for (const mode of terminalInputModes) {
    test(`global terminal input ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
      await verifyTerminalInput(
        page,
        mode,
        `.local/screenshots/global-input-${mode}-${width}.png`,
      );
    });
  }
}
