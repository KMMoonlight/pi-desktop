import { test, expect } from "@playwright/test";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

async function setup(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(snapshot.agentDir, "desktop", "edit-review-control.mjs");
  await cp(
    new URL("../fixtures/edit-review-control.mjs", import.meta.url),
    path,
  );
  return (mode: string) => sdkAction(page, "sdk.run", { path, args: { mode } });
}

test("edit cards keep exact diffs and file links readable across themes and window sizes", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const run = await setup(page);
  const files = (await run("seed")) as { path: string; diff: string }[];
  await page.locator(".process-group > summary").click();
  const cards = page.locator(".edit-review-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("ui.tsx");
  await expect(cards.first().locator(".edit-review-counts")).toHaveText("+2−1");
  await expect(cards.first().locator(".edit-review-code")).toContainText(
    "你好，Pi",
  );
  await cards
    .first()
    .getByRole("button", { name: "复制文件 diff", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(files[0].diff);
  await expect(
    cards.first().getByRole("button", { name: "复制文件 diff", exact: true }),
  ).toBeVisible();
  await mkdir(".local/edit-review", { recursive: true });
  for (const theme of ["light", "dark"]) {
    await sdkAction(page, "theme.set", { theme });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 940 });
      const backdrop = page.getByRole("button", {
        name: "关闭侧边栏遮罩",
        exact: true,
      });
      if (await backdrop.isVisible())
        await backdrop.click({ position: { x: width - 5, y: 500 } });
      await cards.first().scrollIntoViewIfNeeded();
      await expect(cards.first().getByRole("button").first()).toBeInViewport();
      expect(
        await cards
          .first()
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      expect(
        await page
          .locator(".transcript")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      await expect(
        cards.first().locator(".edit-review-line > code").first(),
      ).toHaveCSS("white-space", "pre");
      await page.screenshot({
        path: `.local/edit-review/${theme}-${width}.png`,
        animations: "disabled",
      });
      await cards
        .first()
        .screenshot({ path: `.local/edit-review/card-${theme}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 940 });
  await cards
    .first()
    .getByRole("link", { name: "ui.tsx", exact: true })
    .click();
  await expect(page.locator(".file-preview .preview-header")).toContainText(
    "ui.tsx",
  );
  await expect(page.locator(".file-preview .source-code")).toContainText(
    "export type Status = 'ready';",
  );
  await sdkAction(page, "theme.set", { theme: "light" });
});

test("live edit previews retain pending, completed and failed states without mutating files early", async ({
  page,
}) => {
  const run = await setup(page);
  try {
    const pending = (await run("pending")) as { path: string };
    await page.locator(".process-group > summary").click();
    await expect(page.locator(".edit-review-card")).toHaveCount(1);
    await expect(page.locator(".edit-review-card")).toBeVisible();
    await expect(page.locator(".tool-edit-review")).toHaveAttribute(
      "data-tool-state",
      "pending",
    );
    await expect(page.locator(".edit-review-code")).toContainText(
      "export type Status = 'ready';",
    );
    expect(await readFile(pending.path, "utf8")).toBe(
      "export type Status = 'loading';\n",
    );
    await page.screenshot({
      path: ".local/edit-review/pending.png",
      animations: "disabled",
    });
    await run("complete");
    await expect(page.locator(".tool-edit-review")).toHaveAttribute(
      "data-tool-state",
      "success",
    );
    await expect(page.locator(".edit-review-card")).toHaveCount(1);
    expect(await readFile(pending.path, "utf8")).toContain(
      "export type Status = 'ready';",
    );
    await sdkAction(page, "session.new");
    await run("error");
    await page.locator(".process-group > summary").click();
    await expect(page.locator(".edit-review-error")).toContainText(
      "missing.tsx",
    );
    await expect(
      page
        .locator(".edit-review-card")
        .getByRole("button", { name: "复制文件 diff", exact: true }),
    ).toHaveCount(0);
    await run("fail");
    await expect(page.locator(".tool-edit-review")).toHaveAttribute(
      "data-tool-state",
      "error",
    );
    await expect(page.locator(".edit-review-error")).toContainText(
      "missing.tsx",
    );
    await page.screenshot({
      path: ".local/edit-review/error.png",
      animations: "disabled",
    });
  } finally {
    await run("clear");
  }
});
