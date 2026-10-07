import { expect, type Page, type Locator } from "@playwright/test";
import type { DesktopSnapshot } from "../shared/types.ts";
import { sdkAction } from "./editor-workflows.ts";

type Record = { key: string; phase: string; target?: number };
type PhaseState = {
  global: Record[];
  factory: Record[];
  received: Record[];
  values: string[];
};
export const keyboardPhaseModes = ["native", "ordinary", "terminal"] as const;

async function state(page: Page): Promise<PhaseState> {
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  return JSON.parse(snapshot.statuses["keyboard-phases"]);
}

async function compose(control: Locator, text: string) {
  await control.evaluate((element: HTMLInputElement, value) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    element.value = value;
    element.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: value }),
    );
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: value,
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: value }),
    );
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: value,
        inputType: "insertFromComposition",
      }),
    );
  }, text);
}

export async function verifyKeyboardPhases(
  page: Page,
  mode: (typeof keyboardPhaseModes)[number],
  screenshot: string,
) {
  await sdkAction(page, "prompt", { message: `/keyboard-phase-probe ${mode}` });
  const dialog = page.getByRole("dialog");
  const terminal = dialog.locator(".component-terminal");
  const control =
    mode === "terminal"
      ? terminal.locator(".xterm-helper-textarea")
      : dialog.getByRole("textbox", { name: "Phase source", exact: true });
  if (mode === "terminal") {
    await expect(terminal.locator(".xterm-screen")).toBeVisible();
    await terminal
      .locator(".xterm-screen")
      .click({ position: { x: 10, y: 10 } });
  } else await expect(control).toBeFocused();
  await expect.poll(async () => (await state(page)).values).toEqual(["", ""]);
  await page.keyboard.down("x");
  await page.keyboard.down("x");
  await page.keyboard.up("x");
  await expect
    .poll(async () =>
      (await state(page)).factory
        .filter((e) => e.key === "x")
        .map((e) => e.phase),
    )
    .toEqual(["press", "repeat", "release"]);
  let current = await state(page);
  expect(
    current.global.filter((e) => e.key === "x").map((e) => e.phase),
  ).toEqual(["press", "repeat", "release"]);
  expect(
    current.received.filter((e) => e.key === "x").map((e) => e.phase),
  ).toEqual(
    mode === "ordinary" ? ["press", "repeat"] : ["press", "repeat", "release"],
  );
  expect(current.values[0]).toBe("xx");
  await page.keyboard.press("F5");
  await expect
    .poll(async () =>
      (await state(page)).factory.some(
        (e) => e.phase === "release" && e.key.includes("15;1:3"),
      ),
    )
    .toBe(true);
  expect((await state(page)).values[0]).toBe("xx");
  if (mode !== "terminal") {
    await control.evaluate((element: HTMLInputElement) => {
      element.setSelectionRange(0, 2);
      element.dispatchEvent(new Event("select", { bubbles: true }));
    });
    await page.keyboard.down("y");
    await page.keyboard.down("y");
    await page.keyboard.up("y");
    await expect(control).toHaveValue("yy");
  }
  await compose(control, "中文");
  const prefix = mode === "terminal" ? "xx" : "yy";
  await expect
    .poll(async () => (await state(page)).values[0])
    .toBe(prefix + "中文");
  await control.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "PASTE");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect
    .poll(async () => (await state(page)).values[0])
    .toBe(prefix + "中文PASTE");
  current = await state(page);
  expect(current.global.filter((e) => e.key === "中文")).toHaveLength(1);
  expect(current.received.filter((e) => e.key === "中文")).toHaveLength(1);
  expect(current.received.filter((e) => e.key.includes("PASTE"))).toHaveLength(
    1,
  );
  const before = current.received.filter(
    (e) => e.key === "c" && e.phase === "release",
  ).length;
  await page.keyboard.press("c");
  await expect
    .poll(
      async () =>
        (await state(page)).factory.filter((e) => e.key === "c").length,
    )
    .toBe(2);
  expect(
    (await state(page)).received.filter(
      (e) => e.key === "c" && e.phase === "release",
    ),
  ).toHaveLength(before);
  await page.keyboard.press("r");
  await expect
    .poll(async () => (await state(page)).values[0])
    .toBe(prefix + "中文PASTEcrR");
  const beforeS = (await state(page)).values[0];
  await page.keyboard.press("s");
  await expect
    .poll(
      async () =>
        (await state(page)).factory.filter((e) => e.key === "s").length,
    )
    .toBe(2);
  expect((await state(page)).values[0]).toBe(beforeS);
  if (mode === "native") {
    await page.keyboard.press("f");
    await expect(
      dialog.getByRole("textbox", { name: "Phase destination", exact: true }),
    ).toBeFocused();
    await expect
      .poll(async () =>
        (await state(page)).received
          .filter((e) => e.key === "f" && e.phase === "release")
          .map((e) => e.target),
      )
      .toEqual([1]);
    expect((await state(page)).values[1]).toBe("");
  }
  await page.screenshot({ path: screenshot });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await composer.focus();
  const initial = Number(
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
      "keyboard-phase-shortcut"
    ] ?? 0,
  );
  await page.keyboard.press("Control+Alt+k");
  await expect
    .poll(async () =>
      Number(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "keyboard-phase-shortcut"
        ],
      ),
    )
    .toBe(initial + 1);
  await composer.fill("draft");
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.up("ArrowLeft");
  await expect
    .poll(() =>
      composer.evaluate(
        (element: HTMLTextAreaElement) => element.selectionStart,
      ),
    )
    .toBe(3);
  await expect(composer).toHaveValue("draft");
}
