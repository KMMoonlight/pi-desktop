import { test } from "@playwright/test";
import { verifyToolContext } from "../tool-context-workflows.ts";

for (const width of [1440, 390])
  test(`original tool renderer lifecycle and real provider events at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyToolContext(
      page,
      `.local/screenshots/tool-context-${width}.png`,
    );
  });
