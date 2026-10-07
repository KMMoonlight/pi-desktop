import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

function control(
  node: DesktopNode,
  label: string,
): Extract<DesktopNode, { kind: "input" | "textarea" }> | undefined {
  if (node.kind === "input" && node.label === label) return node;
  const children =
    "children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : [];
  return children.map((child) => control(child, label)).find(Boolean);
}

export async function verifyHorizontalTransforms(
  page: Page,
  align: string,
  nested: boolean,
  fill: boolean,
  transform: "left" | "both",
  screenshot: string,
  height: "stable" | "insert" | "cut" = "stable",
) {
  await page
    .getByRole("textbox", { name: "\u6d88\u606f", exact: true })
    .waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/gap-frame-probe ${align} ${nested ? "nested" : "plain"} ${fill ? "fill" : "fixed"} framed ${transform} ${height}`,
  });
  const dialog = page.getByRole("dialog");
  const left = dialog.getByRole("textbox", { name: "Gap left", exact: true });
  const right = dialog.getByRole("textbox", { name: "Gap right", exact: true });
  const gaps = dialog.locator(".desktop-render-gap");
  const frames = dialog.locator(".desktop-render-control");
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async () =>
    JSON.parse((await snapshot()).statuses["gap-frame-state"]);
  const frame = async (visible: boolean) => {
    const title = dialog.getByText(nested ? "Frame caption" : "Frame title", {
      exact: true,
    });
    const note = dialog.getByText("Top note", { exact: true });
    const footer = dialog.getByText(nested ? "Frame footer" : "Frame ending", {
      exact: true,
    });
    for (const item of [title, note, footer]) {
      await expect(item).toHaveCount(visible ? 1 : 0);
      if (visible)
        expect(
          await item.evaluate((element) => element.closest(".desktop-row")),
        ).toBeNull();
    }
    if (visible) await expect(title).toHaveCSS("color", "rgb(73, 85, 191)");
  };
  const presentation = async () => {
    await expect(frames).toHaveCount(transform === "both" ? 2 : 1);
    await expect(left).toHaveAttribute("data-desktop-raw-input", "true");
    await expect(left).toHaveValue("");
    await expect(frames.first()).toContainText("Hidden");
    await expect(
      frames.first().getByText("Hidden 0", { exact: false }),
    ).toHaveCSS("color", "rgb(163, 52, 93)");
    if (transform === "both") {
      await expect(right).toHaveAttribute("data-desktop-raw-input", "true");
      await expect(right).toHaveValue("");
      await expect(frames.last()).toContainText("Masked");
    }
    for (const item of [...(await frames.all()), ...(await gaps.all())]) {
      await expect(item).not.toContainText("Frame");
      await expect(item).not.toContainText("Top note");
    }
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    await frame(true);
  };
  const moveEnd = async (field: typeof left, label: string, cursor: number) => {
    await field.press("End");
    await expect
      .poll(async () =>
        (await snapshot()).desktopSurfaces
          .map((surface) => control(surface.view, label)?.selection?.start)
          .find((value) => value !== undefined),
      )
      .toBe(cursor);
  };
  const compose = (text: string) =>
    left.evaluate((element, value) => {
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
  const geometry = () =>
    dialog
      .locator(".desktop-row")
      .first()
      .evaluate((element) => {
        const origin = element.getBoundingClientRect();
        return [
          ...element.querySelectorAll<HTMLElement>(".desktop-stack-child"),
        ].map((child) => {
          const box = child.getBoundingClientRect();
          return {
            x: box.x - origin.x,
            y: box.y - origin.y,
            width: box.width,
            height: box.height,
          };
        });
      });
  const rightIdentity = async () => {
    if (transform === "left")
      expect(
        await right.evaluate(
          (element) =>
            Reflect.get(window, "horizontalTransformRight") === element,
        ),
      ).toBe(true);
  };
  try {
    await presentation();
    await expect(left).toBeFocused();
    await expect(gaps).toHaveCount(fill ? 2 : 3);
    const first = gaps.first();
    const gapLines = [`${nested ? "D" : "A"}\u754c `, "B   ", "C   "];
    if (height !== "stable") while (gapLines.length < 8) gapLines.push("    ");
    if (height === "insert") gapLines.splice(4, 0, "    ");
    else if (height === "cut") gapLines.splice(4, 1);
    await expect(first.locator(":scope > div")).toHaveText(gapLines);
    await expect(first.getByRole("link").first()).toHaveCSS(
      "color",
      "rgb(11, 122, 99)",
    );
    await right.evaluate((element) =>
      Reflect.set(window, "horizontalTransformRight", element),
    );
    const before = await geometry();
    await moveEnd(left, "Gap left", 3);
    await page.keyboard.type("!");
    await expect.poll(async () => (await state()).left).toBe("one!");
    await left.evaluate((element) => {
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
    await compose("\u4e2d\u6587");
    await compose("\u8fde\u7eed");
    const edited = "one!-paste\u4e2d\u6587\u8fde\u7eed";
    await expect.poll(async () => (await state()).left).toBe(edited);
    await expect(left).toHaveValue("");
    await left.press("Enter");
    await expect.poll(async () => (await state()).submitted).toEqual([edited]);
    if (transform === "both") {
      await moveEnd(right, "Gap right", 3);
      await page.keyboard.type("?");
      await expect.poll(async () => (await state()).right).toBe("two?");
      await expect(right).toHaveValue("");
    } else await right.fill("other");
    await right.press("F2");
    await expect.poll(async () => (await state()).mode).toBe("background");
    await presentation();
    await rightIdentity();
    const after = await geometry();
    expect(after).toHaveLength(before.length);
    for (let index = 0; index < after.length; index++)
      for (const key of ["x", "y", "width", "height"] as const)
        expect(Math.abs(after[index][key] - before[index][key])).toBeLessThan(
          1,
        );
    for (const part of await gaps.all())
      await expect(part.locator(":scope > div > span").first()).toHaveCSS(
        "background-color",
        "rgb(201, 225, 239)",
      );
    const clicks = (await state()).clicks;
    await first.locator(":scope > div > span").first().click();
    await expect
      .poll(async () => (await state()).clicks)
      .toBeGreaterThan(clicks);
    expect((await state()).lastColumn).toBeGreaterThan(0);
    await expect(left).toBeFocused();
    await page.screenshot({
      path: screenshot.replace(/\.png$/, "-background.png"),
      fullPage: true,
    });
    await left.press("F2");
    await expect.poll(async () => (await state()).mode).toBe("normal");
    await expect(frames).toHaveCount(0);
    await expect(dialog.locator("[data-desktop-raw-input]")).toHaveCount(0);
    await frame(false);
    await expect(left).toHaveValue(edited);
    await expect(right).toHaveValue(transform === "both" ? "two?" : "other");
    await expect(left).toBeFocused();
    await rightIdentity();
    await left.press("F3");
    await expect(left).toHaveValue("SDK");
    await expect(right).toHaveValue("Peer");
    await left.press("F2");
    await expect.poll(async () => (await state()).mode).toBe("text");
    await presentation();
    await rightIdentity();
    await left.press("Enter");
    await expect
      .poll(async () => (await state()).submitted)
      .toEqual([edited, "SDK"]);
    await page.screenshot({ path: screenshot, fullPage: true });
    await left.press("F4");
    await pending;
    await expect(dialog).toHaveCount(0);
    const result = JSON.parse((await snapshot()).statuses["gap-frame-result"]);
    expect(result.disposed).toEqual({
      left: 1,
      middle: 1,
      right: 1,
      stack: 1,
      ...(nested ? { outer: 1 } : {}),
    });
  } finally {
    if (await dialog.count())
      await sdkAction(page, "desktop.close", {
        id: (await snapshot()).desktopSurfaces.find(
          (surface) => surface.slot === "dialog",
        )?.id,
      });
    await pending;
  }
}
