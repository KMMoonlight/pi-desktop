import { expect, type Page } from "@playwright/test";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function sdkAction<T>(
  page: Page,
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return page.evaluate(
    async ({ action, args }) => {
      const native = (
        window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke: (name: string, args: unknown) => Promise<T>;
          };
        }
      ).__TAURI_INTERNALS__;
      if (native) return native.invoke("sdk_action", { action, args });
      const { token } = await (await fetch("/api/token")).json();
      const result = await (
        await fetch("/api/action", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-desktop-token": token,
          },
          body: JSON.stringify({ action, args }),
        })
      ).json();
      if (typeof result.error === "string") throw new Error(result.error);
      return result.data;
    },
    { action, args },
  );
}

export async function verifyDefaultEditor(page: Page, screenshot: string) {
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  await expect(composer).toHaveValue("");
  await composer.fill("Default draft");
  await expect(send).toBeEnabled();
  await composer.press("Control+c");
  await composer.pressSequentially("Ordered clear");
  await expect(composer).toHaveValue("Ordered clear");
  await composer.press("Control+l");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "选择模型", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "desktop-test/desktop-test", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await composer.press("Control+t");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).settings
          .hideThinkingBlock,
    )
    .toBe(true);
  await composer.press("Control+t");
  await sdkAction(page, "sdk.run", {
    path: `${initial.agentDir}/desktop/clipboard-fixture.mjs`,
    args: { text: "Clipboard draft" },
  });
  await composer.selectText();
  await composer.press("Alt+v");
  await expect(composer).toHaveValue("Clipboard draft");
  const image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/ACiqeP8EkgJKJCPrYwAAAABJRU5ErkJggg==";
  await sdkAction(page, "sdk.run", {
    path: `${initial.agentDir}/desktop/clipboard-fixture.mjs`,
    args: { image },
  });
  await composer.press("Alt+v");
  await expect(
    page.getByRole("img", { name: "Clipboard image", exact: true }),
  ).toBeVisible();
  await expect(send).toBeEnabled();
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await composer.fill("Default controls prompt");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect
    .poll(
      async () => !(await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
    )
    .toBe(true);
  const completed = await sdkAction<DesktopSnapshot>(page, "snapshot");
  expect(
    completed.messages.some(
      (message) =>
        message.role === "user" &&
        message.content.some(
          (block) => block.type === "image" && block.data === image,
        ),
    ),
  ).toBe(true);
  await sdkAction(page, "sdk.run", {
    path: `${initial.agentDir}/desktop/editor-action.mjs`,
    args: {
      action: "bindings",
      bindings: {
        "tui.editor.historyPrevious": "ctrl+p",
        "tui.editor.historyNext": "ctrl+n",
      },
    },
  });
  const reloaded = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const editor = reloaded.desktopSurfaces.find(
    (surface) => surface.slot === "editor",
  );
  if (!editor) throw new Error("Reloaded default editor is unavailable");
  await expect(page.locator('[data-surface-id="editor"]')).toHaveAttribute(
    "data-instance-id",
    editor.instanceId,
  );
  await composer.fill("Unfinished draft");
  await composer.press("Control+p");
  await expect(composer).toHaveValue("Default controls prompt");
  await composer.press("Control+n");
  await expect(composer).toHaveValue("Unfinished draft");
  await composer.fill("slow-response");
  await composer.press("Enter");
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(true);
  await composer.fill("Queued follow-up");
  await composer.press("Control+q");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).queue.followUp,
    )
    .toEqual(["Queued follow-up"]);
  await expect(composer).toHaveValue("");
  await composer.fill("Current draft");
  await composer.press("Alt+q");
  await expect(composer).toHaveValue("Queued follow-up\n\nCurrent draft");
  await composer.press("Escape");
  await expect
    .poll(
      async () => !(await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
    )
    .toBe(true);
  await expect(composer).toHaveValue("Queued follow-up\n\nCurrent draft");
  const saved = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await sdkAction(page, "session.new");
  await expect(composer).toHaveValue("");
  await sdkAction(page, "session.switch", { path: saved.sessionFile });
  await expect(composer).toHaveValue("Queued follow-up\n\nCurrent draft");
  await sdkAction(page, "sdk.run", {
    path: `${initial.agentDir}/desktop/editor-action.mjs`,
    args: { action: "bindings", bindings: {} },
  });
}

