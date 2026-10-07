import { test } from "@playwright/test";
import { verifyLayoutOrder } from "../layout-order-workflows.ts";

test("original keyboard input joins an in-flight layout reply before its callback", async ({
  page,
}) => {
  await page.goto("/");
  await verifyLayoutOrder(page, "keyboard", undefined, true);
});

for (const width of [1440, 390])
  for (const mode of ["action", "keyboard", "mouse"] as const)
    test(`original ${mode} callbacks receive current DOM layout at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyLayoutOrder(
        page,
        mode,
        `.local/screenshots/layout-order-${mode}-${width}.png`,
      );
    });
