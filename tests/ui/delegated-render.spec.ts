import { test } from "@playwright/test";
import { verifyDelegatedRender } from "../delegated-render-workflows.ts";

for (const width of [1440, 390])
  for (const shape of ["decorated", "transparent", "nested"])
    for (const kind of [
      "Input",
      "Editor",
      "CustomEditor",
      "SelectList",
      "SettingsList",
    ])
      test(`delegated ${shape} frames retain ${kind} at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 940 });
        await page.goto("/");
        await verifyDelegatedRender(
          page,
          kind,
          shape,
          `.local/screenshots/delegated-render-${width}-${shape}-${kind}.png`,
        );
      });

for (const width of [1440, 390])
  for (const storage of [
    "symbol",
    "array",
    "map-value",
    "map-key",
    "set",
    "record",
  ])
    test(`delegated ${storage} references retain nested desktop input at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyDelegatedRender(
        page,
        "Input",
        "nested",
        `.local/screenshots/delegated-collections-${width}-${storage}.png`,
        storage,
      );
    });
