import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

async function status(page: Page, key: string) {
  return (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[key];
}

export async function verifyRichControls(
  page: Page,
  screenshot: string,
  native = false,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/rich-control-probe" });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", {
    name: "Rich input",
    exact: true,
  });
  const placeholder = dialog.locator(".desktop-rich-placeholder");
  await expect(input).toHaveAttribute("aria-placeholder", "First Second Help");
  await expect(placeholder.getByText("First", { exact: true })).toHaveCSS(
    "color",
    "rgb(18, 130, 90)",
  );
  await expect(placeholder.getByText("Second", { exact: true })).toHaveCSS(
    "color",
    "rgb(113, 54, 95)",
  );
  await expect(placeholder.getByText("Second", { exact: true })).toHaveCSS(
    "font-style",
    "italic",
  );
  await expect(placeholder.getByText("Second", { exact: true })).toHaveClass(
    "desktop-text-blink",
  );
  const help = placeholder.getByRole("link", { name: "Help", exact: true });
  await expect(help).toHaveAttribute("href", "https://example.com/placeholder");
  if (!native) {
    await page.context().route("https://example.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<p>Local placeholder link</p>",
      }),
    );
    try {
      const opened = page.waitForEvent("popup");
      await help.click();
      const popup = await opened;
      await expect
        .poll(() => popup.url())
        .toBe("https://example.com/placeholder");
      await popup.close();
    } finally {
      await page.context().unroute("https://example.com/**");
    }
  }
  const choice = dialog.getByRole("combobox", { name: "选择", exact: true });
  await expect(choice.getByText("Alpha", { exact: true })).toHaveCSS(
    "color",
    "rgb(18, 130, 90)",
  );
  await expect(choice.getByText("Alpha", { exact: true })).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(choice.getByText("Alpha", { exact: true })).toHaveCSS(
    "text-decoration-style",
    "double",
  );
  await expect(choice.getByText("Alpha", { exact: true })).toHaveCSS(
    "text-decoration-color",
    "rgb(255, 0, 0)",
  );
  await expect(choice.getByText("plain", { exact: true })).toHaveCSS(
    "color",
    await choice.evaluate((element) => getComputedStyle(element).color),
  );
  await choice.click();
  const list = page.getByRole("listbox", { name: "选择", exact: true });
  await expect(list).toBeVisible();
  await expect(list.getByText("plain", { exact: true })).toHaveCSS(
    "color",
    await choice.evaluate((element) => getComputedStyle(element).color),
  );
  await expect(
    list.getByRole("link", { name: "Item link", exact: true }),
  ).toHaveAttribute("href", "https://example.com/option");
  if (!native) {
    await page.context().route("https://example.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<p>Local option link</p>",
      }),
    );
    try {
      const opened = page.waitForEvent("popup");
      await list.getByRole("link", { name: "Item link", exact: true }).click();
      const popup = await opened;
      await expect.poll(() => popup.url()).toBe("https://example.com/option");
      await popup.close();
      await expect(list).toBeVisible();
      expect(await status(page, "rich-change")).toBeUndefined();
    } finally {
      await page.context().unroute("https://example.com/**");
    }
  }
  const beta = list.getByRole("option", {
    name: "Beta alternate",
    exact: true,
  });
  await expect(beta).toHaveAttribute("value", "beta:original");
  await expect(beta.getByText("Beta", { exact: true })).toHaveCSS(
    "color",
    "rgb(113, 54, 95)",
  );
  await expect(beta.getByText("alternate", { exact: true })).toHaveCSS(
    "font-style",
    "italic",
  );
  await page.screenshot({
    path: screenshot.replace(/\.png$/, "-menu.png"),
    animations: "disabled",
  });
  await beta.click();
  await expect(list).toBeHidden();
  await expect
    .poll(() => status(page, "rich-change"))
    .toBe(JSON.stringify({ value: "beta:original", changes: 1 }));
  await expect(choice.getByText("Beta", { exact: true })).toHaveCSS(
    "font-weight",
    "700",
  );
  const preference = dialog.getByRole("combobox", {
    name: "Rich preference",
    exact: true,
  });
  await preference.click();
  await page.getByRole("option", { name: "Loud mode", exact: true }).click();
  await expect
    .poll(() => status(page, "rich-setting"))
    .toBe(JSON.stringify({ id: "rich:mode", value: "loud:original" }));
  await expect(preference.getByText("mode", { exact: true })).toHaveCSS(
    "font-style",
    "italic",
  );
  await page.screenshot({ path: screenshot, animations: "disabled" });
  const before = await input.boundingBox();
  await input.fill("Original rich input");
  await expect(placeholder).toHaveCount(0);
  expect(await input.boundingBox()).toEqual(before);
  await input.press("Enter");
  await expect
    .poll(() => status(page, "rich-input"))
    .toBe("Original rich input");
  await choice.press("ArrowUp");
  await expect
    .poll(() => status(page, "rich-change"))
    .toBe(JSON.stringify({ value: "alpha:original", changes: 2 }));
  await choice.locator("svg").click();
  await expect(list).toBeVisible();
  const alpha = list.getByRole("option", {
    name: "Alpha plain Item link",
    exact: true,
  });
  await alpha.press("ArrowDown");
  await expect
    .poll(() => status(page, "rich-change"))
    .toBe(JSON.stringify({ value: "beta:original", changes: 3 }));
  await beta.press("ArrowUp");
  await expect
    .poll(() => status(page, "rich-change"))
    .toBe(JSON.stringify({ value: "alpha:original", changes: 4 }));
  await expect(alpha).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => status(page, "rich-result"))
    .toBe(
      JSON.stringify({
        value: "alpha:original",
        text: "Original rich input",
        changes: 4,
      }),
    );

  await sdkAction(page, "prompt", { message: "/rich-control-probe listbox" });
  await expect(list).toBeVisible();
  await beta.click();
  await expect
    .poll(() => status(page, "rich-change"))
    .toBe(JSON.stringify({ value: "beta:original", changes: 1 }));
  await expect
    .poll(async () =>
      JSON.parse((await status(page, "rich-mouse")) ?? "[]").some(
        (event: { type: string }) => event.type === "press",
      ),
    )
    .toBe(true);
  await beta.press("ArrowUp");
  await expect
    .poll(() => status(page, "rich-change"))
    .toBe(JSON.stringify({ value: "alpha:original", changes: 2 }));
  await expect(
    list.getByRole("option", { name: "Alpha plain Item link", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();

  await sdkAction(page, "prompt", { message: "/rich-control-probe listener" });
  await choice.click();
  await expect(list).toBeVisible();
  await alpha.press("ArrowDown");
  await expect(choice.getByText("Alpha", { exact: true })).toBeVisible();
  await expect(alpha).toBeFocused();
  await alpha.press("ArrowUp");
  await expect
    .poll(() => status(page, "rich-change"))
    .toBe(JSON.stringify({ value: "beta:original", changes: 1 }));
  await expect(beta).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).extensionUI
          .inputListeners,
    )
    .toBe(0);

  for (const mode of ["scroll", "scroll-listbox"]) {
    await sdkAction(page, "prompt", { message: `/rich-control-probe ${mode}` });
    if (mode === "scroll") await choice.click();
    await expect(list).toBeVisible();
    const selected = list.locator('[role="option"][aria-selected="true"]');
    await expect(selected).toHaveAttribute("value", "row:20:original");
    await expect(selected).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: screenshot.replace(/\.png$/, `-${mode}.png`),
      animations: "disabled",
    });
    await list.focus();
    for (const number of [21, 22, 23, 24]) {
      await page.keyboard.press("ArrowDown");
      await expect(selected).toHaveAttribute("value", `row:${number}:original`);
      await expect(selected).toBeFocused();
      await expect(selected).toBeInViewport({ ratio: 1 });
    }
    for (let index = 0; index < 23; index++)
      await page.keyboard.press("ArrowUp");
    await expect(selected).toHaveAttribute("value", "row:1:original");
    await expect(selected).toBeInViewport({ ratio: 1 });
    await expect(selected).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => status(page, "rich-result"))
      .toBe(JSON.stringify({ value: "row:1:original", text: "", changes: 27 }));
  }
}
