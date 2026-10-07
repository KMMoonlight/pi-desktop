import { test } from "@playwright/test";
import {
  verifyEditorNavigation,
  verifyEditorResize,
  verifyEditorBidi,
} from "../editor-navigation-workflows.ts";

for (const width of [1440, 390]) {
  test(`single-line Input native navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyEditorBidi(page, ["input"]);
  });
  test(`mixed-direction editor horizontal navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyEditorBidi(page);
  });
  test(`editor selection reads resized geometry after a pending input confirmation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyEditorResize(
      page,
      `.local/screenshots/editor-resize-${width}.png`,
    );
  });

  test(`standard editor mapping uses browser visual rows at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyEditorNavigation(
      page,
      `.local/screenshots/editor-navigation-${width}.png`,
    );
  });
}
