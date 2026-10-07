import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

function leftCursor(node: DesktopNode): number | undefined {
  if (node.kind === "input" && node.label === "Gap left")
    return node.selection?.start;
  const children =
    "children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : [];
  return children.map(leftCursor).find((cursor) => cursor !== undefined);
}

export async function verifyHorizontalGaps(
  page: Page,
  align: string,
  nested: boolean,
  fill: boolean,
  screenshot: string,
  framed = false,
) {
  await page
    .getByRole("textbox", { name: "\u6d88\u606f", exact: true })
    .waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/gap-frame-probe ${align} ${nested ? "nested" : "plain"} ${fill ? "fill" : "fixed"} ${framed ? "framed" : "plain"}`,
  });
  const dialog = page.getByRole("dialog");
  const left = dialog.getByRole("textbox", { name: "Gap left", exact: true });
  const right = dialog.getByRole("textbox", { name: "Gap right", exact: true });
  const gaps = dialog.locator(".desktop-render-gap");
  const snapshot = () => sdkAction<DesktopSnapshot>(page, "snapshot");
  const state = async () =>
    JSON.parse((await snapshot()).statuses["gap-frame-state"]);
  const frame = async (visible: boolean) => {
    const title = dialog.getByText(nested ? "Frame caption" : "Frame title", {
      exact: true,
    });
    const footer = dialog.getByText(nested ? "Frame footer" : "Frame ending", {
      exact: true,
    });
    const note = dialog.getByText("Top note", { exact: true });
    await expect(title).toHaveCount(visible ? 1 : 0);
    await expect(footer).toHaveCount(visible ? 1 : 0);
    await expect(note).toHaveCount(visible ? 1 : 0);
    if (visible) {
      await expect(title).toHaveCSS("color", "rgb(73, 85, 191)");
      for (const item of [title, note, footer])
        expect(
          await item.evaluate(
            (element) => element.closest(".desktop-row") === null,
          ),
        ).toBe(true);
    }
  };
  const geometry = () =>
    left.evaluate((element) => {
      const row = element.closest(".desktop-row")!;
      const origin = row.getBoundingClientRect();
      return [...row.querySelectorAll<HTMLElement>(".desktop-stack-child")].map(
        (child) => {
          const box = child.getBoundingClientRect();
          return {
            x: box.x - origin.x,
            y: box.y - origin.y,
            width: box.width,
            height: box.height,
          };
        },
      );
    });
  const stable = async (before: Awaited<ReturnType<typeof geometry>>) => {
    const after = await geometry();
    expect(after).toHaveLength(before.length);
    for (let index = 0; index < after.length; index++)
      for (const key of ["x", "y", "width", "height"] as const)
        expect(Math.abs(after[index][key] - before[index][key])).toBeLessThan(
          1,
        );
    for (const field of [left, right])
      expect(
        await field.evaluate(
          (element) =>
            Reflect.get(window, element.getAttribute("aria-label")!) ===
            element,
        ),
      ).toBe(true);
  };
  try {
    await expect(left).toHaveValue("one");
    await expect(right).toHaveValue("two");
    await expect(left).toBeFocused();
    await expect(gaps).toHaveCount(fill ? 2 : 3);
    await frame(framed);
    await expect(
      dialog.locator(".xterm, [data-desktop-raw-input]"),
    ).toHaveCount(0);
    const first = gaps.first();
    await expect(first.locator(":scope > div")).toHaveText([
      `${nested ? "D" : "A"}\u754c `,
      "B   ",
      "C   ",
    ]);
    const link = first.getByRole("link").first();
    await expect(link).toHaveAttribute("href", "https://example.com/gap");
    await expect(link).toHaveCSS("color", "rgb(11, 122, 99)");
    await expect(first).toHaveCSS("white-space", "pre");
    await expect(first).toHaveCSS("flex-shrink", "0");
    if (!fill) {
      await expect(gaps.last()).toContainText("END");
      expect(
        await gaps
          .last()
          .getByRole("link")
          .first()
          .evaluate((element) => {
            const text = element.getBoundingClientRect();
            const slot = element
              .closest(".desktop-render-gap")!
              .getBoundingClientRect();
            return text.left >= slot.left && text.right <= slot.right;
          }),
      ).toBe(true);
    }
    for (const field of [left, right])
      await field.evaluate((element) =>
        Reflect.set(window, element.getAttribute("aria-label")!, element),
      );
    const initial = await geometry();
    await left.press("End");
    await expect
      .poll(async () =>
        (await snapshot()).desktopSurfaces
          .map((surface) => leftCursor(surface.view))
          .find((cursor) => cursor !== undefined),
      )
      .toBe(3);
    await expect
      .poll(() =>
        left.evaluate(
          (element) => (element as HTMLInputElement).selectionStart,
        ),
      )
      .toBe(3);
    await expect(left).toHaveCSS("outline-offset", "-2px");
    await page.keyboard.type("!");
    await expect(left).toHaveValue("one!");
    await expect.poll(async () => (await state()).left).toBe("one!");
    await right.fill("other");
    await right.press("F2");
    await expect.poll(async () => (await state()).mode).toBe("background");
    await frame(framed);
    await expect(gaps).toHaveCount(fill ? 2 : 3);
    for (const part of await gaps.all()) {
      await expect(part).toHaveText(/^\s*$/);
      await expect(part.locator(":scope > div > span").first()).toHaveCSS(
        "background-color",
        "rgb(201, 225, 239)",
      );
    }
    await stable(initial);
    // Background cells exercise the original handler without activating a link.
    const clicks = (await state()).clicks;
    await first
      .locator(":scope > div")
      .last()
      .click({ position: { x: 20, y: 5 } });
    await expect
      .poll(async () => (await state()).clicks)
      .toBeGreaterThan(clicks);
    await expect
      .poll(async () => (await state()).lastColumn)
      .toBeGreaterThan(0);
    await expect(left).toBeFocused();
    await page.screenshot({
      path: screenshot.replace(/\.png$/, "-background.png"),
      fullPage: true,
    });
    await left.press("F2");
    await expect.poll(async () => (await state()).mode).toBe("normal");
    await expect(gaps).toHaveCount(0);
    await frame(false);
    await expect(left).toHaveValue("one!");
    await expect(right).toHaveValue("other");
    await expect(left).toBeFocused();
    await stable(initial);
    await left.press("F3");
    await expect(left).toHaveValue("SDK");
    await expect(right).toHaveValue("Peer");
    await left.press("F2");
    await expect(gaps).toHaveCount(fill ? 2 : 3);
    await frame(framed);
    await stable(initial);
    await left.press("Enter");
    await expect.poll(async () => (await state()).submitted).toEqual(["SDK"]);
    await page.screenshot({ path: screenshot, fullPage: true });
    await left.press("F4");
    await pending;
    await expect(dialog).toHaveCount(0);
    const result = JSON.parse((await snapshot()).statuses["gap-frame-result"]);
    expect(result.submitted).toEqual(["SDK"]);
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
