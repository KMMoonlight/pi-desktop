import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
export const managedToolModes = [
  "recursive",
  "scoped",
  "reprepare",
  "statuses",
] as const;
interface Probe {
  query: string;
  applied: string[];
  fd: string;
  toolsSame: boolean;
  editorSame: boolean;
  scopeSame: boolean;
  providerFd: string;
  classes?: string[];
  rendered?: string;
  editorText: string;
  triggers: string[];
}
export async function verifyManagedTools(
  page: Page,
  mode: (typeof managedToolModes)[number],
  screenshot: string,
) {
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await composer.waitFor({ state: "visible", timeout: 30000 });
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const probe = (action = "inspect") =>
    sdkAction<Probe>(page, "sdk.run", {
      path: `${snapshot.agentDir}/desktop/managed-tools-probe.mjs`,
      args: { action, mode },
    });
  const seeded = await probe("seed");
  try {
    expect(seeded.fd).toBeTruthy();
    expect(seeded.providerFd).toBe(seeded.fd);
    expect(seeded.toolsSame && seeded.editorSame && seeded.scopeSame).toBe(
      true,
    );
    if (mode === "statuses") {
      expect(seeded.classes).toEqual([
        "Spacer",
        "ThemedText",
        "ThemedText",
        "ThemedText",
      ]);
      const surface = page.locator('[data-surface-id="widget:managed-status"]');
      for (const text of [
        "Native fd preparation",
        "Warning: Native offline rg warning",
        "Native tools settled",
      ])
        await expect(surface).toContainText(text);
      expect(await surface.locator(".xterm,canvas").count()).toBe(0);
    } else {
      if (mode === "reprepare") {
        await composer.fill("Managed preparation draft");
        const prepared = await probe("reprepare");
        expect(prepared.fd).toBe(seeded.fd);
        expect(prepared.editorSame).toBe(true);
        expect(prepared.triggers).toEqual(["~", "%"]);
        await expect(composer).toHaveValue("Managed preparation draft");
        await composer.fill("~managed");
        const surface = page.locator('[data-surface-id="editor"]');
        const customCompletion = surface.getByRole("combobox", {
          name: "选择",
          exact: true,
        });
        await expect(customCompletion).toBeVisible();
        await surface
          .getByRole("button", { name: "确认", exact: true })
          .click();
        await expect(composer).toHaveValue("Retained managed wrapper");
        await sdkAction(page, "resources.reload");
        const reloaded = await probe();
        expect(
          reloaded.editorSame && reloaded.scopeSame && reloaded.toolsSame,
        ).toBe(true);
        expect(reloaded.providerFd).toBe(seeded.fd);
        expect(reloaded.triggers).toEqual([]);
        await probe("history");
        await expect(composer).toHaveValue(
          "Managed completion retained history",
        );
      }
      await composer.fill(seeded.query);
      await expect
        .poll(
          async () =>
            (await sdkAction<DesktopSnapshot>(page, "snapshot")).editor.text,
        )
        .toBe(seeded.query);
      const surface = page.locator('[data-surface-id="editor"]');
      const completion = surface.getByRole("combobox", {
        name: "选择",
        exact: true,
      });
      await expect(completion).toBeVisible();
      await completion.selectOption({ index: 1 });
      await surface.getByRole("button", { name: "确认", exact: true }).click();
      await expect(composer).toHaveValue(seeded.applied[1]!);
      expect(seeded.applied[1]).toContain("managed-needle");
      if (mode === "scoped")
        expect(
          seeded.applied.every((value) => value.includes("/nested/")),
        ).toBe(true);
      await composer.fill(seeded.query);
      await expect(completion).toBeVisible();
      await sdkAction(page, "desktop.input", {
        surfaceId: "editor",
        data: "\x1b",
      });
      await expect(completion).toBeHidden();
      await composer.fill("Latest non-completion draft");
      await expect(composer).toHaveValue("Latest non-completion draft");
    }
    await page.screenshot({ path: screenshot, animations: "disabled" });
  } finally {
    await probe("cleanup");
    await sdkAction(page, "session.new");
  }
}
