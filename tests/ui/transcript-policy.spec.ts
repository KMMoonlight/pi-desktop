import { test } from "@playwright/test";
import { verifyTranscriptPolicy } from "../transcript-policy-workflows.ts";

for (const width of [1440, 390])
  test(`transcript completion/image policy and original renderer contexts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyTranscriptPolicy(
      page,
      `.local/screenshots/transcript-policy-${width}.png`,
    );
  });
