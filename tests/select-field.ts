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

/** Settings retain the same categories in the desktop rail and compact picker. */
export async function selectSettingsCategory(settings: Locator, label: string) {
  const picker = settings.locator(".settings-category-picker").getByRole("combobox");
  if (await picker.isVisible()) {
    await picker.click();
    await settings.page().getByRole("listbox").getByRole("option", { name: label, exact: true }).click();
  } else {
    await settings.getByRole("navigation").getByRole("button", { name: label, exact: true }).click();
  }
}
