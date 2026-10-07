import { test } from "@playwright/test";
import {
  nativeExecutionModes,
  verifyNativeExecution,
} from "../native-execution-workflows.ts";
for (const width of [1440, 390])
  for (const mode of nativeExecutionModes)
    test(`original execution ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyNativeExecution(
        page,
        mode,
        `.local/screenshots/native-execution-${mode}-${width}.png`,
      );
    });
