import { test } from "@playwright/test";
import {
  sdkLifecycleModes,
  verifySdkLifecycle,
} from "../sdk-lifecycle-workflows.ts";

for (const mode of sdkLifecycleModes)
  test(`SDK operation lifecycle through desktop transport: ${mode}`, async ({
    page,
  }) => {
    await page.goto("/");
    await verifySdkLifecycle(page, mode);
  });
