import { test } from "@playwright/test";
import { verifyPointerReplacement } from "../pointer-replacement-workflows.ts";

test("input replacement followed immediately by drag retains the browser range", async ({
  page,
}) => {
  await page.goto("/");
  await page.route("**/api/action", async (route) => {
    if (route.request().postDataJSON().action !== "desktop.mouse")
      return route.continue();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ response });
  });
  await verifyPointerReplacement(page);
});
