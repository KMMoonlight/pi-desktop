import { test } from "@playwright/test";
import {
  runtimeCallbackModes,
  verifyRuntimeCallbacks,
} from "../runtime-callbacks-workflows.ts";

for (const mode of runtimeCallbackModes)
  test(`runtime caller callbacks preserve desktop workflows: ${mode}`, async ({
    page,
  }) => {
    await page.goto("/");
    await verifyRuntimeCallbacks(page, mode);
  });
