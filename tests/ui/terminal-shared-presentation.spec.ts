import { test } from "@playwright/test";
import {
  terminalStateModes,
  verifySharedTerminalPresentation,
} from "../terminal-shared-presentation-workflows.ts";

for (const width of [1440, 390]) {
  for (const mode of terminalStateModes) {
    test(`shared terminal presentation ${mode} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifySharedTerminalPresentation(
        page,
        mode,
        `.local/screenshots/shared-terminal-${mode}-${width}.png`,
      );
    });
  }
}