export async function verifyModalEditor(page: Page, screenshot: string) {
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  await sdkAction(page, "sdk.run", {
    path: `${initial.agentDir}/desktop/enable-modal-editor.mjs`,
  });
  await expect(page.getByText("INSERT", { exact: true })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  const configureBindings = async (bindings: Record<string, string>) => {
    await sdkAction(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/editor-action.mjs`,
      args: { action: "bindings", bindings },
    });
    let instanceId = "";
    await expect
      .poll(async () => {
        const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
        const surface = snapshot.desktopSurfaces.find(
          (surface) => surface.slot === "editor",
        );
        if (surface?.view.kind !== "column") return undefined;
        const control = surface.view.children.find(
          (node) => node.kind === "textarea",
        );
        instanceId = surface.instanceId;
        return control?.kind === "textarea"
          ? control.completionKeys?.confirm
          : undefined;
      })
      .toEqual([bindings["tui.select.confirm"] ?? "enter"]);
    await expect
      .poll(() =>
        composer.evaluate(
          (control) =>
            control.closest<HTMLElement>("[data-surface-id]")?.dataset
              .instanceId,
        ),
      )
      .toBe(instanceId);
  };
  await configureBindings({});
  const operation = (action: string, text?: string) =>
    sdkAction(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/editor-action.mjs`,
      args: { action, text },
    });
  await composer.fill("abcdef");
  await expect(send).toBeEnabled();
  await composer.press("Escape");
  await expect(page.getByText("NORMAL", { exact: true })).toBeVisible();
  await composer.press("h");
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(5);
  await composer.press("x");
  await expect(composer).toHaveValue("abcde");
  await composer.press("q");
  await expect(composer).toHaveValue("abcde");
  await composer.press("0");
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(0);
  await composer.press("a");
  await expect(page.getByText("INSERT", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(1);
  await composer.pressSequentially("Z");
  await expect(composer).toHaveValue("aZbcde");
  await composer.selectText();
  await expect
    .poll(async () => {
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      const view = snapshot.desktopSurfaces.find(
        (surface) => surface.slot === "editor",
      )?.view;
      const control =
        view?.kind === "column"
          ? view.children.find((node) => node.kind === "textarea")
          : undefined;
      return control?.kind === "textarea" ? control.selection : undefined;
    })
    .toMatchObject({ start: 0, end: 6 });
  await operation("paste", "Native paste");
  await expect(composer).toHaveValue("Native paste");
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(12);
  await composer.press("Shift+Enter");
  await composer.pressSequentially("Second line");
  await expect(composer).toHaveValue("Native paste\nSecond line");
  await composer.press("Escape");
  await composer.press("0");
  await composer.press("k");
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(0);
  await composer.press("j");
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(13);
  await composer.press("i");
  await composer.fill("/desktop-nat");
  await expect(
    page.getByRole("option", { name: /desktop-native-form/ }),
  ).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toHaveValue("/desktop-native-form ");
  await expect(page.getByRole("dialog")).toBeHidden();
  await configureBindings({
    "tui.select.confirm": "alt+enter",
    "tui.input.tab": "alt+.",
    "tui.select.cancel": "alt+escape",
  });
  await composer.fill("/desktop-nat");
  await expect(
    page.getByRole("option", { name: /desktop-native-form/ }),
  ).toBeVisible();
  await composer.press("Alt+Escape");
  await expect(page.getByRole("listbox", { name: "补全建议" })).toBeHidden();
  await composer.press("Alt+.");
  await expect(
    page.getByRole("option", { name: /desktop-native-form/ }),
  ).toBeVisible();
  await composer.press("Alt+Enter");
  await expect(composer).toHaveValue("/desktop-native-form ");
  await expect(page.getByRole("dialog")).toBeHidden();
  await configureBindings({});
  await composer.fill("abcdef");
  await composer.press("Home");
  await composer.press("Control+d");
  await expect(composer).toHaveValue("bcdef");
  await composer.press("Control+c");
  await expect(composer).toHaveValue("");
  await composer.pressSequentially("Undo this");
  await expect(composer).toHaveValue("Undo this");
  await composer.press("Control+z");
  await expect(composer).not.toHaveValue("Undo this");
  await composer.fill("one two three");
  await composer.press("Control+w");
  await expect(composer).toHaveValue("one two ");
  await composer.press("Control+w");
  await expect(composer).toHaveValue("one ");
  await composer.press("Control+y");
  await expect(composer).toHaveValue("one two three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one ");
  await composer.fill("a\u4e2db\n\u4e2dc");
  await expect(composer).toHaveValue("a\u4e2db\n\u4e2dc");
  await composer.evaluate((control: HTMLTextAreaElement) =>
    control.setSelectionRange(0, 0),
  );
  await composer.press("Control+]");
  await composer.pressSequentially("\u4e2d");
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(1);
  await composer.press("Control+]");
  await composer.pressSequentially("\u4e2d");
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(4);
  await expect(composer).toHaveValue("a\u4e2db\n\u4e2dc");
  await composer.fill("External draft");
  await composer.press("Control+g");
  await expect(composer).toHaveValue("External draft\nExternal editor result");
  await composer.fill("beforeinput:");
  await expect(composer).toHaveValue("beforeinput:");
  await composer.evaluate((control: HTMLTextAreaElement) => {
    control.dispatchEvent(
      new InputEvent("beforeinput", {
        data: "desk",
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(composer).toHaveValue("beforeinput:desk");
  await composer.selectText();
  await composer.evaluate((control: HTMLTextAreaElement) => {
    const data = new DataTransfer();
    data.setData("text/plain", "Clipboard replacement");
    control.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(composer).toHaveValue("Clipboard replacement");
  await composer.selectText();
  await composer.evaluate((control: HTMLTextAreaElement) => {
    control.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(control, "\u4e2d\u6587");
    control.setSelectionRange(2, 2);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(
      new CompositionEvent("compositionend", {
        data: "\u4e2d\u6587",
        bubbles: true,
      }),
    );
  });
  await expect(composer).toHaveValue("\u4e2d\u6587");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await composer.fill("Native editor submission");
  await composer.press("Enter");
  await expect(
    page.locator("main p").filter({ hasText: /^Native editor submission$/ }),
  ).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect
    .poll(
      async () => !(await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
    )
    .toBe(true);
  await composer.press("ArrowUp");
  await expect(composer).toHaveValue("Native editor submission");
  await composer.press("ArrowDown");
  await expect(composer).toHaveValue("");
  await composer.fill("slow-response");
  await composer.press("Enter");
  await expect
    .poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).busy)
    .toBe(true);
  await composer.press("Escape");
  await expect(page.getByText("NORMAL", { exact: true })).toBeVisible();
  await composer.press("Escape");
  await expect
    .poll(
      async () => !(await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
    )
    .toBe(true);
  await operation("text", "Restore this draft");
  await expect(composer).toHaveValue("Restore this draft");
  await operation("restore");
  await expect(
    page.locator(
      '[data-surface-id="editor"] [data-desktop-action^="component:"]',
    ),
  ).toBeVisible();
  await expect(composer).toHaveValue("Restore this draft");
  await expect(page.getByText("INSERT", { exact: true })).toBeHidden();
  await composer.selectText();
  await operation("paste", "Default selection paste");
  await expect(composer).toHaveValue("Default selection paste");
  await composer.evaluate((control: HTMLTextAreaElement) =>
    control.setSelectionRange(0, 0),
  );
  await operation("paste", "");
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(0);
  await sdkAction(page, "sdk.run", {
    path: `${initial.agentDir}/desktop/disable-modal-editor.mjs`,
  });
}
