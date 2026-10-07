import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

interface Observation {
  callExpanded: boolean;
  resultExpanded: boolean;
  consumed: number;
  submitted?: string;
  disposed: number;
}
export async function verifyToolDisplay(page: Page, screenshot: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(initial.agentDir, "desktop", "tool-display-control.mjs");
  await cp(
    new URL("./fixtures/tool-display-control.mjs", import.meta.url),
    path,
  );
  const run = (args: Record<string, unknown>) =>
    sdkAction(page, "sdk.run", { path, args });
  const state = (id: string) =>
    run({ mode: "state", ids: [id] }) as Promise<Record<string, Observation>>;
  const row = (id: string) =>
    page.locator(`.tool-execution[data-tool-call-id="${id}"]`);
  const label = (id: string, phase = "result") =>
    row(id)
      .locator(`[data-surface-id="render:${phase}:${id}"] .desktop-text`)
      .first();
  const expanded = (id: string, value: boolean) =>
    expect(row(id)).toHaveAttribute("data-tool-expanded", String(value));
  const background = async (id: string, token: string) => {
    const state =
      token === "toolErrorBg"
        ? "error"
        : token === "toolPendingBg"
          ? "pending"
          : "success";
    await expect(row(id)).toHaveAttribute("data-tool-state", state);
    await expect(row(id).locator(".tool-body")).not.toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    const border = await page.evaluate(
      (width) => {
        // WebView2 quantizes CSS hairlines to physical pixels at Windows scaling.
        return Math.floor(width * devicePixelRatio) / devicePixelRatio;
      },
      state === "success" ? 1 : 2,
    );
    await expect
      .poll(() =>
        row(id)
          .locator(".tool-body")
          .evaluate((element) =>
            parseFloat(getComputedStyle(element).borderLeftWidth),
          ),
      )
      .toBeCloseTo(border, 3);
  };
  try {
    const image = (await readFile("src-tauri/icons/128x128.png")).toString(
      "base64",
    );
    await run({ mode: "seed", image, expanded: false });
    await expect(page.locator(".tool-execution")).toHaveCount(5);
    for (const variant of ["fallback", "custom", "control", "self", "unknown"])
      await expect(
        row(`display-${variant}`).locator("[data-surface-id]"),
      ).toHaveCount(2);
    await expect(row("display-fallback")).toContainText("4 more lines");
    await expect(row("display-fallback")).not.toContainText("line 11");
    await expect(row("display-unknown")).toContainText("line 14");
    await expect(page.locator(".tool-execution > summary")).toHaveCount(0);
    await expect(
      row("display-fallback").locator(".tool-images img"),
    ).toHaveCount(1);
    await background("display-fallback", "toolErrorBg");
    await background("display-custom", "toolSuccessBg");
    await expect(row("display-self").locator(".tool-body")).toHaveCSS(
      "padding-top",
      "0px",
    );
    await expect(row("display-self").locator(".tool-body")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    expect(
      await row("display-custom")
        .locator(".tool-body")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            parseFloat(style.paddingTop) > 0 &&
            Math.abs(
              parseFloat(style.borderTopWidth) -
                Math.floor(devicePixelRatio) / devicePixelRatio,
            ) < 0.001
          );
        }),
    ).toBe(true);
    await label("display-fallback").click({
      button: "right",
      position: { x: 6, y: 6 },
    });
    await expanded("display-fallback", false);
    await label("display-fallback").click({ position: { x: 6, y: 6 } });
    await expanded("display-fallback", true);
    await expect(row("display-fallback")).toContainText("line 14");
    await expanded("display-custom", false);
    await run({ expanded: false });
    await expanded("display-fallback", true);
    await row("display-custom").getByRole("button", { name: "展开 display_custom 输出", exact: true }).click();
    await expanded("display-custom", true);
    const link = row("display-custom").getByRole("link", {
      name: "Display reference",
      exact: true,
    });
    await expect(link).toHaveAttribute(
      "href",
      "https://example.invalid/pi-tool",
    );
    await link.evaluate((element) => {
      element.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          element.setAttribute("data-test-link-opened", "true");
        },
        { once: true },
      );
    });
    await link.click();
    await expect(link).toHaveAttribute("data-test-link-opened", "true");
    await expanded("display-custom", true);
    await label("display-custom", "call").click({ position: { x: 6, y: 6 } });
    await expanded("display-custom", false);
    await expect.poll(async () => (await state("display-custom"))["display-custom"])
      .toMatchObject({ callExpanded: false, resultExpanded: false });
    await row("display-custom").getByRole("button", { name: "展开 display_custom 输出", exact: true }).click();
    await expanded("display-custom", true);
    await expect
      .poll(async () => (await state("display-custom"))["display-custom"])
      .toMatchObject({ callExpanded: true, resultExpanded: true });
    const selfInput = row("display-self").getByRole("textbox", {
      name: "display_self input",
      exact: true,
    });
    await selfInput.click();
    await expanded("display-self", false);
    await selfInput.fill("Desktop display input");
    await selfInput.press("Enter");
    await expect
      .poll(async () => (await state("display-self"))["display-self"].submitted)
      .toBe("Desktop display input");
    await row("display-self")
      .getByText("display_self consumed click", { exact: true })
      .click();
    await expect
      .poll(async () => (await state("display-self"))["display-self"].consumed)
      .toBe(1);
    await expanded("display-self", false);
    await label("display-self").click({ position: { x: 6, y: 6 } });
    await expanded("display-self", true);
    await run({ expanded: true });
    for (const variant of ["fallback", "custom", "control", "self", "unknown"])
      await expanded(`display-${variant}`, true);
    await label("display-custom").click({ position: { x: 6, y: 6 } });
    await expanded("display-custom", false);
    await run({ expanded: true });
    await expanded("display-custom", false);
    await run({ mode: "append" });
    await expanded("display-later", true);
    await sdkAction(page, "theme.set", { theme: "dark" });
    await background("display-fallback", "toolErrorBg");
    await background("display-custom", "toolSuccessBg");
    await expanded("display-custom", false);
    await expect(selfInput).toHaveValue("Desktop display input");
    await selfInput.scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await page.reload();
    await expanded("display-custom", false);
    await expect(selfInput).toHaveValue("Desktop display input");
    const saved = await sdkAction<DesktopSnapshot>(page, "snapshot");
    await sdkAction(page, "resources.reload");
    await expanded("display-custom", true);
    await expect(selfInput).toHaveValue("Display original input");
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.switch", { path: saved.sessionFile });
    await expanded("display-custom", true);
    await run({ mode: "observeMouse" });
    await run({ mode: "pending" });
    await expect(row("display-partial")).toHaveAttribute(
      "data-tool-state",
      "pending",
    );
    await label("display-partial", "call").click({ position: { x: 6, y: 6 } });
    // The pending call's expansion is unchanged, so wait for its actual release reply.
    await expect
      .poll(
        async () =>
          ((await run({ mode: "mouseState" })) as Record<string, number>)[
            "render:call:display-partial"
          ],
      )
      .toBe(1);
    await expanded("display-partial", true);
    await run({ mode: "partial" });
    await expect(
      row("display-partial").locator("[data-surface-id]"),
    ).toHaveCount(2);
    await background("display-partial", "toolPendingBg");
    await label("display-partial").click({ position: { x: 6, y: 6 } });
    await expanded("display-partial", false);
    const partialInput = row("display-partial").getByRole("textbox", {
      name: "display_control input",
      exact: true,
    });
    await partialInput.fill("Retained partial input");
    await partialInput.press("Enter");
    await expect
      .poll(
        async () =>
          (await state("display-partial"))["display-partial"].submitted,
      )
      .toBe("Retained partial input");
    await expanded("display-partial", false);
    await partialInput.focus();
    const original = await partialInput.elementHandle();
    await page.screenshot({
      path: screenshot.replace(/\.png$/, "-partial.png"),
      animations: "disabled",
    });
    await run({ mode: "complete", error: true });
    await expect(row("display-partial")).toHaveAttribute(
      "data-tool-state",
      "error",
    );
    await expanded("display-partial", false);
    await background("display-partial", "toolErrorBg");
    await expect(partialInput).toHaveValue("Retained partial input");
    expect(
      await original!.evaluate(
        (element) => element.isConnected && document.activeElement === element,
      ),
    ).toBe(true);
    expect((await state("display-partial"))["display-partial"].disposed).toBe(
      0,
    );
    await expect(row("display-partial")).toHaveCount(1);
    expect(
      await page
        .locator(".transcript")
        .evaluate((element) => element.scrollWidth > element.clientWidth + 1),
    ).toBe(false);
  } finally {
    if (!page.isClosed()) {
      await run({ mode: "restoreMouse" });
      await run({ expanded: false });
      await sdkAction(page, "theme.set", {
        theme: initial.extensionUI.theme?.name ?? "system",
      });
    }
  }
}
