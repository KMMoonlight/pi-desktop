import { test, expect } from "@playwright/test";
import {
  verifyComponentWindow,
  verifyComponentOverlays,
  verifyComponentMapping,
  verifyComponentPointer,
  verifyComponentMultiPointer,
  verifyNativeComponentPointer,
  verifyNativeMouseRegions,
  verifyMappedEditorTransactions,
  verifyMappedPasteBlocks,
  verifyMappedComposition,
} from "../component-workflows.ts";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const width of [1440, 390]) {
  test(`independent touch pointers release rejected captures and retain surviving drags at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.route("**/api/action", async (route) => {
      const request = route.request().postDataJSON();
      if (
        request.action !== "desktop.mouse" ||
        request.args.event.type !== "press"
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ response });
    });
    try {
      await verifyComponentMultiPointer(
        page,
        `.local/screenshots/component-touch-${width}.png`,
      );
    } finally {
      await page.unrouteAll({ behavior: "wait" });
    }
  });

  test(`mapped overlays retain original positioning and measured desktop height across resize at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyComponentOverlays(
      page,
      `.local/screenshots/overlay-geometry-${width}.png`,
      true,
    );
  });

  test(`component window state retains shared progress and original title callbacks at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyComponentWindow(page);
  });
}

for (const width of [1440, 390]) {
  test(`mapped components commit composition once and preserve original handlers at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await verifyMappedComposition(
      page,
      `.local/screenshots/mapped-composition-${width}.png`,
    );
  });

  test(`mapped paste blocks retain native preview, selection and undo at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await verifyMappedPasteBlocks(
      page,
      `.local/screenshots/mapped-paste-blocks-${width}.png`,
    );
  });

  test(`completion clicks follow pending original editor input at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await sdkAction(page, "session.new");
    const completionSnapshot = await sdkAction<DesktopSnapshot>(
      page,
      "snapshot",
    );
    try {
      await sdkAction(page, "prompt", { message: "/mapped-editor" });
      await page.route("**/api/action", async (route) => {
        if (route.request().postDataJSON().action !== "desktop.input") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 75));
        await route.fulfill({ response });
      });
      const composer = page.getByRole("textbox", { name: "消息", exact: true });
      await composer.pressSequentially("/mapped-s");
      await composer.press("Tab");
      const editor = page.locator('[data-surface-id="editor"]');
      await expect(
        editor.getByRole("option", { name: /mapped-settings/ }),
      ).toBeVisible();
      await editor.getByRole("option", { name: /mapped-settings/ }).click();
      await expect(composer).toHaveValue("/mapped-settings ");
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await sdkAction(page, "sdk.run", {
        path: `${completionSnapshot.agentDir}/desktop/editor-action.mjs`,
        args: { action: "restore" },
      });
      await sdkAction(page, "session.new");
    }
  });

  test(`mapped editors preserve large pastes, selection undo and submission at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await verifyMappedEditorTransactions(
      page,
      `.local/screenshots/mapped-editor-transactions-${width}.png`,
    );
  });

  test(`desktop hit paths route horizontal controls, shared components and clipped scroll rows at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await sdkAction(page, "session.new");
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const records = async (key: string) =>
      JSON.parse(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[key] ??
          "[]",
      ) as {
        type: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }[];
    try {
      await sdkAction(page, "prompt", { message: "/mapped-layout-pointer" });
      const dialog = page.getByRole("dialog");
      const right = dialog.getByRole("textbox", {
        name: "Right column",
        exact: true,
      });
      const left = dialog.getByRole("textbox", {
        name: "Left column",
        exact: true,
      });
      await right.hover();
      await page.mouse.wheel(0, 20);
      await expect(right).toHaveValue("Right original wheel");
      await expect(left).toHaveValue("Left value");
      expect(
        (await records("layout-Right-pointer")).filter(
          (event) => event.type === "wheel",
        ),
      ).toHaveLength(1);
      expect(
        (await records("layout-Left-pointer")).filter(
          (event) => event.type === "wheel",
        ),
      ).toHaveLength(0);
      const shared = dialog.getByText("Shared layout target", { exact: true });
      await shared.nth(1).hover();
      await page.mouse.wheel(0, 20);
      await expect
        .poll(
          async () =>
            (await records("layout-shared-pointer")).filter(
              (event) => event.type === "wheel",
            ).length,
        )
        .toBe(1);
      const sharedBox = await shared.nth(1).boundingBox();
      expect(sharedBox).toBeTruthy();
      const wheel = (await records("layout-shared-pointer")).find(
        (event) => event.type === "wheel",
      )!;
      expect(wheel.x).toBeGreaterThanOrEqual(0);
      expect(wheel.x).toBeLessThan(wheel.width);
      await shared.nth(1).click();
      await expect
        .poll(
          async () =>
            (await records("layout-shared-pointer")).filter(
              (event) => event.type === "click",
            ).length,
        )
        .toBe(1);
      expect(
        (await records("layout-shared-pointer"))
          .filter((event) => ["press", "release", "click"].includes(event.type))
          .map((event) => event.type),
      ).toEqual(["press", "release", "click"]);
      const scroll = dialog.locator(".desktop-scroll");
      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight - element.clientHeight;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      const last = dialog.getByText("Clipped layout row 12", { exact: true });
      await last.hover();
      await page.mouse.wheel(0, 20);
      await expect
        .poll(
          async () =>
            (await records("layout-row-12-pointer")).filter(
              (event) => event.type === "wheel",
            ).length,
        )
        .toBe(1);
      const lastWheel = (await records("layout-row-12-pointer")).find(
        (event) => event.type === "wheel",
      )!;
      expect(lastWheel.y).toBeGreaterThanOrEqual(0);
      expect(lastWheel.y).toBeLessThan(lastWheel.height);
      const state = JSON.parse(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "layout-scroll-state"
        ],
      );
      expect(state.top).toBeGreaterThan(0);
      expect(state.viewport).toBeGreaterThan(0);
      expect(
        (await records("layout-root-pointer")).filter(
          (event) => event.type === "wheel",
        ),
      ).toHaveLength(3);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: `.local/screenshots/component-hit-path-${width}.png`,
        animations: "disabled",
      });
    } finally {
      await sdkAction(page, "abort");
    }
  });
}

