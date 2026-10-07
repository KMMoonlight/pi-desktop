import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const applicationContentModes = [
  "header",
  "resources",
  "pending",
  "widgets",
] as const;
interface Probe {
  same: boolean;
  headerSame: boolean;
  instancesSame: boolean;
  treeIncludes: boolean;
  classes: string[];
  rendered: string;
  order: string[];
  placements: Record<string, string>;
  disposed: number;
  value?: string;
  sdkHash: string;
}
export async function verifyApplicationContent(
  page: Page,
  mode: (typeof applicationContentModes)[number],
  screenshot: string,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action = "inspect") =>
    sdkAction<Probe>(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/application-content-probe.mjs`,
      args: { action, mode },
    });
  const initial = await probe("seed");
  try {
    expect(
      initial.same &&
        initial.headerSame &&
        initial.instancesSame &&
        initial.treeIncludes,
    ).toBe(true);
    const surface = page.locator(
      mode === "header"
        ? '[data-surface-id="header"]'
        : '[data-surface-id="widget:content-preview"]',
    );
    if (mode === "header") {
      expect(initial.classes).toEqual(["Spacer", "BuiltInHeader", "Spacer"]);
      await expect(surface).toContainText("v1.0.0");
      await expect(surface).toContainText("full startup help");
      const expanded = await probe("expand");
      expect(expanded.instancesSame).toBe(true);
      await expect(surface).toContainText("to queue follow-up");
    } else if (mode === "resources") {
      expect(initial.classes).toContain("ExpandableText");
      await expect(surface).toContainText("[Extensions]");
      const expanded = await probe("expand");
      expect(expanded.instancesSame).toBe(true);
      await expect(surface).toContainText("user");
    } else if (mode === "pending") {
      expect(initial.classes).toEqual([
        "Spacer",
        "TruncatedText",
        "TruncatedText",
        "TruncatedText",
      ]);
      await expect(surface).toContainText("Steering: Native pending direction");
      await expect(surface).toContainText(
        "Follow-up: Native pending follow-up",
      );
      // The original truncation depends on the available native width.
      expect(initial.rendered).toContain("to edit all queued messages");
      await expect(surface).toContainText("↳");
    } else {
      expect(initial.order).toEqual(["10", "factory", "2"]);
      await expect(page.locator('[data-pi-widget="10"]')).toContainText(
        "widget truncated",
      );
      await expect(page.locator('[data-pi-widget="10"]')).not.toContainText(
        "Native bounded row 11",
      );
      await expect
        .poll(() =>
          page
            .locator("[data-pi-widget]")
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute("data-pi-widget")),
            ),
        )
        .toEqual(["10", "factory", "2"]);
      const input = page.getByRole("textbox", {
        name: "Native ordered input",
        exact: true,
      });
      await input.fill("Native mixed factory value");
      await expect
        .poll(async () => (await probe()).value)
        .toBe("Native mixed factory value");
    }
    await page.screenshot({ path: screenshot, animations: "disabled" });
    const mutated = await probe("mutate");
    expect(mutated.instancesSame && mutated.treeIncludes).toBe(true);
    expect(mutated.sdkHash).toBe(initial.sdkHash);
    await expect(
      mode === "widgets" ? page.locator('[data-pi-widget="10"]') : surface,
    ).toContainText("Direct native application content mutation");
    if (mode === "header" || mode === "resources") {
      const themed = await probe("theme");
      expect(themed.instancesSame).toBe(true);
      await expect(surface).toContainText(
        mode === "header" ? "v1.0.0" : "[Extensions]",
      );
    } else if (mode === "pending") {
      await probe("clear");
      await expect(surface).toHaveCount(0);
      expect((await probe()).classes).toEqual([]);
    } else {
      const moved = await probe("move");
      expect(moved.order).toEqual(["factory", "2", "10"]);
      expect(moved.placements["10"]).toBe("belowEditor");
      await expect(page.locator('[data-pi-widget="10"]')).toContainText(
        "Native moved numeric row",
      );
      await expect
        .poll(() =>
          page
            .locator("[data-pi-widget]")
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute("data-pi-widget")),
            ),
        )
        .toEqual(["factory", "2", "10"]);
      expect((await probe("remove")).disposed).toBe(1);
      await expect(page.locator('[data-pi-widget="factory"]')).toHaveCount(0);
    }
    await sdkAction(page, "resources.reload");
    const reset = await probe();
    expect(reset.same && reset.headerSame).toBe(true);
    expect(reset.order).toEqual([]);
    await expect(page.locator("[data-pi-widget]")).toHaveCount(0);
  } finally {
    await probe("restore");
    await sdkAction(page, "session.new");
  }
}
