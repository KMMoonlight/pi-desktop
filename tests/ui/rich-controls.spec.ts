import { test } from "@playwright/test";
import { verifyRichControls } from "../rich-control-workflows.ts";
import { sdkAction } from "../editor-workflows.ts";

for (const width of [1440, 390]) {
  test(`mixed control text preserves original values, callbacks, keys and pointer behavior at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    try {
      await verifyRichControls(
        page,
        `.local/screenshots/rich-controls-${width}.png`,
      );
    } finally {
      await sdkAction(page, "abort");
    }
  });
}
