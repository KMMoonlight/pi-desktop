import { test } from "@playwright/test";
import { verifyTranscriptRenderers } from "../transcript-renderer-workflows.ts";
for (const width of [1440, 390])
  test(`native custom message and entry renderer policy at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyTranscriptRenderers(
      page,
      `.local/screenshots/transcript-renderer-${width}.png`,
    );
  });
