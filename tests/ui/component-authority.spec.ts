import { test } from "@playwright/test";
import { verifyComponentAuthority } from "../component-authority-workflows.ts";

for (const width of [1440, 390])
  for (const kind of ["input", "editor", "custom-editor"] as const)
    test(`original ${kind} SDK changes survive stale browser input at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyComponentAuthority(
        page,
        kind,
        `.local/screenshots/component-authority-${kind}-${width}.png`,
      );
    });
