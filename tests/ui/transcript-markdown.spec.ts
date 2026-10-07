import { test } from "@playwright/test";
import { verifyTranscriptMarkdown } from "../transcript-markdown-workflows.ts";

for (const width of [1440, 390])
  test(`transcript transformers and built-in Mermaid retain streaming, styling and lifecycle at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyTranscriptMarkdown(
      page,
      `.local/screenshots/transcript-markdown-${width}.png`,
    );
  });
