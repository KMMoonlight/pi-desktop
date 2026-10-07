import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

export async function verifyListRender(
  page: Page,
  kind: string,
  helper: boolean,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/list-render-probe ${kind}${helper ? " helper" : ""}`,
  });
  const dialog = page.getByRole("dialog");
  const field = dialog.locator('[data-desktop-raw-input="true"]');
  const frame = dialog.locator(".desktop-render-control");
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async () => {
    const current = await snapshot();
    const hasMenu = (node: DesktopNode): boolean =>
      (node.kind === "select" &&
        node.options.some((option) => option.value === "two")) ||
      (node.kind === "region"
        ? [node.child]
        : "children" in node
          ? node.children
          : []
      ).some(hasMenu);
    return {
      ...JSON.parse(current.statuses["list-render-state"]),
      activeMenu: current.desktopSurfaces.some(
        (surface) => surface.slot === "dialog" && hasMenu(surface.view),
      ),
    } as {
      mode: string;
      confirmed: string[];
      changes: string[];
      filter?: string;
      selected?: string;
      activeMenu: boolean;
      values?: Record<string, string>;
    };
  };
  try {
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    await expect(dialog).not.toContainText("Original");
    await expect(
      dialog.getByText("List frame", { exact: true }).first(),
    ).toHaveCSS("color", "rgb(11, 122, 99)");
    await field.press("ArrowDown");
    await field.press("Enter");
    await expect
      .poll(async () =>
        kind === "SelectList"
          ? (await state()).confirmed
          : (await state()).changes,
      )
      .toEqual(kind === "SelectList" ? ["beta"] : ["beta:on"]);
    await field.press("F2");
    await expect.poll(async () => (await state()).mode).toBe("partial");
    await expect(frame).toContainText("Displayed");
    await expect(frame).not.toContainText("Original");
    await expect(field).toBeFocused();
    if (kind === "SelectList") {
      await frame
        .locator('[data-render-additions="replacement"] > div')
        .first()
        .click();
      await expect
        .poll(async () => (await state()).confirmed)
        .toEqual(["beta", "alpha"]);
      await expect(field).toBeFocused();
    } else {
      await frame
        .locator('[data-render-additions="replacement"] > div')
        .filter({ hasText: "Displayed menu" })
        .click();
      await expect.poll(async () => (await state()).activeMenu).toBe(true);
      let menu = helper
        ? dialog.getByRole("combobox", { name: "选择", exact: true })
        : field;
      await expect(menu).toBeFocused();
      await menu.press("ArrowDown");
      await menu.press("Enter");
      await expect
        .poll(async () => (await state()).changes)
        .toEqual(["beta:on", "menu:two"]);
      await expect.poll(async () => (await state()).activeMenu).toBe(false);
      await expect(field).toBeFocused();
      await field.press("F3");
      await field.press("Enter");
      await expect.poll(async () => (await state()).values?.beta).toBe("on");
      await field.press("F2");
      const search = dialog.getByRole("textbox", { name: "搜索", exact: true });
      await expect(frame).toHaveCount(0);
      await expect(search).toBeFocused();
      await search.press("F2");
      await expect(field).toBeFocused();
      await page.keyboard.type("alpha");
      await expect.poll(async () => (await state()).filter).toBe("alpha");
      await expect(dialog).not.toContainText("Original alpha");
      await expect(field).toHaveValue("");
      await field.press("F2");
      await field.press("F2");
      await expect(search).toHaveValue("alpha");
      await search.press("F2");
      await expect(field).toBeFocused();
      await field.press("F3");
      await expect.poll(async () => (await state()).filter).toBe("");
      await expect.poll(async () => (await state()).values?.beta).toBe("off");
      await field.press("F2");
    }
    await page.screenshot({ path: screenshot, fullPage: true });
    if (kind === "SelectList") {
      await field.press("F2");
      const select = dialog.getByRole("combobox", {
        name: "选择",
        exact: true,
      });
      await expect(frame).toHaveCount(0);
      await expect(select).toBeFocused();
      await expect(select).toHaveValue("alpha");
      await select.press("F2");
      await expect(field).toBeFocused();
      await field.press("F3");
      await field.press("Enter");
      await expect
        .poll(async () => (await state()).confirmed)
        .toEqual(["beta", "alpha", "beta"]);
    }
    await field.press("Escape");
    await pending;
    const result = JSON.parse(
      (await snapshot()).statuses["list-render-result"],
    );
    expect(result.cancelled).toBe(1);
    expect(result.disposed).toEqual(
      kind === "SelectList"
        ? { root: 1, search: 0, menu: 0 }
        : { root: 1, search: 1, menu: 1 },
    );
    await expect(dialog).toHaveCount(0);
  } finally {
    if (await dialog.count())
      await sdkAction(page, "desktop.close", {
        id: (await snapshot()).desktopSurfaces.find(
          (surface) => surface.slot === "dialog",
        )?.id,
      });
    await pending.catch(() => {});
  }
}
