import { test } from "@playwright/test";
import { verifySdkDrain } from "../sdk-drain-workflows.ts";

for (const reject of [false, true])
  test(`running SDK callback cancellation preserves ${reject ? "rejections" : "results"} and desktop recovery`, async ({
    page,
  }) => {
    await page.goto("/");
    await verifySdkDrain(page, reject);
  });
