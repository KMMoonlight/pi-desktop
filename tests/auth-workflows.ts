import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifySdkAuth(page: Page, screenshot: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = `${initial.agentDir}/desktop/auth-provider.mjs`;
  const operation = (operation: string) =>
    sdkAction<Record<string, unknown>[]>(page, "sdk.run", {
      path,
      args: { operation },
    });
  const login = () =>
    sdkAction(page, "auth.login", { provider: "desktop-auth-test" }).then(
      () => ({ success: true, error: "" }),
      (error: Error) => ({ success: false, error: error.message }),
    );
  await operation("install");
  const pending = login();
  try {
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Fixture account", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText("Same account", { exact: true })).toHaveCount(
      2,
    );
    await expect(
      dialog.getByText("Personal workspace", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Team workspace", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await dialog
      .getByRole("button")
      .filter({ hasText: "Team workspace" })
      .click();
    const region = dialog.getByLabel("Fixture region", { exact: true });
    await expect(region).toHaveAttribute("placeholder", "region-name");
    await region.fill("fixture-region");
    await dialog
      .getByRole("button", { name: "确认", exact: true })
      .click({ timeout: 10_000 });
    const secret = dialog.getByLabel("Fixture secret", { exact: true });
    await expect(secret).toHaveAttribute("type", "password");
    await expect(secret).toHaveAttribute("placeholder", "fixture credential");
    await secret.fill("fixture-only");
    await dialog
      .getByRole("button", { name: "确认", exact: true })
      .click({ timeout: 10_000 });
    expect((await pending).success).toBe(true);
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "打开授权页面", exact: true }),
    ).toHaveCount(0);
    const records = await operation("records");
    expect(records.map((record) => record.type)).toEqual([
      "device",
      "account",
      "region",
      "secret",
    ]);
    expect(records[1].value).toBe("account-b");
    expect(records[2].value).toBe("fixture-region");
    expect(records[3].accepted).toBe(true);
    const device = records[0].value;
    expect(device).toMatch(/^[0-9a-f-]{36}$/i);
    await sdkAction(page, "auth.logout", { provider: "desktop-auth-test" });
    for (const globalAbort of [false, true]) {
      const cancelled = login();
      await expect(
        dialog.getByRole("heading", { name: "Fixture account", exact: true }),
      ).toBeVisible();
      if (globalAbort) await sdkAction(page, "abort");
      else
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
      expect((await cancelled).success).toBe(false);
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "打开授权页面", exact: true }),
      ).toHaveCount(0);
      expect(
        (await operation("records"))
          .filter((record) => record.type === "device")
          .at(-1)?.value,
      ).toBe(device);
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      expect(snapshot.busy).toBe(false);
      expect(
        snapshot.providers.find(
          (provider) => provider.id === "desktop-auth-test",
        )?.configured,
      ).toBe(false);
    }
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await sdkAction(page, "abort");
    await pending;
    await sdkAction(page, "auth.logout", { provider: "desktop-auth-test" });
  }
}
