import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";

export async function verifyComponentLifecycle(page: Page) {
  await sdkAction(page, "prompt", { message: "/component-lifecycle-probe" });
  const input = page.getByPlaceholder("Lifecycle input");
  await expect(input).toHaveValue("Before pause");
  const original = await input.elementHandle();
  await input.press("Enter");
  await expect
    .poll(() => input.evaluate((element) => !!element.closest("[inert]")))
    .toBe(true);
  await expect(input).toHaveValue("Before pause");
  await input.evaluate((element) => (element as HTMLElement).focus());
  expect(
    await input.evaluate((element) => document.activeElement === element),
  ).toBe(false);
  await sdkAction(page, "prompt", {
    message: "/component-lifecycle-probe resume",
  });
  await expect(input).toHaveValue("After resume");
  expect(
    await input.evaluate((element, previous) => element === previous, original),
  ).toBe(true);
  await input.fill("Working after resume");
  await expect(input).toHaveValue("Working after resume");
  await sdkAction(page, "prompt", {
    message: "/component-lifecycle-probe close",
  });
  await expect(input).toHaveCount(0);
}
