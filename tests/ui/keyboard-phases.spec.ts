import { test } from "@playwright/test";
import {
  keyboardPhaseModes,
  verifyKeyboardPhases,
} from "../keyboard-phase-workflows.ts";

for (const width of [1440, 390]) {
  for (const mode of keyboardPhaseModes) {
    test(`keyboard phases preserve ${mode} input at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
      await verifyKeyboardPhases(
        page,
        mode,
        `.local/screenshots/keyboard-phases-${mode}-${width}.png`,
      );
    });
  }
}
