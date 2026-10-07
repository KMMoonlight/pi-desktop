import { test } from "@playwright/test";
import { verifyTerminalEffects } from "../terminal-effects-workflows.ts";

for (const width of [1440, 760])
  test(`original terminal effects, SDK clipboard fallback and replay at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyTerminalEffects(
      page,
      `.local/screenshots/terminal-effects-${width}.png`,
    );
  });
