import { test } from "@playwright/test";
import {
  registrationModes,
  verifyComponentRegistration,
} from "../component-registration-workflows.ts";

for (const width of [1440, 390]) {
  for (const mode of registrationModes) {
    test(`registered TUI ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
      await verifyComponentRegistration(
        page,
        mode,
        `.local/screenshots/registered-tui-${mode}-${width}.png`,
      );
    });
  }
}
