import { test, expect, type Page } from "@playwright/test";
import { sdkAction } from "../editor-workflows";
import type { DesktopSnapshot } from "../../shared/types";

async function sessions(page: Page) {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.waitFor();
  const result: DesktopSnapshot[] = [];
  for (const name of ["Loading A", "Loading B", "Loading C"]) {
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.name", { name });
    result.push(await sdkAction<DesktopSnapshot>(page, "snapshot"));
    await editor.fill("draft " + name);
  }
  await sdkAction(page, "session.switch", { path: result[0].sessionFile });
  await expect(editor).toHaveValue("draft Loading A");
  return result;
}
const row = (page: Page, id: string) =>
  page
    .locator(`.session-row[data-session-id="${id}"]`)
    .getByRole("button")
    .first();

test("clicking a delayed session immediately selects its loading page and retains the old draft", async ({
  page,
}) => {
  const [a, b] = await sessions(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/action", async (route) => {
    const req = route.request().postDataJSON();
    if (req.action === "session.switch" && req.args.path === b.sessionFile)
      await gate;
    await route.continue();
  });
  try {
    await row(page, b.sessionId).click();
    await expect(row(page, b.sessionId)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".header-title h1")).toHaveText("Loading B");
    await expect(
      page
        .getByRole("status", { name: "", exact: true })
        .filter({ hasText: "正在加载会话…" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveCount(0);
    expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).sessionId).toBe(
      a.sessionId,
    );
    release();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveValue("draft Loading B");
    await expect(page.locator("[data-session-loading]")).toHaveCount(0);
    await row(page, a.sessionId).click();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveValue("draft Loading A");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("later clicks replace the loading destination without late results flashing the previous session", async ({
  page,
}) => {
  const [, b, c] = await sessions(page);
  let releaseB!: () => void, releaseC!: () => void;
  const gateB = new Promise<void>((r) => (releaseB = r)),
    gateC = new Promise<void>((r) => (releaseC = r));
  let startedB = false,
    startedC = false;
  await page.route("**/api/action", async (route) => {
    const req = route.request().postDataJSON();
    if (req.action === "session.switch" && req.args.path === b.sessionFile) {
      startedB = true;
      await gateB;
    }
    if (req.action === "session.switch" && req.args.path === c.sessionFile) {
      startedC = true;
      await gateC;
    }
    await route.continue();
  });
  try {
    await row(page, b.sessionId).click();
    await expect.poll(() => startedB).toBe(true);
    await row(page, c.sessionId).click();
    await expect(page.locator(".header-title h1")).toHaveText("Loading C");
    await expect(page.locator("[data-session-loading]")).toHaveAttribute(
      "data-session-loading",
      c.sessionId,
    );
    expect(startedC).toBe(false);
    releaseB();
    await expect.poll(() => startedC).toBe(true);
    await expect(page.locator(".header-title h1")).toHaveText("Loading C");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveCount(0);
    releaseC();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveValue("draft Loading C");
    await expect(page.locator("[data-session-loading]")).toHaveCount(0);
  } finally {
    releaseB();
    releaseC();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a failed selection stays on the destination with a working retry", async ({
  page,
}) => {
  const [, b] = await sessions(page);
  let fail = true;
  await page.route("**/api/action", async (route) => {
    const req = route.request().postDataJSON();
    if (
      req.action === "session.switch" &&
      req.args.path === b.sessionFile &&
      fail
    ) {
      fail = false;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary session failure" }),
      });
    } else await route.continue();
  });
  await row(page, b.sessionId).click();
  await expect(page.locator(".header-title h1")).toHaveText("Loading B");
  await expect(page.getByRole("alert")).toContainText(
    "Temporary session failure",
  );
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "重试加载会话", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toHaveValue("draft Loading B");
});
