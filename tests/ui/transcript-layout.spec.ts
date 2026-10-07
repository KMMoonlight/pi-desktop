import { test } from "@playwright/test";
import { verifyTranscriptLayout } from "../transcript-layout-workflows.ts";

for (const width of [1440, 390])
  test(`transcript width contexts follow actual padding, panels, fonts, resize and session scope at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyTranscriptLayout(
      page,
      `.local/screenshots/transcript-layout-${width}.png`,
    );
  });
