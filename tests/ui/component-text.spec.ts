import { test } from "@playwright/test";
import {
  verifyComponentText,
  verifyComponentMarkdown,
  verifyTextSurfaces,
} from "../component-text-workflows.ts";

for (const width of [1440, 390]) {
  test(`status and string widgets retain structured styles, links and lifecycle at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyTextSurfaces(
      page,
      `.local/screenshots/text-surfaces-${width}.png`,
    );
  });
  test(`Pi Markdown semantic blocks retain theme callbacks, highlighting and inline resets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyComponentMarkdown(
      page,
      `.local/screenshots/component-markdown-${width}.png`,
    );
  });
  test(`standard text styling, links and background callbacks retain native desktop behavior at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyComponentText(
      page,
      `.local/screenshots/component-text-${width}.png`,
    );
  });
}
