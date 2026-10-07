import { test } from "@playwright/test";
import { verifySdkTransport } from "../sdk-transport-workflows.ts";

test("SDK errors, invalid results and recovery through desktop client", async ({
  page,
}) => {
  await page.goto("/");
  await verifySdkTransport(page);
});
