import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyComponentListeners(page: Page) {
  await sdkAction(page, "prompt", { message: "/component-listener-probe" });
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Listener ready", { exact: true }),
  ).toBeVisible();
  await dialog.click();
  await page.keyboard.press("x");
  await expect(
    dialog.getByText("Listener received: x", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("d");
  await expect(
    dialog.getByText("Debug callback: 1", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("q");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "component-listener"
        ],
    )
    .toBe("Original listener result: 1");

  await sdkAction(page, "prompt", {
    message: "/component-listener-focus-probe",
  });
  const first = dialog.getByRole("textbox", {
    name: "Listener source",
    exact: true,
  });
  const second = dialog.getByRole("textbox", {
    name: "Listener destination",
    exact: true,
  });
  await expect(first).toBeFocused();
  await first.selectText();
  await first.press("F2");
  await expect(second).toBeFocused();
  await expect(first).toHaveValue("source");
  await expect(second).toHaveValue("Xdestination");
  await second.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "component-listener-focus"
        ],
    )
    .toBe("source|Xdestination");

  await sdkAction(page, "prompt", {
    message: "/component-listener-mutation-probe",
  });
  const mutation = dialog.getByRole("textbox", {
    name: "Listener mutation",
    exact: true,
  });
  await expect(mutation).toHaveValue("before");
  for (const [key, value] of [
    ["F2", "continue!"],
    ["F3", "consume"],
    ["F4", "empty"],
  ]) {
    await mutation.selectText();
    await mutation.press(key);
    await expect(mutation).toHaveValue(value);
    await expect
      .poll(() =>
        mutation.evaluate((element: HTMLInputElement) => ({
          start: element.selectionStart,
          end: element.selectionEnd,
        })),
      )
      .toEqual({ start: value.length, end: value.length });
  }
  await mutation.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "component-listener-mutation"
        ],
    )
    .toBe("empty");
}
