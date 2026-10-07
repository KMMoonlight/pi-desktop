import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyContainerRender(
  page: Page,
  kind: string,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/container-render-probe ${kind}`,
  });
  try {
    const dialog = page.getByRole("dialog");
    const retained = dialog.getByRole("textbox", {
      name: "Retained field",
      exact: true,
    });
    const omitted = dialog.getByRole("textbox", {
      name: "Omitted field",
      exact: true,
    });
    const controller = dialog.getByRole("textbox", {
      name: "Controller field",
      exact: true,
    });
    await expect(retained).toHaveValue("Original value");
    await retained.evaluate((element) =>
      Reflect.set(window, "containerRetained", element),
    );
    await retained.click();
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
            "container-render-clicks"
          ],
      )
      .toBe("1");
    await retained.fill("Retained desktop value");
    await retained.press("Enter");
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
            "container-render-submit"
          ],
      )
      .toBe("Retained desktop value");
    await controller.fill("Controller result");
    for (const mode of ["insert", "omit", "partial", "reorder", "replace"]) {
      await controller.press("F2");
      await expect
        .poll(
          async () =>
            (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
              "container-render-mode"
            ],
        )
        .toBe(mode);
      await expect(controller).toBeFocused();
      if (mode === "replace") {
        await expect(retained).toHaveCount(0);
        await expect(omitted).toHaveCount(0);
        await expect(
          dialog.getByText("Original first", { exact: true }),
        ).toHaveCount(0);
        await expect(
          dialog.getByText("Replacement", { exact: true }),
        ).toHaveCSS("color", "rgb(11, 122, 99)");
        await expect(dialog.getByText("Continued", { exact: true })).toHaveCSS(
          "color",
          "rgb(11, 122, 99)",
        );
        const replacement = dialog.locator(
          '[data-render-additions="replacement"]',
        );
        expect(
          await replacement.evaluate((element) => element.children.length),
        ).toBe(4);
        await controller.press("F3");
      } else {
        await expect(retained).toHaveValue("Retained desktop value");
        expect(
          await retained.evaluate(
            (element) => Reflect.get(window, "containerRetained") === element,
          ),
        ).toBe(true);
        await expect(omitted).toHaveCount(mode === "omit" ? 0 : 1);
        if (mode === "insert") {
          const middle = dialog.getByText("Inserted middle", { exact: true });
          await expect(middle).toHaveCSS("color", "rgb(11, 122, 99)");
          const positions = await Promise.all(
            [middle, retained, omitted].map((item) => item.boundingBox()),
          );
          expect(positions[0]!.y).toBeLessThan(positions[1]!.y);
          expect(positions[1]!.y).toBeLessThan(positions[2]!.y);
        }
        if (mode === "partial") {
          await expect(
            dialog.getByText("Original removed", { exact: true }),
          ).toHaveCount(0);
          await expect(
            dialog.getByText("Original last", { exact: true }),
          ).toHaveCount(1);
        }
        if (mode === "reorder") {
          const positions = await Promise.all(
            [
              omitted,
              dialog.getByText("Moved divider", { exact: true }),
              retained,
            ].map((item) => item.boundingBox()),
          );
          expect(positions[0]!.y).toBeLessThan(positions[1]!.y);
          expect(positions[1]!.y).toBeLessThan(positions[2]!.y);
          await page.screenshot({
            path: screenshot.replace(/\.png$/, "-reorder.png"),
          });
          await retained.click();
          await expect
            .poll(
              async () =>
                (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
                  "container-render-clicks"
                ],
            )
            .toBe("2");
          await retained.press("End");
          await retained.press("!");
          await expect(retained).toHaveValue("Retained desktop value!");
          await controller.focus();
        }
      }
    }
    await page.screenshot({
      path: screenshot.replace(/\.png$/, "-replacement.png"),
    });
    await controller.press("F2");
    await expect(retained).toHaveValue("SDK hidden value");
    await expect(omitted).toHaveValue("SDK other value");
    await expect(controller).toBeFocused();
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    await page.screenshot({ path: screenshot });
    await controller.press("Enter");
    await pending;
    await expect(dialog).toBeHidden();
    const status = (await sdkAction<DesktopSnapshot>(page, "snapshot"))
      .statuses["container-render-result"];
    expect(JSON.parse(status)).toEqual({
      value: "Controller result",
      edited: "Retained desktop value",
      submitted: 1,
      mode: "normal",
      clicks: 2,
      disposed: {
        root: 1,
        container: 1,
        label: 1,
        retained: 1,
        omitted: 1,
        controller: 1,
      },
    });
  } finally {
    await sdkAction(page, "abort").catch(() => {});
    await pending.catch(() => {});
  }
}

export async function verifyRenderBaseline(
  page: Page,
  own: boolean,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: `/render-baseline-probe${own ? " own" : ""}`,
  });
  try {
    const dialog = page.getByRole("dialog");
    const editor = dialog.getByRole("textbox", {
      name: "编辑内容",
      exact: true,
    });
    const controller = dialog.getByRole("textbox", {
      name: "Controller field",
      exact: true,
    });
    await expect(editor).toHaveValue("Original editor value");
    await expect(
      dialog.getByText("Inherited editor label", { exact: true }),
    ).toHaveCSS("color", "rgb(11, 122, 99)");
    await expect(
      dialog.getByText("Original helper footer", { exact: true }),
    ).toHaveCount(1);
    await editor.evaluate((element) =>
      Reflect.set(window, "baselineEditor", element),
    );
    await editor.fill("Retained desktop editor");
    await editor.press("Enter");
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
            "render-baseline-submit"
          ],
      )
      .toBe("Retained desktop editor");
    await expect(editor).toHaveValue("");
    await editor.fill("Retained desktop editor");
    await controller.fill("Retained controller");
    for (const mode of [1, 0, 1]) {
      await controller.press("F2");
      await expect(
        dialog.getByText(`${mode ? "Updated" : "Inherited"} editor label`, {
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(
        dialog.getByText(`Markdown cache note ${mode}`, { exact: true }),
      ).toHaveCount(1);
      await expect(
        dialog.getByText(`Box cache note ${mode}`, { exact: true }),
      ).toHaveCount(1);
      await expect(
        dialog.getByText(`Markdown cache note ${1 - mode}`, { exact: true }),
      ).toHaveCount(0);
      await expect(
        dialog.getByText(`Box cache note ${1 - mode}`, { exact: true }),
      ).toHaveCount(0);
      await expect(controller).toBeFocused();
      await expect(editor).toHaveValue("Retained desktop editor");
      expect(
        await editor.evaluate(
          (element) => Reflect.get(window, "baselineEditor") === element,
        ),
      ).toBe(true);
    }
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    expect(
      await dialog
        .locator("[data-render-additions]")
        .evaluateAll((elements) =>
          elements.every(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ),
    ).toBe(true);
    await page.screenshot({ path: screenshot });
    await controller.press("Enter");
    await pending;
    await expect(dialog).toBeHidden();
    const status = (await sdkAction<DesktopSnapshot>(page, "snapshot"))
      .statuses["render-baseline-result"];
    expect(JSON.parse(status)).toEqual({
      value: "Retained controller",
      edited: "Retained desktop editor",
      submitted: 1,
      mode: 1,
      inherited: true,
      disposed: { root: 1, box: 1, markdown: 1, editor: 1, controller: 1 },
    });
  } finally {
    await sdkAction(page, "abort").catch(() => {});
    await pending.catch(() => {});
  }
}

export async function verifyEmptyRender(page: Page, screenshot: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", { message: "/empty-render-probe" });
  try {
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("textbox", {
      name: "Nested field",
      exact: true,
    });
    const controller = dialog.getByRole("textbox", {
      name: "Controller field",
      exact: true,
    });
    const label = dialog.getByText("Original branch content", { exact: true });
    await input.fill("Original value");
    await controller.fill("Controller result");
    await controller.evaluate((element) => {
      (
        window as unknown as { emptyRenderController: Element }
      ).emptyRenderController = element;
    });
    await controller.press("F2");
    await expect(input).toHaveCount(0);
    await expect(label).toBeVisible();
    await expect(controller).toBeFocused();
    await controller.press("F4");
    const value = async () =>
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
        "empty-render-value"
      ];
    await expect.poll(value).toBe("Original value!");
    await controller.press("F3");
    await expect(label).toHaveCount(0);
    await expect(input).toHaveCount(0);
    await expect(controller).toBeFocused();
    await controller.press("F5");
    await expect.poll(value).toBe("SDK hidden value");
    await controller.press("F4");
    await expect.poll(value).toBe("SDK hidden value!");
    await page.screenshot({
      path: screenshot.replace(/\.png$/, "-hidden.png"),
    });
    await controller.press("F3");
    await expect(label).toBeVisible();
    await expect(input).toHaveCount(0);
    await controller.press("F2");
    await expect(input).toHaveValue("SDK hidden value!");
    await expect(controller).toBeFocused();
    expect(
      await controller.evaluate(
        (element) =>
          (window as unknown as { emptyRenderController: Element })
            .emptyRenderController === element,
      ),
    ).toBe(true);
    await expect(controller).toHaveValue("Controller result");
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    await page.screenshot({ path: screenshot });
    await input.press("Enter");
    await pending;
    await expect(dialog).toBeHidden();
    const status = (await sdkAction<DesktopSnapshot>(page, "snapshot"))
      .statuses["empty-render-result"];
    expect(JSON.parse(status)).toEqual({
      value: "SDK hidden value!",
      controller: "Controller result",
      submitted: 1,
      disposed: { root: 1, box: 1, label: 1, input: 1, controller: 1 },
    });
  } finally {
    await sdkAction(page, "abort").catch(() => {});
    await pending.catch(() => {});
  }
}

export async function verifyPassiveRenderReplacement(
  page: Page,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: "/passive-render-probe",
  });
  try {
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("textbox", {
      name: "Retained field",
      exact: true,
    });
    const replacements = dialog.locator(
      '[data-render-additions="replacement"]',
    );
    const kinds = ["Text", "TruncatedText", "Spacer", "DynamicBorder"];
    await expect(replacements).toHaveCount(4);
    for (const kind of kinds) {
      await expect(
        dialog.getByText(`Changed ${kind} label`, { exact: true }),
      ).toHaveCSS("color", "rgb(11, 122, 99)");
      const link = dialog.getByRole("link", {
        name: `Continuation ${kind}`,
        exact: true,
      });
      await expect(link).toHaveCSS("color", "rgb(11, 122, 99)");
      await expect(link).toHaveAttribute(
        "href",
        "https://example.com/pi-render",
      );
      await expect(
        dialog.getByText(`Original ${kind}`, { exact: true }),
      ).toHaveCount(0);
    }
    expect(
      await replacements.evaluateAll((elements) =>
        elements.every(
          (element) =>
            element.children.length === 4 &&
            Array.from(element.children).every(
              (line) => line.getBoundingClientRect().height >= 17,
            ) &&
            element.scrollWidth <= element.clientWidth + 1,
        ),
      ),
    ).toBe(true);
    await expect(dialog.locator(".xterm")).toHaveCount(0);
    await input.evaluate((element) => {
      (
        window as unknown as { passiveRenderInput: Element }
      ).passiveRenderInput = element;
    });
    await input.fill("Preserved desktop result");
    await dialog.getByText("Changed Text label", { exact: true }).click();
    await expect
      .poll(
        async () =>
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
            "passive-render-clicks"
          ],
      )
      .toBe("1");
    await input.focus();
    await input.press("F2");
    await expect(replacements).toHaveCount(0);
    await expect(dialog.locator(".desktop-text")).toHaveCount(0);
    await expect(dialog.locator(".desktop-divider")).toHaveCount(0);
    await expect(input).toBeFocused();
    await input.press("F2");
    await expect(
      dialog.getByText("Original Text", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Original TruncatedText", { exact: true }),
    ).toBeVisible();
    await expect(dialog.locator(".desktop-divider")).toHaveCount(1);
    await expect(input).toBeFocused();
    await input.press("F2");
    await expect(replacements).toHaveCount(4);
    expect(
      await input.evaluate(
        (element) =>
          (window as unknown as { passiveRenderInput: Element })
            .passiveRenderInput === element,
      ),
    ).toBe(true);
    await expect(input).toHaveValue("Preserved desktop result");
    await expect(input).toBeFocused();
    await page.screenshot({ path: screenshot });
    await input.press("Enter");
    await pending;
    await expect(dialog).toBeHidden();
    const status = (await sdkAction<DesktopSnapshot>(page, "snapshot"))
      .statuses["passive-render-result"];
    expect(JSON.parse(status)).toEqual({
      value: "Preserved desktop result",
      clicks: 1,
      mode: 0,
      disposed: {
        root: 1,
        input: 1,
        Text: 1,
        TruncatedText: 1,
        Spacer: 1,
        DynamicBorder: 1,
      },
    });
  } finally {
    await sdkAction(page, "abort").catch(() => {});
    await pending.catch(() => {});
  }
}

export async function verifyStandardRenderAdditions(
  page: Page,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: "/standard-render-probe",
  });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", {
    name: "Original field",
    exact: true,
  });
  const select = dialog.getByRole("combobox", { name: "选择", exact: true });
  const headings = [
    "Container heading",
    "Box heading",
    "Text heading",
    "Generic list heading",
  ];
  for (const heading of headings)
    await expect(dialog.getByText(heading, { exact: true })).toHaveCount(1);
  await expect(
    dialog.getByText("Generic list heading", { exact: true }),
  ).toHaveCSS("color", "rgb(11, 122, 99)");
  await expect(
    dialog.getByText("Original component text", { exact: true }),
  ).toHaveCount(1);
  await expect(dialog.locator(".xterm")).toHaveCount(0);
  await input.evaluate((element) => {
    (
      window as unknown as { standardRenderInput: Element }
    ).standardRenderInput = element;
  });
  await input.fill("Original desktop result");
  await input.press("F2");
  for (const heading of headings)
    await expect(dialog.getByText(heading, { exact: true })).toHaveCount(0);
  await expect(input).toBeFocused();
  await input.press("F2");
  for (const heading of headings)
    await expect(dialog.getByText(heading, { exact: true })).toHaveCount(1);
  expect(
    await input.evaluate(
      (element) =>
        (window as unknown as { standardRenderInput: Element })
          .standardRenderInput === element,
    ),
  ).toBe(true);
  await expect(input).toHaveValue("Original desktop result");
  await select.selectOption("second");
  await expect(
    dialog.getByText("List footer: second", { exact: true }),
  ).toHaveCount(1);
  await expect(
    dialog.getByText("Container footer: second", { exact: true }),
  ).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "standard-render-change"
        ],
    )
    .toBe("second:1");
  expect(
    await dialog
      .locator("[data-render-additions]")
      .evaluateAll((elements) =>
        elements.every(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ),
  ).toBe(true);
  await page.screenshot({ path: screenshot });
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await pending;
  await expect(dialog).toBeHidden();
  const status = (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
    "standard-render-result"
  ];
  expect(JSON.parse(status)).toEqual({
    value: "Original desktop result",
    selected: "second",
    changes: 1,
    disposed: { root: 1, box: 1, text: 1, input: 1, list: 1 },
  });
}

export async function verifyRenderAdditions(page: Page, screenshot: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const pending = sdkAction(page, "prompt", {
    message: "/render-additions-probe",
  });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", {
    name: "Rendered input",
    exact: true,
  });
  await expect(input).toBeVisible();
  await expect(
    dialog.getByText("Rendered input heading", { exact: true }),
  ).toHaveCSS("color", "rgb(11, 122, 99)");
  const same = await input.evaluate((node) => {
    (window as unknown as { renderInput: Element }).renderInput = node;
    return true;
  });
  expect(same).toBe(true);
  await input.fill("Original result");
  await expect(
    dialog.getByText("Rendered input footer: Original result", { exact: true }),
  ).toBeVisible();
  await input.press("F2");
  await expect(
    dialog.getByText("Rendered input heading", { exact: true }),
  ).toHaveCount(0);
  await input.press("F2");
  await expect(
    dialog.getByText("Rendered input heading", { exact: true }),
  ).toBeVisible();
  expect(
    await input.evaluate(
      (node) =>
        (window as unknown as { renderInput: Element }).renderInput === node,
    ),
  ).toBe(true);
  await expect(input).toBeFocused();
  await expect(dialog.locator(".xterm")).toHaveCount(0);
  const layout = await dialog
    .locator("[data-render-additions]")
    .evaluateAll((rows) =>
      rows.every((row) => row.scrollWidth <= row.clientWidth + 1),
    );
  expect(layout).toBe(true);
  await page.screenshot({ path: screenshot });
  await input.press("Enter");
  await pending;
  await expect(dialog).toBeHidden();
  expect(
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
      "render-additions-result"
    ],
  ).toBe("Original result");

  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await sdkAction(page, "sdk.run", {
    path: `${initial.agentDir}/desktop/enable-modal-editor.mjs`,
  });
  const editor = page.locator('[data-surface-id="editor"]');
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor.getByText("INSERT", { exact: true })).toBeVisible();
  await composer.fill("abcdef");
  await composer.press("Escape");
  await expect(editor.getByText("NORMAL", { exact: true })).toBeVisible();
  await composer.press("h");
  await composer.press("x");
  await expect(composer).toHaveValue("abcde");
  await composer.press("i");
  await expect(editor.getByText("INSERT", { exact: true })).toBeVisible();
  await expect(editor.locator(".xterm")).toHaveCount(0);
  await page.screenshot({ path: screenshot.replace(".png", "-modal.png") });
  await sdkAction(page, "sdk.run", {
    path: `${initial.agentDir}/desktop/disable-modal-editor.mjs`,
  });
}
