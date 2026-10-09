import { test, expect } from "@playwright/test";
import { sdkAction, verifyDefaultEditor } from "../editor-workflows.ts";

test("typing is visible before backend acknowledgement and queued editing stays ordered", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await sdkAction(page, "session.new");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let held = false;
  await page.route("**/api/action", async (route) => {
    const request = route.request().postDataJSON();
    if (request.action === "desktop.input" && request.args?.event?.key === "a") {
      held = true;
      await pending;
    }
    await route.continue();
  });
  try {
    await composer.pressSequentially("abc XYZ");
    await expect.poll(() => held).toBe(true);
    // The backend has not received even the first character yet.
    await expect(composer).toHaveValue("abc XYZ", { timeout: 1000 });
    await composer.press("Backspace");
    release();
    await expect(composer).toHaveValue("abc XY");
    await composer.press("ArrowLeft");
    await composer.pressSequentially("!");
    await expect(composer).toHaveValue("abc X!Y");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

function textAction(
  request: {
    action?: string;
    args?: {
      id?: string;
      surfaceId?: string;
      data?: string;
      action?: string;
      value?: { text?: string };
    };
  },
  value: string,
) {
  return (
    (request.action === "desktop.input" &&
      request.args?.surfaceId === "editor" &&
      (request.args.data === value ||
        request.args.data === `\x1b[200~${value}\x1b[201~`)) ||
    (request.action === "desktop.action" &&
      request.args?.id === "editor" &&
      /^component:\d+$/.test(request.args.action ?? "") &&
      request.args.value?.text === value)
  );
}

test("sending immediately after a draft replacement submits the displayed text while synchronization is pending", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await sdkAction(page, "session.new");
  const saved = page.waitForResponse((response) =>
    textAction(response.request().postDataJSON(), "old draft"),
  );
  await composer.fill("old draft");
  await saved;
  let release: () => void = () => {};
  let captured: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/action", async (route) => {
    const request = route.request().postDataJSON();
    if (textAction(request, "fresh draft")) {
      captured();
      await pending;
    }
    await route.continue();
  });
  try {
    await composer.fill("fresh draft");
    await held;
    const prompt = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.postDataJSON()?.action === "prompt",
    );
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    expect((await prompt).postDataJSON().args.message).toBe("fresh draft");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await sdkAction(page, "abort");
  }
});

test("a delayed insertion confirmation preserves an editor command queued afterwards", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await sdkAction(page, "session.new");
  let release: () => void = () => {};
  let captured: () => void = () => {};
  const responseHeld = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const responseRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/action", async (route) => {
    const request = route.request().postDataJSON();
    if (!textAction(request, "one two three")) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    captured();
    await responseRelease;
    await route.fulfill({ response });
  });
  try {
    await composer.fill("one two three");
    await responseHeld;
    await composer.press("Control+w");
    const confirmed = page.waitForResponse((response) =>
      textAction(response.request().postDataJSON(), "one two three"),
    );
    release();
    await confirmed;
    await expect(composer).toHaveValue("one two ");
  } finally {
    release();
  }
});

for (const width of [1440, 390])
  test(`default editor application actions, images, queues and session drafts at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 940 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await verifyDefaultEditor(
      page,
      `.local/screenshots/default-editor-${width}.png`,
    );
    expect(errors).toEqual([]);
  });
