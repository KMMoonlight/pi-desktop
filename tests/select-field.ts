import type { Locator } from "@playwright/test";

/** Exercise either a mapped SDK select or the host's desktop listbox. */
export async function selectField(control: Locator, value: string) {
  if (await control.evaluate((node) => node.tagName === "SELECT")) {
    await control.selectOption(value);
    return;
  }
  await control.click();
  await control
    .page()
    .getByRole("listbox")
    .locator(`[role="option"][data-value=${JSON.stringify(value)}]`)
    .click();
}
