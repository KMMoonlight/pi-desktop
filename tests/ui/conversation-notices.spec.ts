import { test } from "@playwright/test";
import {
  conversationNoticeModes,
  verifyConversationNotices,
} from "../conversation-notices-workflows.ts";
for (const width of [1440, 390])
  for (const mode of conversationNoticeModes)
    test(`original conversation notices ${mode} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyConversationNotices(
        page,
        mode,
        `.local/screenshots/conversation-notices-${mode}-${width}.png`,
      );
    });
