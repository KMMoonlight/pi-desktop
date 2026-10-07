import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyControlText(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/control-style-probe" });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", {
    name: "Control update",
    exact: true,
  });
  await expect(dialog.getByText("Control update", { exact: true })).toHaveCSS(
    "color",
    "rgb(18, 130, 90)",
  );
  await expect(input).toHaveAttribute("placeholder", "ORIGINAL placeholder");
  await expect
    .poll(() =>
      input.evaluate(
        (element) => getComputedStyle(element, "::placeholder").color,
      ),
    )
    .toBe("rgb(91, 101, 111)");
  await expect
    .poll(() =>
      input.evaluate(
        (element) => getComputedStyle(element, "::placeholder").fontStyle,
      ),
    )
    .toBe("italic");
  await expect(
    dialog.getByRole("textbox", { name: "编辑内容", exact: true }),
  ).toHaveCSS("border-top-color", "rgb(123, 84, 45)");
  await expect(dialog.locator(".desktop-divider")).toHaveCSS(
    "border-top-color",
    "rgb(100, 111, 122)",
  );
  const choice = dialog.getByRole("combobox", { name: "选择", exact: true });
  const defaultControlColor = await choice.evaluate((element) => {
    const baseline = element.cloneNode(false) as HTMLElement;
    baseline.removeAttribute("style");
    element.parentElement!.append(baseline);
    try {
      return getComputedStyle(baseline).color;
    } finally {
      baseline.remove();
    }
  });
  await expect(choice).toHaveCSS("color", "rgb(44, 95, 146)");
  await expect(choice).toHaveCSS("font-weight", "700");
  await expect(
    choice.getByRole("option", { name: "ALPHA", exact: true }),
  ).toHaveAttribute("value", "alpha");
  await expect(
    choice.getByRole("option", { name: "Beta", exact: true }),
  ).toHaveCSS("color", "rgb(113, 54, 95)");
  const preference = dialog.getByRole("combobox", {
    name: "Preference",
    exact: true,
  });
  await expect(dialog.getByText("Preference", { exact: true })).toHaveCSS(
    "color",
    "rgb(72, 83, 94)",
  );
  await expect(
    preference.getByRole("option", { name: "QUIET", exact: true }),
  ).toHaveAttribute("value", "quiet");
  await expect(preference).toHaveCSS("font-weight", "700");
  await expect(
    dialog.getByText("Preference description", { exact: true }),
  ).toHaveCSS("color", "rgb(128, 99, 70)");
  await expect(dialog.getByText("Read only", { exact: true })).toHaveCSS(
    "color",
    "rgb(102, 83, 94)",
  );
  await expect(dialog.getByText("fixed", { exact: true })).toHaveCSS(
    "color",
    "rgb(105, 116, 127)",
  );
  await expect(dialog.getByText("Original loading", { exact: true })).toHaveCSS(
    "color",
    "rgb(31, 82, 133)",
  );
  await expect(dialog.locator(".desktop-progress-indicator span")).toHaveCSS(
    "color",
    "rgb(41, 142, 93)",
  );
  await expect(
    dialog.getByRole("progressbar", { name: "Original loading", exact: true }),
  ).toHaveCSS("accent-color", "rgb(41, 142, 93)");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await preference.selectOption("loud");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "control-setting"
        ],
    )
    .toBe("mode:choice=loud");
  await choice.selectOption("beta");
  await expect(choice).toHaveCSS("color", "rgb(113, 54, 95)");
  await expect(choice).toHaveCSS("font-weight", "700");
  await expect(
    choice.getByRole("option", { name: "Alpha", exact: true }),
  ).toHaveCSS("color", defaultControlColor);
  await expect(dialog.getByText("Beta description", { exact: true })).toHaveCSS(
    "color",
    "rgb(44, 95, 146)",
  );
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "control-selected"
        ],
    )
    .toBe("beta");
  await dialog
    .getByRole("button", { name: "确认", exact: true })
    .nth(1)
    .click();
  await expect(
    dialog.getByText("No matching commands", { exact: true }),
  ).toHaveCSS("color", "rgb(147, 58, 69)");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "control-confirmed"
        ],
    )
    .toBe("beta");
  await input.fill("Updated by original Input");
  await input.press("Enter");
  await expect(
    dialog.getByRole("progressbar", {
      name: "Updated by original Input",
      exact: true,
    }),
  ).toBeVisible();
  const search = dialog.getByRole("textbox", { name: "搜索", exact: true });
  await search.fill("Read only");
  await expect(
    dialog.getByText("Read-only description", { exact: true }),
  ).toHaveCSS("color", "rgb(128, 99, 70)");
  await expect(dialog.getByText("Read only", { exact: true })).toHaveCSS(
    "color",
    "rgb(72, 83, 94)",
  );
  await search.fill("absent");
  await expect(
    dialog.getByText("No matching settings", { exact: true }),
  ).toHaveCSS("color", "rgb(147, 58, 69)");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "control-result"
        ],
    )
    .toBe("aborted");
  await sdkAction(page, "prompt", { message: "/control-style-probe hidden" });
  await expect(choice).toBeVisible();
  await expect(choice).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await choice.selectOption("beta");
  await expect(choice).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await sdkAction(page, "prompt", { message: "/control-style-probe listbox" });
  const listbox = dialog.getByRole("listbox", { name: "选择", exact: true });
  await expect(listbox).toHaveCSS("color", "rgb(44, 95, 146)");
  const defaultListColor = await dialog
    .getByRole("textbox", { name: "编辑内容", exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await listbox.selectOption("beta");
  await expect(listbox).toHaveCSS("color", "rgb(113, 54, 95)");
  await expect(
    listbox.getByRole("option", { name: "Alpha", exact: true }),
  ).toHaveCSS("color", defaultListColor);
  await expect(
    listbox.getByRole("option", { name: "Beta", exact: true }),
  ).toHaveCSS("color", "rgb(113, 54, 95)");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
}
