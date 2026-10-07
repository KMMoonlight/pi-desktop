import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

interface State {
  mode: string;
  value?: string;
  clicks: number;
  submitted: string[];
  changes: string[];
}

export async function verifyDelegatedRender(
  page: Page,
  kind: string,
  shape: string,
  screenshot: string,
  storage = "direct",
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/delegated-frame-probe ${kind} ${shape} 3 ${storage}`,
  });
  const dialog = page.getByRole("dialog");
  const editing = ["Input", "Editor", "CustomEditor"].includes(kind);
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
                ? "Wrapped field"
                : "编辑内容",
          exact: true,
        })
  ).and(dialog.locator(':not([data-desktop-raw-input="true"])'));
  const input = dialog.locator('[data-desktop-raw-input="true"]');
  const frame = dialog.locator(".desktop-render-control");
  const peer = dialog.getByRole("textbox", {
    name: "Wrapped peer",
    exact: true,
  });
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async (): Promise<State> =>
    JSON.parse((await snapshot()).statuses["delegated-frame-state"]);
  try {
    await expect(native).toBeVisible();
    if (editing) await expect(native).toBeFocused();
    if (shape !== "decorated") {
      await expect(peer).toHaveValue("Peer value");
      await peer.evaluate((element) =>
        Reflect.set(window, "delegatedPeer", element),
      );
    }
    if (shape !== "transparent")
      for (let index = 0; index < 3; index++) {
        const label = shape === "nested" ? "Enclosing wrapper" : "Wrapper";
        await expect(
          dialog.getByText(`${label} ${index} heading`, { exact: true }),
        ).toHaveCount(1);
        await expect(
          dialog.getByText(`${label} ${index} footer`, { exact: true }),
        ).toHaveCount(1);
      }
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    await native.press("F2");
    await expect.poll(async () => (await state()).mode).toBe("mask");
    await expect(input).toBeFocused();
    await expect(native).toHaveCount(0);
    await expect(frame).toContainText("hidden");
    await expect(frame).not.toContainText("secret");
    await expect(input).toHaveValue("");
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    if (shape !== "decorated") {
      await expect(peer).toHaveValue("Peer value");
      expect(
        await peer.evaluate(
          (element) => Reflect.get(window, "delegatedPeer") === element,
        ),
      ).toBe(true);
    }
    await frame
      .locator('[data-render-additions="replacement"] > div')
      .first()
      .click();
    await expect.poll(async () => (await state()).clicks).toBeGreaterThan(0);
    await expect(input).toBeFocused();
    await page.screenshot({ path: screenshot });
    if (editing) {
      await input.press("Control+e");
      await page.keyboard.type("Z");
      await input.evaluate((element) => {
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
      await input.evaluate((element) => {
        const target = element as HTMLTextAreaElement;
        target.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        );
        target.value = "中文";
        target.dispatchEvent(
          new CompositionEvent("compositionend", {
            bubbles: true,
            data: "中文",
          }),
        );
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertFromComposition",
            data: "中文",
          }),
        );
      });
      await expect
        .poll(async () => (await state()).value)
        .toContain("Z-paste中文");
      await input.press("Enter");
      await expect
        .poll(async () => (await state()).submitted)
        .toEqual(["secret valueZ-paste中文"]);
      await input.or(native).press("F3");
      await expect.poll(async () => (await state()).value).toBe("SDK update");
      await expect(native).toHaveValue("SDK update");
    } else {
      await input.press("ArrowDown");
      await input.press("Enter");
      await expect
        .poll(async () =>
          kind === "SelectList"
            ? (await state()).submitted
            : (await state()).changes,
        )
        .toContain(kind === "SelectList" ? "beta" : "beta:on");
    }
    await (editing ? native : input).press("F2");
    await expect.poll(async () => (await state()).mode).toBe("normal");
    await expect(native).toBeVisible();
    await expect(input).toHaveCount(0);
    if (editing) await expect(native).toHaveValue("SDK update");
    if (shape !== "decorated") {
      await expect(peer).toHaveValue("Peer value");
      expect(
        await peer.evaluate(
          (element) => Reflect.get(window, "delegatedPeer") === element,
        ),
      ).toBe(true);
    }
    await native.press("F4");
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => {
        const result = (await snapshot()).statuses["delegated-frame-result"];
        return (
          result &&
          Object.values(JSON.parse(result).disposed).every(
            (count) => count === 1,
          )
        );
      })
      .toBe(true);
    await pending;
  } finally {
    if (!page.isClosed() && (await dialog.count())) {
      await sdkAction(page, "desktop.close", {
        id: (await snapshot()).desktopSurfaces.find(
          (surface) => surface.slot === "dialog",
        )?.id,
      });
      await pending.catch(() => {});
    }
  }
}
