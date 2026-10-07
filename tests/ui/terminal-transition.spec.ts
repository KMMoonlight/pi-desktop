import { test } from "@playwright/test";
import {
  verifyCompositeFocus,
  verifyTerminalTransition,
} from "../terminal-transition-workflows.ts";

for (const width of [1440, 390])
  for (const kind of ["readonly", "container"])
    test(`composite ${kind} focus retains original SDK keyboard ownership at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyCompositeFocus(
        page,
        kind,
        `.local/screenshots/composite-focus-${kind}-${width}.png`,
      );
    });

for (const width of [1440, 390])
  for (const holder of ["closure", "weakmap", "private"])
    for (const kind of [
      "Input",
      "Editor",
      "CustomEditor",
      "SelectList",
      "SettingsList",
    ])
      test(`${holder} ${kind} retains its Pi instance across desktop/xterm transitions at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 940 });
        await page.goto("/");
        await verifyTerminalTransition(
          page,
          kind,
          holder,
          `.local/screenshots/terminal-transition-${holder}-${kind}-${width}.png`,
        );
      });