test("delayed Pi pointer decisions preserve early capture motion and release rejected captures", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await page.route("**/api/action", async (route) => {
    const request = route.request().postDataJSON();
    if (
      request.action !== "desktop.mouse" ||
      request.args.event.type !== "press"
    ) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ response });
  });
  try {
    await verifyComponentPointer(
      page,
      ".local/screenshots/component-pointer-delayed.png",
    );
    await sdkAction(page, "prompt", { message: "/mapped-pointer" });
    const dialog = page.getByRole("dialog");
    const captured = dialog
      .locator(".desktop-region")
      .filter({ hasText: "Captured pointer" });
    const close = dialog.getByRole("button", { name: "确认", exact: true });
    const response = page.waitForResponse(
      (response) =>
        response.request().postDataJSON()?.action === "desktop.mouse" &&
        response.request().postDataJSON()?.args.event.type === "press",
    );
    await captured.click();
    await close.focus();
    await close.press("Shift");
    await response;
    await expect(close).toBeFocused();
  } finally {
    await sdkAction(page, "abort");
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("native component mouse handlers preserve browser selection while Pi replies are delayed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await page.route("**/api/action", async (route) => {
    if (route.request().postDataJSON().action !== "desktop.mouse") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 75));
    await route.fulfill({ response });
  });
  try {
    await verifyNativeComponentPointer(
      page,
      ".local/screenshots/native-pointer-delayed.png",
    );
  } finally {
    await sdkAction(page, "abort");
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("nested native controls, settings and explicit capture retain original mouse behavior with delayed replies", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await page.route("**/api/action", async (route) => {
    if (route.request().postDataJSON().action !== "desktop.mouse") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 75));
    await route.fulfill({ response });
  });
  try {
    await verifyNativeMouseRegions(
      page,
      ".local/screenshots/native-regions-delayed.png",
    );
  } finally {
    await sdkAction(page, "abort");
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("rapid input after changing component focus retains the first character while selection replies settle", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await page.route("**/api/action", async (route) => {
    const request = route.request().postDataJSON();
    if (
      request.action !== "desktop.action" ||
      !request.args.action?.endsWith(":selection") ||
      request.args.value?.text !== ""
    ) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 75));
    await route.fulfill({ response });
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    await sdkAction(page, "session.new");
    await sdkAction(page, "prompt", { message: "/mapped-form" });
    const dialog = page.getByRole("dialog");
    const name = dialog.getByRole("textbox", { name: "Name", exact: true });
    await name.fill(`Focus ${attempt}`);
    await name.press("Enter");
    await expect(
      dialog.getByText(`Input submitted: Focus ${attempt}`, { exact: true }),
    ).toBeVisible();
    const editor = dialog.getByRole("textbox", {
      name: "编辑内容",
      exact: true,
    });
    await editor.pressSequentially("Original editor");
    await expect(editor).toHaveValue("Original editor");
    await sdkAction(page, "abort");
    await expect(dialog).toBeHidden();
  }
});

test("delayed action snapshots cannot replace a newer component view", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  let delayed = false;
  await page.route("**/api/action", async (route) => {
    const request = route.request().postDataJSON();
    if (
      request.action !== "prompt" ||
      request.args.message !== "/mapped-form"
    ) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await expect(
      page.getByRole("dialog").getByText("Original factory", { exact: true }),
    ).toBeVisible();
    delayed = true;
    await route.fulfill({ response });
  });
  const response = page.waitForResponse(
    (response) => response.request().postDataJSON()?.action === "prompt",
  );
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("/mapped-form");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await response;
  expect(delayed).toBe(true);
  await expect(
    page.getByRole("dialog").getByText("Original factory", { exact: true }),
  ).toBeVisible();
  await sdkAction(page, "abort");
});

for (const viewport of [
  { width: 1440, height: 940 },
  { width: 390, height: 844 },
]) {
  test(`standard Pi components render as desktop controls at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/");
    try {
      await verifyComponentMapping(
        page,
        `.local/screenshots/component-library-${viewport.width}.png`,
      );
      expect(errors).toEqual([]);
    } finally {
      await sdkAction(page, "abort");
    }
  });
}
