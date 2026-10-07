import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

interface State {
  mode: string;
  value?: string;
  submitted: string[];
  changes: string[];
  clicks: number;
  filter?: string;
  selected?: string;
}

export async function verifyNestedFrame(
  page: Page,
  parentKind: string,
  kind: string,
  screenshot: string,
  innerKinds: string[] = [],
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/nested-frame-probe ${parentKind} ${kind} ${innerKinds.join(",")}`,
  });
  const dialog = page.getByRole("dialog");
  const field = dialog.locator('[data-desktop-raw-input="true"]');
  const frame = dialog.locator(".desktop-render-control");
  const sibling = dialog.getByRole("textbox", {
    name: "Other field",
    exact: true,
  });
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async (): Promise<State> =>
    JSON.parse((await snapshot()).statuses["nested-frame-state"]);
  const native = (
    kind === "SelectList"
      ? dialog
          .getByRole("combobox", { name: "选择", exact: true })
          .or(dialog.getByRole("listbox", { name: "选择", exact: true }))
      : dialog.getByRole("textbox", {
          name:
            kind === "SettingsList"
              ? "搜索"
              : kind === "Input"
                ? "Nested field"
                : "编辑内容",
          exact: true,
        })
  ).and(dialog.locator(':not([data-desktop-raw-input="true"])'));
  const editing = ["Input", "Editor", "CustomEditor"].includes(kind);
  const compose = (text: string) =>
    field.evaluate((element, value) => {
      const target = element as HTMLTextAreaElement;
      target.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      target.value = value;
      target.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: value }),
      );
      target.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertFromComposition",
          data: value,
        }),
      );
    }, text);
  try {
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
    await expect(native).toHaveCount(0);
    await expect(frame).toContainText("hidden");
    await expect(frame).not.toContainText("secret");
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    await sibling.evaluate((element) =>
      Reflect.set(window, "nestedFrameSibling", element),
    );
    for (const name of innerKinds) {
      const innerKind = name.replace(/^plain:/, "");
      const innerSibling = dialog.getByRole("textbox", {
        name: `Nested ${innerKind} sibling`,
        exact: true,
      });
      await expect(innerSibling).toHaveValue("Nested sibling value");
      await innerSibling.evaluate(
        (element, key) =>
          Reflect.set(window, `nestedFrameSibling${key}`, element),
        innerKind,
      );
    }
    await sibling.fill("Retained sibling");
    if (parentKind === "ScrollView" && innerKinds.length > 1) {
      const scroll = dialog.locator(".desktop-scroll");
      await expect
        .poll(() =>
          scroll.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        )
        .toBe(true);
      await field.press("F5");
      await expect
        .poll(() => scroll.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await field.press("F6");
      await expect
        .poll(() => scroll.evaluate((element) => element.scrollTop))
        .toBe(0);
    }
    await frame
      .locator('[data-render-additions="replacement"] > div')
      .first()
      .click();
    await expect.poll(async () => (await state()).clicks).toBeGreaterThan(0);
    await expect(field).toBeFocused();
    if (kind === "SelectList")
      await expect
        .poll(async () => (await state()).submitted)
        .toEqual(["alpha"]);
    if (editing) {
      await field.press("Control+a");
      await page.keyboard.type("Z");
      await expect.poll(async () => (await state()).value).toContain("Z");
      await field.evaluate((element) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", "-paste");
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData,
          }),
        );
      });
      await compose("中文");
      await compose("连续");
      await expect
        .poll(async () => (await state()).value)
        .toContain("-paste中文连续");
      await expect(field).toHaveValue("");
    } else {
      await field.press("ArrowDown");
      await field.press("Enter");
      await expect
        .poll(async () =>
          kind === "SelectList"
            ? (await state()).submitted
            : (await state()).changes,
        )
        .toEqual(kind === "SelectList" ? ["alpha", "beta"] : ["beta:on"]);
      if (kind === "SettingsList") {
        await page.keyboard.type("alpha");
        await expect.poll(async () => (await state()).filter).toBe("alpha");
      }
    }
    const retainedText = (await state()).value;
    for (const mode of ["cut", "insert", "normal"]) {
      await field.press("F2");
      await expect.poll(async () => (await state()).mode).toBe(mode);
      await expect(sibling).toHaveValue("Retained sibling");
      expect(
        await sibling.evaluate(
          (element) => Reflect.get(window, "nestedFrameSibling") === element,
        ),
      ).toBe(true);
      for (const name of innerKinds) {
        const innerKind = name.replace(/^plain:/, "");
        const innerSibling = dialog.getByRole("textbox", {
          name: `Nested ${innerKind} sibling`,
          exact: true,
        });
        await expect(innerSibling).toHaveValue("Nested sibling value");
        expect(
          await innerSibling.evaluate(
            (element, key) =>
              Reflect.get(window, `nestedFrameSibling${key}`) === element,
            innerKind,
          ),
        ).toBe(true);
        if (!name.startsWith("plain:")) {
          await expect(
            dialog.getByText(`Nested ${innerKind} heading`, { exact: true }),
          ).toHaveCount(1);
          await expect(
            dialog.getByText(`Nested ${innerKind} ending`, { exact: true }),
          ).toHaveCount(1);
        }
      }
      if (mode === "normal") {
        await expect(field).toHaveCount(0);
        await expect(native).toBeFocused();
        await expect(native).toHaveValue(
          editing ? retainedText! : kind === "SettingsList" ? "alpha" : "beta",
        );
      } else {
        await expect(field).toBeFocused();
        await expect(frame).not.toContainText("secret");
        if (mode === "cut")
          await expect(frame).not.toContainText("tail suffix");
        if (mode === "insert" && kind !== "Input") {
          await expect(
            frame.getByText("Inserted child line", { exact: true }),
          ).toHaveCSS("color", "rgb(11, 122, 99)");
          await page.screenshot({ path: screenshot, fullPage: true });
        }
      }
    }
    await native.press("F2");
    await expect(field).toBeFocused();
    await field.press("F3");
    if (editing) {
      await expect.poll(async () => (await state()).value).toBe("SDK secret");
      await expect(frame).toContainText("SDK hidden");
    }
    await field.press("Enter");
    await expect
      .poll(async () =>
        editing
          ? (await state()).submitted
          : kind === "SelectList"
            ? (await state()).submitted
            : (await state()).changes,
      )
      .toEqual(
        editing
          ? ["SDK secret"]
          : kind === "SelectList"
            ? ["alpha", "beta", "beta"]
            : ["beta:on", "beta:on"],
      );
    if (kind === "Editor" || kind === "CustomEditor") {
      await expect(native).toHaveValue("");
      await expect(native).toBeFocused();
    }
    await ((await field.count()) ? field : native).press("F4");
    await pending;
    await expect(dialog).toHaveCount(0);
    const result = JSON.parse(
      (await snapshot()).statuses["nested-frame-result"],
    );
    expect(result.disposed).toEqual({
      parent: 1,
      field: 1,
      sibling: 1,
      ...(parentKind === "ScrollView" ? { content: 1 } : {}),
      ...(kind === "SettingsList" ? { search: 1 } : {}),
      ...Object.fromEntries(
        innerKinds.flatMap((_kind, index) => [
          [`inner${index}`, 1],
          [`innerSibling${index}`, 1],
        ]),
      ),
    });
    expect(result.clicks).toBeGreaterThan(0);
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
