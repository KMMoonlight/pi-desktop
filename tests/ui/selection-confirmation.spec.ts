import { test, expect } from "@playwright/test";
import { sdkAction } from "../editor-workflows.ts";

for (const width of [1440, 390])
  test(`a late insertion snapshot preserves a newer native range selection at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.addInitScript(() => {
      const state = { hold: false, queued: [] as (() => void)[] };
      Object.assign(window, { selectionSnapshotGate: state });
      const Original = window.EventSource;
      window.EventSource = class extends Original {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          Object.defineProperty(this, "onmessage", {
            set: (handler: (event: MessageEvent) => void) => {
              this.addEventListener("message", (event) => {
                if (state.hold && JSON.parse(event.data).type === "snapshot")
                  state.queued.push(() => handler(event));
                else handler(event);
              });
            },
          });
        }
      };
    });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "session.new");
    await sdkAction(page, "prompt", { message: "/mapped-form" });
    const input = page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Name", exact: true });
    await input.waitFor();
    let release!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let intercepted = false;
    await page.route("**/api/action", async (route) => {
      const request = route.request().postDataJSON();
      if (
        request.action !== "desktop.input" ||
        request.args.data !== "protected"
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      intercepted = true;
      await responseGate;
      await route.fulfill({ response });
    });
    try {
      await page.evaluate(() => {
        (
          window as unknown as { selectionSnapshotGate: { hold: boolean } }
        ).selectionSnapshotGate.hold = true;
      });
      await input.fill("protected");
      await expect.poll(() => intercepted).toBe(true);
      await input.selectText();
      release();
      await expect(input).not.toHaveAttribute("data-pi-input-pending", "true");
      expect(
        await input.evaluate((node: HTMLInputElement) => [
          node.selectionStart,
          node.selectionEnd,
        ]),
      ).toEqual([0, 9]);
      await page.evaluate(async () => {
        const gate = (
          window as unknown as {
            selectionSnapshotGate: { hold: boolean; queued: (() => void)[] };
          }
        ).selectionSnapshotGate;
        gate.hold = false;
        gate.queued.splice(0).forEach((deliver) => deliver());
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      await expect
        .poll(() =>
          input.evaluate((node: HTMLInputElement) => [
            node.selectionStart,
            node.selectionEnd,
          ]),
        )
        .toEqual([0, 9]);
      await input.press("Delete");
      await expect(input).toHaveValue("protected");
      expect(
        await input.evaluate((node: HTMLInputElement) => [
          node.selectionStart,
          node.selectionEnd,
        ]),
      ).toEqual([0, 9]);
      const context = await input.evaluate((node) => {
        const surface = node.closest<HTMLElement>("[data-surface-id]")!;
        return {
          id: surface.dataset.surfaceId,
          instanceId: surface.dataset.instanceId,
          action: `${node.getAttribute("data-desktop-action")}:selection`,
        };
      });
      await sdkAction(page, "desktop.action", {
        ...context,
        value: { start: 2, end: 5, text: "protected" },
      });
      await expect
        .poll(() =>
          input.evaluate((node: HTMLInputElement) => [
            node.selectionStart,
            node.selectionEnd,
          ]),
        )
        .toEqual([2, 5]);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
      await sdkAction(page, "abort");
    }
  });
