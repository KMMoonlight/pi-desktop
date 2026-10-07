import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyInteractiveRender(
  page: Page,
  kind: string,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/interactive-render-probe ${kind}`,
  });
  const dialog = page.getByRole("dialog");
  const frame = dialog.locator(".desktop-render-control");
  const field = dialog.locator('[data-desktop-raw-input="true"]');
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const originalText = async () => {
    const state = await snapshot();
    const visit = (node: DesktopNode): string | undefined => {
      if (node.kind === "input" || node.kind === "textarea") return node.value;
      return (
        node.kind === "region"
          ? [node.child]
          : "children" in node
            ? node.children
            : []
      )
        .map(visit)
        .find((value) => value !== undefined);
    };
    return visit(
      state.desktopSurfaces.find((surface) => surface.slot === "dialog")!.view,
    );
  };
  const compose = async (text: string) =>
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
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertFromComposition",
          data: value,
        }),
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
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    await expect(dialog.getByText("Masked field", { exact: true })).toHaveCSS(
      "color",
      "rgb(11, 122, 99)",
    );
    expect(await dialog.textContent()).not.toContain("original-secret");
    await field.press("Control+a");
    await page.keyboard.type("Z");
    await expect.poll(originalText).toBe("Zoriginal-secret");
    await field.press("End");
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
    await expect.poll(originalText).toBe("Zoriginal-secret-paste");
    await compose("中文");
    await compose("连续");
    await expect.poll(originalText).toBe("Zoriginal-secret-paste中文连续");
    await expect(field).toHaveValue("");
    await expect(frame).not.toContainText("original-secret");
    await frame.click({ position: { x: 5, y: 5 } });
    await expect
      .poll(
        async () => (await snapshot()).statuses["interactive-render-clicks"],
      )
      .toBe("1");
    await expect(field).toBeFocused();
    await page.keyboard.type("!");
    await expect.poll(originalText).toBe("Zoriginal-secret-paste中文连续!");
    await field.press("F2");
    await expect
      .poll(async () => (await snapshot()).statuses["interactive-render-mode"])
      .toBe("partial");
    await expect(field).toBeFocused();
    await expect(frame).toContainText("hidden");
    await expect(frame).not.toContainText("original-secret");
    await page.screenshot({ path: screenshot, fullPage: true });
    await field.press("F2");
    const native = dialog.getByRole("textbox");
    await expect(frame).toHaveCount(0);
    await expect(native).toHaveValue("Zoriginal-secret-paste中文连续!");
    await expect(native).toBeFocused();
    await native.press("F2");
    await expect(field).toBeFocused();
    await field.press("F3");
    await expect.poll(originalText).toBe("SDK secret");
    await expect(field).toHaveValue("");
    await field.press("Enter");
    await expect
      .poll(
        async () => (await snapshot()).statuses["interactive-render-submit"],
      )
      .toBe("SDK secret");
    await expect.poll(originalText).toBe(kind === "Input" ? "SDK secret" : "");
    await field.press("F4");
    await pending;
    const result = JSON.parse(
      (await snapshot()).statuses["interactive-render-result"],
    );
    expect(result).toMatchObject({
      submitted: 1,
      edited: "SDK secret",
      clicks: 1,
      disposed: 1,
    });
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
