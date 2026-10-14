import { test, expect } from "@playwright/test";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows";
import type { DesktopSnapshot } from "../../shared/types";

for (const width of [1440, 390]) {
  for (const binding of ["ctrl+x", "f2", "ctrl++", "ctrl+,"])
    test(`provider sign-in URL copies using ${binding} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
      await sdkAction(page, "session.new");
      const { agentDir } = await sdkAction<DesktopSnapshot>(page, "snapshot");
      const path = join(agentDir, "desktop", "pi-copy-color.mjs");
      await cp("tests/fixtures/pi-copy-color.mjs", path);
      const probe = (action: string, extra = {}) =>
        sdkAction<string[]>(page, "sdk.run", {
          path,
          args: { action, ...extra },
        });
      const keys = await readFile(join(agentDir, "keybindings.json"), "utf8");
      let login: Promise<unknown> | undefined;
      try {
        await probe("keys", { bindings: { "app.message.copy": binding } });
        await sdkAction(page, "resources.reload");
        await probe("clipboard");
        await sdkAction(page, "sdk.run", {
          path: join(agentDir, "desktop", "auth-provider.mjs"),
          args: { operation: "install", scenario: "copy-url" },
        });
        login = sdkAction(page, "auth.login", {
          provider: "desktop-auth-test",
        }).catch((e) => e.message);
        const input = page.getByRole("textbox", {
          name: "Fixture callback code",
          exact: true,
        });
        await expect(input).toBeVisible();
        await input.fill("callback draft");
        const banner = page.locator(".auth-banner");
        const button = banner.getByRole("button", {
          name: "复制授权链接",
          exact: true,
        });
        await button.click();
        await expect(banner.getByRole("status")).toHaveText("已复制授权链接");
        const url =
          "https://example.invalid/authorize?state=fixture-state&code_challenge=fixture-challenge";
        expect(await probe("copies")).toEqual([url]);
        if (binding === "ctrl++") await input.press("Control+Shift++");
        else
          await input.press(
            binding === "f2"
              ? "F2"
              : binding === "ctrl+,"
                ? "Control+,"
                : "Control+x",
          );
        await expect.poll(() => probe("copies")).toEqual([url, url]);
        await expect(input).toHaveValue("callback draft");
        await probe("fail-copy");
        await button.click();
        await expect(banner.getByRole("status")).toHaveText(
          "Fixture clipboard unavailable",
        );
        await button.click();
        await expect(banner.getByRole("status")).toHaveText("已复制授权链接");
        await expect(input).toHaveValue("callback draft");
        expect(
          await button.evaluate((e) => e.getBoundingClientRect().height),
        ).toBe(32);
        expect(
          await banner.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        ).toBe(true);
        if (binding === "ctrl+x")
          await page.screenshot({
            path: `.local/pi-120/auth-copy-${width}.png`,
          });
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "确认", exact: true })
          .click();
        await login;
        await expect(banner).toBeHidden();
        await sdkAction(page, "auth.logout", { provider: "desktop-auth-test" });
      } finally {
        await sdkAction(page, "auth.cancel");
        await login;
        await writeFile(join(agentDir, "keybindings.json"), keys);
        await sdkAction(page, "resources.reload");
        await probe("cleanup");
      }
    });
  test(`custom editor compaction preserves native border color at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "session.new");
    const { agentDir } = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const path = join(agentDir, "desktop", "pi-copy-color.mjs");
    await cp("tests/fixtures/pi-copy-color.mjs", path);
    const probe = (action: string) =>
      sdkAction(page, "sdk.run", { path, args: { action } });
    try {
      for (const message of [
        "First color audit turn",
        "Second color audit turn",
      ]) {
        await sdkAction(page, "prompt", { message });
        await expect
          .poll(
            async () =>
              (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
          )
          .toBe(false);
      }
      await probe("editor");
      await expect(
        page.getByRole("textbox", { name: "消息", exact: true }),
      ).toHaveCSS("border-color", "rgb(11, 122, 99)");
      await probe("compact");
      const indicator = page.locator(
        '[data-surface-id="editor"] .desktop-render-additions',
      );
      await expect(page.locator('[data-surface-id="editor"]')).toContainText(
        "Compacting context",
      );
      await expect(page.locator('[data-surface-id="editor"]')).toContainText(
        "escape to cancel",
      );
      const color = await page
        .locator('[data-surface-id="editor"]')
        .getByText(/Compacting context/)
        .evaluate((e) => getComputedStyle(e).color);
      expect(color).toBe("rgb(11, 122, 99)");
      await page.screenshot({
        path: `.local/pi-120/compaction-color-${width}.png`,
      });
      await probe("release");
      await expect(
        page.locator('[data-surface-id="editor"]'),
      ).not.toContainText("Compacting context");
    } finally {
      await probe("cleanup");
    }
  });
}
