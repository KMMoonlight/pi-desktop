import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

export async function verifyComponentWindow(page: Page) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  const native = await page.evaluate(() => {
    const target = window as unknown as {
      fetch: typeof fetch;
      windowEffectsFetch?: typeof fetch;
      __TAURI_INTERNALS__?: {
        invoke: (command: string, args?: unknown) => Promise<unknown>;
      };
      windowEffects?: {
        command: string;
        value: { status?: string } | string;
      }[];
    };
    if (!target.__TAURI_INTERNALS__) return false;
    target.windowEffects = [];
    target.windowEffectsFetch = target.fetch;
    const original = target.fetch.bind(window);
    target.fetch = async (input, options) => {
      const result = await original(input, options);
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const command = decodeURIComponent(
        new URL(url, location.href).pathname.slice(1),
      );
      if (
        ["plugin:window|set_title", "plugin:window|set_progress_bar"].includes(
          command,
        ) &&
        result.headers.get("Tauri-Response") === "ok"
      )
        target.windowEffects!.push({
          command,
          value: JSON.parse(String(options?.body)).value,
        });
      return result;
    };
    return true;
  });
  const state = async () =>
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).extensionUI;
  const idle = () =>
    expect
      .poll(async () => {
        const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
        return { busy: snapshot.busy, changing: snapshot.changing };
      })
      .toEqual({ busy: false, changing: false });
  const nativeProgress = async () =>
    page.evaluate(() => {
      const events = (
        window as unknown as {
          windowEffects: { command: string; value: { status?: string } }[];
        }
      ).windowEffects;
      return events
        .filter((event) => event.command === "plugin:window|set_progress_bar")
        .at(-1)?.value.status;
    });
  const nativeTitle = async () =>
    page.evaluate(() =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__.invoke("plugin:window|title", { label: "main" }),
    );
  await idle();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/mapped-window" });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", {
    name: "Window title",
    exact: true,
  });
  await expect(input).toBeVisible();
  await expect(page).toHaveTitle("Mapped component window");
  await expect.poll(async () => (await state()).windowProgress).toBe(true);
  if (native) {
    await expect.poll(nativeTitle).toBe("Mapped component window");
    await expect.poll(nativeProgress).toBe("indeterminate");
  }
  await input.fill("Original component title");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveTitle("Original component title");
  expect((await state()).windowProgress).toBe(false);
  await idle();
  await sdkAction(page, "prompt", { message: "/mapped-window-clear" });
  await expect(page).toHaveTitle("SDK window title");
  await expect.poll(async () => (await state()).windowProgress).toBe(false);
  if (native) {
    await expect.poll(nativeTitle).toBe("SDK window title");
    await expect.poll(nativeProgress).toBe("none");
  }
  await idle();
  await sdkAction(page, "prompt", { message: "/mapped-window fail" });
  await expect(
    page.getByRole("alert").filter({ hasText: "Window fixture failure" }),
  ).toBeVisible();
  expect((await state()).windowProgress).toBe(true);
  await idle();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/mapped-window" });
  await expect(input).toBeVisible();
  await sdkAction(page, "abort");
  await expect(dialog).toBeHidden();
  expect((await state()).windowProgress).toBe(false);
  await idle();
  await sdkAction(page, "session.new");
  await expect.poll(async () => (await state()).windowProgress).toBe(false);
  if (native) await expect.poll(nativeProgress).toBe("none");
  if (native)
    await page.evaluate(() => {
      const target = window as unknown as {
        fetch: typeof fetch;
        windowEffectsFetch?: typeof fetch;
      };
      target.fetch = target.windowEffectsFetch!;
      delete target.windowEffectsFetch;
    });
}

export async function verifyMappedComposition(page: Page, screenshot: string) {
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const operation = (action: string, text?: string) =>
    sdkAction<string>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/editor-action.mjs`,
      args: { action, text },
    });
  await sdkAction(page, "prompt", { message: "/mapped-editor" });
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toHaveAttribute("data-desktop-action", /^component:/);
  const compose = async (
    control: import("@playwright/test").Locator,
    text: string,
    start: number,
    end: number,
    options: {
      commitBeforeEnd?: boolean;
      omitFinalInput?: boolean;
      nextText?: string;
      nextPending?: boolean;
      nextInput?: string;
      nextPaste?: string;
    } = {},
  ) => {
    await control.focus();
    await control.evaluate(
      (control: HTMLTextAreaElement | HTMLInputElement, args) => {
        control.setSelectionRange(args.start, args.end);
        control.dispatchEvent(new Event("select", { bubbles: true }));
        const before = control.value;
        control.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        );
        const setter = Object.getOwnPropertyDescriptor(
          control instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(
          control,
          before.slice(0, args.start) + "n" + before.slice(args.end),
        );
        control.dispatchEvent(
          new InputEvent("input", {
            data: "n",
            inputType: "insertCompositionText",
            isComposing: true,
            bubbles: true,
          }),
        );
        setter.call(
          control,
          before.slice(0, args.start) + args.text + before.slice(args.end),
        );
        control.setSelectionRange(
          args.start + args.text.length,
          args.start + args.text.length,
        );
        control.dispatchEvent(
          new InputEvent("input", {
            data: args.text,
            inputType: "insertCompositionText",
            isComposing: true,
            bubbles: true,
          }),
        );
        if (args.commitBeforeEnd)
          control.dispatchEvent(
            new InputEvent("input", {
              data: args.text,
              inputType: "insertText",
              bubbles: true,
            }),
          );
        control.dispatchEvent(
          new CompositionEvent("compositionend", {
            data: args.text,
            bubbles: true,
          }),
        );
        if (!args.commitBeforeEnd && !args.omitFinalInput) {
          control.dispatchEvent(
            new InputEvent("beforeinput", {
              data: args.text,
              inputType: "insertText",
              bubbles: true,
              cancelable: true,
            }),
          );
          control.dispatchEvent(
            new InputEvent("input", {
              data: args.text,
              inputType: "insertText",
              bubbles: true,
            }),
          );
        }
        if (args.nextText !== undefined) {
          const position = args.start + args.text.length;
          control.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true }),
          );
          const next = control.value;
          setter.call(
            control,
            next.slice(0, position) + args.nextText + next.slice(position),
          );
          control.setSelectionRange(
            position + args.nextText.length,
            position + args.nextText.length,
          );
          control.dispatchEvent(
            new InputEvent("input", {
              data: args.nextText,
              inputType: "insertCompositionText",
              isComposing: true,
              bubbles: true,
            }),
          );
          if (!args.nextPending) {
            control.dispatchEvent(
              new CompositionEvent("compositionend", {
                data: args.nextText,
                bubbles: true,
              }),
            );
            control.dispatchEvent(
              new InputEvent("input", {
                data: args.nextText,
                inputType: "insertText",
                bubbles: true,
              }),
            );
          }
        }
        for (const text of args.nextInput ?? "") {
          if (
            control.dispatchEvent(
              new InputEvent("beforeinput", {
                data: text,
                inputType: "insertText",
                bubbles: true,
                cancelable: true,
              }),
            )
          ) {
            const start = control.selectionStart ?? 0;
            const end = control.selectionEnd ?? start;
            setter.call(
              control,
              control.value.slice(0, start) + text + control.value.slice(end),
            );
            control.setSelectionRange(start + text.length, start + text.length);
            control.dispatchEvent(
              new InputEvent("input", {
                data: text,
                inputType: "insertText",
                bubbles: true,
              }),
            );
          }
        }
        if (args.nextPaste !== undefined) {
          const clipboardData = new DataTransfer();
          clipboardData.setData("text/plain", args.nextPaste);
          control.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      },
      { text, start, end, ...options },
    );
  };
  await operation("text", "one two three");
  await expect(composer).toHaveValue("one two three");
  await compose(composer, "\u4e2d\u6587", 4, 7);
  await expect(composer).toHaveValue("one \u4e2d\u6587 three");
  await expect.poll(() => operation("read")).toBe("one \u4e2d\u6587 three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await compose(composer, "!", 4, 7, {
    omitFinalInput: true,
    nextInput: "!",
  });
  await expect.poll(() => operation("read")).toBe("one mappedmapped three");
  await expect(composer).toHaveValue("one mappedmapped three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await compose(composer, "\u4e2d\u6587", 4, 7, { commitBeforeEnd: true });
  await expect.poll(() => operation("read")).toBe("one \u4e2d\u6587 three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await compose(composer, "!", 4, 7);
  await expect(composer).toHaveValue("one mapped three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await compose(composer, "", 4, 7);
  await expect(composer).toHaveValue("one two three");
  await expect.poll(() => operation("read")).toBe("one two three");
  const records = () =>
    sdkAction<string[]>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/editor-action.mjs`,
      args: { action: "compositionRecords" },
    });
  await operation("compositionHook", "replace");
  await compose(composer, "\u4e2d\u6587", 4, 7);
  await expect.poll(() => operation("read")).toBe("one transformed three");
  expect(await records()).toEqual(["\u4e2d\u6587"]);
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await operation("compositionHook", "consume");
  await compose(composer, "\u4e2d\u6587", 4, 7);
  await expect(composer).toHaveValue("one two three");
  await expect.poll(() => records()).toEqual(["\u4e2d\u6587"]);
  await expect.poll(() => operation("read")).toBe("one two three");
  await operation("compositionHook");
  await compose(composer, "!", 4, 7, { nextText: "\u5b57" });
  await expect.poll(() => operation("read")).toBe("one mapped\u5b57 three");
  await expect(composer).toHaveValue("one mapped\u5b57 three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await compose(composer, "!", 4, 7, {
    nextText: "\u5b57",
    nextPending: true,
  });
  await expect.poll(() => operation("read")).toBe("one mapped three");
  await expect(composer).toHaveValue("one !\u5b57 three");
  await expect(composer).toHaveAttribute("data-pi-composing", "true");
  await composer.evaluate((control) => {
    control.dispatchEvent(
      new CompositionEvent("compositionend", {
        data: "\u5b57",
        bubbles: true,
      }),
    );
    control.dispatchEvent(
      new InputEvent("input", {
        data: "\u5b57",
        inputType: "insertText",
        bubbles: true,
      }),
    );
  });
  await expect.poll(() => operation("read")).toBe("one mapped\u5b57 three");
  await expect(composer).toHaveValue("one mapped\u5b57 three");
  await expect(composer).not.toHaveAttribute("data-pi-composing", "true");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await compose(composer, "!", 4, 7, { nextText: "" });
  await expect.poll(() => operation("read")).toBe("one mapped three");
  await expect(composer).toHaveValue("one mapped three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await operation("compositionHook", "replace");
  await compose(composer, "\u4e2d\u6587", 4, 7, { nextText: "\u5b57" });
  await expect
    .poll(() => operation("read"))
    .toBe("one transformed\u5b57 three");
  expect(await records()).toEqual(["\u4e2d\u6587", "\u5b57"]);
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await operation("compositionHook", "consume");
  await compose(composer, "\u4e2d\u6587", 4, 7, { nextText: "\u5b57" });
  await expect.poll(() => operation("read")).toBe("one \u5b57 three");
  expect(await records()).toEqual(["\u4e2d\u6587", "\u5b57"]);
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await operation("compositionHook");
  await compose(composer, "!", 4, 7, { nextInput: "QR" });
  await expect.poll(() => operation("read")).toBe("one mappedQR three");
  await expect(composer).toHaveValue("one mappedQR three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await compose(composer, "!", 4, 7, {
    commitBeforeEnd: true,
    nextInput: "QR",
  });
  await expect.poll(() => operation("read")).toBe("one mappedQR three");
  await expect(composer).toHaveValue("one mappedQR three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");
  await compose(composer, "!", 4, 7, { nextPaste: "tail" });
  await expect.poll(() => operation("read")).toBe("one mappedtail three");
  await expect(composer).toHaveValue("one mappedtail three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one mapped three");
  await composer.press("Control+z");
  await expect(composer).toHaveValue("one two three");

  const cdp = await page.context().newCDPSession(page);
  try {
    await composer.focus();
    await composer.evaluate((control: HTMLTextAreaElement) => {
      control.setSelectionRange(4, 7);
      control.dataset.compositionTrace = "[]";
      for (const type of [
        "compositionstart",
        "compositionend",
        "beforeinput",
        "input",
      ])
        control.addEventListener(type, (event) => {
          const trace = JSON.parse(control.dataset.compositionTrace ?? "[]");
          trace.push({
            type: event.type,
            trusted: event.isTrusted,
            data: "data" in event ? event.data : undefined,
            inputType: "inputType" in event ? event.inputType : undefined,
            composing: "isComposing" in event ? event.isComposing : undefined,
          });
          control.dataset.compositionTrace = JSON.stringify(trace);
        });
    });
    await cdp.send("Input.imeSetComposition", {
      text: "n",
      selectionStart: 1,
      selectionEnd: 1,
      replacementStart: 4,
      replacementEnd: 7,
    });
    await expect(composer).toHaveValue("one n three");
    expect(await operation("read")).toBe("one two three");
    await cdp.send("Input.imeSetComposition", {
      text: "\u4e2d\u6587",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await expect(composer).toHaveValue("one \u4e2d\u6587 three");
    await cdp.send("Input.insertText", { text: "\u4e2d\u6587" });
    const trace = JSON.parse(
      (await composer.getAttribute("data-composition-trace")) ?? "[]",
    ) as { type: string; trusted: boolean; data?: string }[];
    expect(
      trace.some((event) => event.type === "compositionstart" && event.trusted),
    ).toBe(true);
    const inputs = trace.filter((event) => event.type === "input");
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((event) => event.trusted)).toBe(true);
    expect(
      trace
        .filter((event) => event.type === "compositionend")
        .map((event) => event.data),
    ).toEqual(["\u4e2d\u6587"]);
    await expect.poll(() => operation("read")).toBe("one \u4e2d\u6587 three");
    await expect(composer).toHaveValue("one \u4e2d\u6587 three");
    await composer.press("Control+z");
    await expect(composer).toHaveValue("one two three");
    await composer.evaluate((control: HTMLTextAreaElement) =>
      control.setSelectionRange(4, 7),
    );
    await cdp.send("Input.imeSetComposition", {
      text: "!",
      selectionStart: 1,
      selectionEnd: 1,
      replacementStart: 4,
      replacementEnd: 7,
    });
    await cdp.send("Input.insertText", { text: "!" });
    await cdp.send("Input.insertText", { text: "!" });
    await cdp.send("Input.insertText", { text: "QR" });
    await expect.poll(() => operation("read")).toBe("one mappedmappedQR three");
    await expect(composer).toHaveValue("one mappedmappedQR three");
    await composer.press("Control+z");
    await expect(composer).toHaveValue("one two three");
    await composer.evaluate((control: HTMLTextAreaElement) =>
      control.setSelectionRange(4, 7),
    );
    await cdp.send("Input.imeSetComposition", {
      text: "n",
      selectionStart: 1,
      selectionEnd: 1,
      replacementStart: 4,
      replacementEnd: 7,
    });
    await cdp.send("Input.imeSetComposition", {
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
    await expect(composer).not.toHaveAttribute("data-pi-composing", "true");
    await expect(composer).toHaveValue("one two three");
    expect(await operation("read")).toBe("one two three");
  } finally {
    await cdp.detach();
  }
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await sdkAction(page, "prompt", { message: "/mapped-form" });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", { name: "Name", exact: true });
  await input.fill("one two three");
  await expect(input).toHaveValue("one two three");
  await compose(input, "\u4e2d\u6587", 4, 7);
  await expect(input).toHaveValue("one \u4e2d\u6587 three");
  await input.press("Enter");
  await expect(
    dialog.getByText("Input submitted: one \u4e2d\u6587 three", {
      exact: true,
    }),
  ).toBeVisible();
  await sdkAction(page, "abort");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("alert")).toHaveCount(0);
}

export async function verifyMappedPasteBlocks(page: Page, screenshot: string) {
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const operation = (action: string, text?: string) =>
    sdkAction<string>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/editor-action.mjs`,
      args: { action, text },
    });
  await sdkAction(page, "sdk.run", {
    path: `${initial.agentDir}/desktop/clipboard-fixture.mjs`,
    args: { text: "fixture clipboard" },
  });
  await sdkAction(page, "prompt", { message: "/mapped-editor" });
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toHaveAttribute("data-desktop-action", /^component:/);
  await operation("text", "prefix ");
  const payload = Array.from(
    { length: 12 },
    (_, index) => `Native paste content ${index + 1}`,
  ).join("\n");
  await operation("paste", payload);
  await expect(composer).toHaveValue(/\[paste #1/);
  const raw = await composer.inputValue();
  const row = page.locator('[data-surface-id="editor"] .desktop-paste-row');
  await expect(row).toHaveCount(1);
  await row.locator("summary").press("Enter");
  const preview = row.getByRole("textbox", { name: "粘贴内容 1", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveValue(payload);
  await expect(preview).toHaveAttribute("readonly", "");
  await preview.press("Control+a");
  await preview.press("Backspace");
  await preview.pressSequentially("ignored");
  await expect(preview).toHaveValue(payload);
  expect(await operation("read")).toBe(`prefix ${payload}`);
  await row
    .getByRole("button", { name: "复制粘贴内容 1", exact: true })
    .click();
  await expect(page.getByText("已复制文本", { exact: true })).toBeVisible();
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await row.getByRole("button", { name: "移除粘贴块 1", exact: true }).click();
  await expect(composer).toHaveValue("prefix ");
  await expect(row).toHaveCount(0);
  await composer.press("Control+z");
  await expect(composer).toHaveValue(raw);
  const markerEnd = raw.length;
  await composer.focus();
  await composer.evaluate((control: HTMLTextAreaElement, end) => {
    control.setSelectionRange(10, end - 2);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  }, markerEnd);
  await expect
    .poll(() =>
      composer.evaluate((control: HTMLTextAreaElement) => [
        control.selectionStart,
        control.selectionEnd,
      ]),
    )
    .toEqual([7, markerEnd]);
  await composer.press("Delete");
  await expect(composer).toHaveValue("prefix ");
  await composer.press("Control+z");
  await expect(composer).toHaveValue(raw);
  await composer.evaluate((control: HTMLTextAreaElement) => {
    control.setSelectionRange(12, 12);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await expect
    .poll(() =>
      composer.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      ),
    )
    .toBe(7);
  await composer.pressSequentially("X");
  await expect.poll(() => operation("read")).toBe(`prefix X${payload}`);
  await composer.press("Control+z");
  await expect(composer).toHaveValue(raw);
  await operation("text", "literal [paste #999 1200 chars]");
  await expect(row).toHaveCount(0);
  await sdkAction(page, "session.new");

  await sdkAction(page, "prompt", { message: "/mapped-native-pointer" });
  const dialog = page.getByRole("dialog");
  const nested = dialog.getByRole("textbox", { name: "编辑内容", exact: true });
  await nested.fill("");
  await nested.evaluate((control: HTMLTextAreaElement, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    control.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, payload);
  await expect(nested).toHaveValue(/\[paste #1/);
  const nestedRow = dialog.locator(".desktop-paste-row");
  const recorded = async () =>
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
      "native-editor-pointer"
    ];
  const before = await recorded();
  await nestedRow.locator("summary").click();
  const nestedPreview = nestedRow.getByRole("textbox", {
    name: "粘贴内容 1",
    exact: true,
  });
  await expect(nestedPreview).toHaveValue(payload);
  await nestedPreview.hover();
  await page.mouse.wheel(0, 30);
  await nestedPreview.press("ArrowDown");
  await nestedRow
    .getByRole("button", { name: "复制粘贴内容 1", exact: true })
    .click();
  expect(await recorded()).toBe(before);
  await expect(nested).toHaveValue(/\[paste #1/);
  await nestedRow
    .getByRole("button", { name: "移除粘贴块 1", exact: true })
    .click();
  await expect(nested).toHaveValue("");
  await nested.press("Control+z");
  await expect(nested).toHaveValue(/\[paste #1/);
  await sdkAction(page, "abort");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("alert")).toHaveCount(0);
}

export async function verifyMappedEditorTransactions(
  page: Page,
  screenshot: string,
) {
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const operation = (action: string, text?: string) =>
    sdkAction<string>(page, "sdk.run", {
      path: `${initial.agentDir}/desktop/editor-action.mjs`,
      args: { action, text },
    });
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  const flatten = (node: DesktopNode): DesktopNode[] => [
    node,
    ...("children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : []
    ).flatMap(flatten),
  ];
  const select = async (start: number, end: number) => {
    await composer.focus();
    await composer.evaluate(
      (control: HTMLTextAreaElement, range) => {
        control.setSelectionRange(range.start, range.end);
        control.dispatchEvent(new Event("select", { bubbles: true }));
      },
      { start, end },
    );
    await expect
      .poll(async () => {
        const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
        const editor = snapshot.desktopSurfaces.find(
          (surface) => surface.slot === "editor",
        );
        const node =
          editor &&
          flatten(editor.view).find((node) => node.kind === "textarea");
        return node?.kind === "textarea"
          ? { start: node.selection?.start, end: node.selection?.end }
          : undefined;
      })
      .toEqual({ start, end });
  };
  const payload = Array.from(
    { length: 12 },
    (_, index) => `Large pasted line ${index + 1}`,
  ).join("\n");
  await sdkAction(page, "prompt", { message: "/mapped-editor" });
  await operation("text", "prefix suffix");
  await expect(composer).toHaveValue("prefix suffix");
  await select(7, 7);
  const expanded = `prefix ${payload}suffix`;
  expect(await operation("paste", payload)).toBe(expanded);
  await expect(composer).toHaveValue(/\[paste #1/);
  const raw = await composer.inputValue();

  await composer.fill(`${raw} tail`);
  await expect.poll(() => operation("read")).toBe(`${expanded} tail`);
  await composer.press("Control+z");
  await expect(composer).toHaveValue(raw);
  await select(0, 6);
  await composer.pressSequentially("X");
  await expect.poll(() => operation("read")).toBe(`X ${payload}suffix`);
  await composer.press("Control+z");
  await expect(composer).toHaveValue(raw);

  await select(0, 6);
  expect(await operation("paste", "updated")).toBe(`updated ${payload}suffix`);
  await expect(composer).toHaveValue(raw.replace(/^prefix/, "updated"));
  await composer.press("Control+z");
  await expect(composer).toHaveValue(raw);
  const markerEnd = raw.indexOf("]") + 1;
  await select(7, markerEnd);
  await composer.press("Delete");
  await expect(composer).toHaveValue("prefix suffix");
  expect(await operation("read")).toBe("prefix suffix");
  await composer.press("Control+z");
  await expect(composer).toHaveValue(raw);
  expect(await operation("read")).toBe(expanded);
  await page.screenshot({ path: screenshot, animations: "disabled" });

  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(composer).toHaveValue("");
  await expect
    .poll(async () => {
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      return snapshot.messages
        .filter((message) => message.role === "user")
        .at(-1)
        ?.content.filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    })
    .toBe(expanded);
  await expect
    .poll(
      async () => !(await sdkAction<DesktopSnapshot>(page, "snapshot")).busy,
    )
    .toBe(true);
  await composer.press("ArrowUp");
  await expect(composer).toHaveValue(expanded);
  expect(await operation("read")).toBe(expanded);
  await operation("restore");
  await expect(composer).toHaveValue(expanded);
  expect(await operation("read")).toBe(expanded);
  await sdkAction(page, "session.new");
}

export async function verifyComponentPointer(page: Page, screenshot?: string) {
  await sdkAction(page, "prompt", { message: "/mapped-pointer" });
  const dialog = page.getByRole("dialog");
  const captured = dialog
    .locator(".desktop-region")
    .filter({ hasText: "Captured pointer" });
  await expect(captured).toBeVisible();
  const bounds = await captured.boundingBox();
  if (!bounds) throw new Error("Pointer component has no desktop bounds");
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height + 25,
  );
  await page.mouse.up();
  await expect
    .poll(async () =>
      JSON.parse(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "mapped-pointer-events"
        ] ?? "[]",
      ).map((event: { type: string }) => event.type),
    )
    .toContain("release");
  const records: { type: string; outside: boolean }[] = JSON.parse(
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
      "mapped-pointer-events"
    ],
  );
  expect(records.some((event) => event.type === "drag" && event.outside)).toBe(
    true,
  );
  expect(records.some((event) => event.type === "click")).toBe(false);
  await expect(captured).toBeFocused();
  await captured.press("k");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "mapped-pointer-key"
        ],
    )
    .toBe("k");
  await dialog.getByText("Bubbling pointer", { exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
            "mapped-pointer-parent"
          ] ?? "[]",
        ).filter((type: string) => type === "click").length,
    )
    .toBe(1);
  const childEvents: string[] = JSON.parse(
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
      "mapped-pointer-child"
    ] ?? "[]",
  );
  for (const type of ["press", "release", "click"])
    expect(childEvents.filter((event) => event === type).length).toBe(1);
  const ignored = dialog
    .locator(".desktop-region")
    .filter({ hasText: "Ignored pointer" });
  const ignoredBounds = await ignored.boundingBox();
  if (!ignoredBounds)
    throw new Error("Ignored pointer component has no desktop bounds");
  await page.mouse.move(
    ignoredBounds.x + ignoredBounds.width / 2,
    ignoredBounds.y + ignoredBounds.height / 2,
  );
  await page.mouse.down();
  await expect
    .poll(() => ignored.evaluate((element) => element.hasPointerCapture(1)))
    .toBe(false);
  await page.mouse.move(
    ignoredBounds.x + ignoredBounds.width / 2,
    ignoredBounds.y - 30,
  );
  await page.mouse.up();
  const ignoredTypes: string[] = JSON.parse(
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
      "mapped-pointer-ignored"
    ] ?? "[]",
  );
  expect(ignoredTypes).toContain("press");
  expect(ignoredTypes).not.toContain("drag");
  if (screenshot)
    await page.screenshot({ path: screenshot, animations: "disabled" });
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function verifyComponentMultiPointer(
  page: Page,
  screenshot?: string,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/mapped-pointer" });
  const dialog = page.getByRole("dialog");
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 3,
  });
  const activeTouches = new Set<number>();
  const touch = async (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    touchPoints: { id: number; x: number; y: number }[],
  ) => {
    await session.send("Input.dispatchTouchEvent", { type, touchPoints });
    if (type === "touchStart")
      for (const point of touchPoints) activeTouches.add(point.id);
    else if (
      type === "touchCancel" ||
      (type === "touchEnd" && !touchPoints.length)
    )
      activeTouches.clear();
    else if (type === "touchEnd")
      for (const point of touchPoints) activeTouches.delete(point.id);
  };
  const target = (text: string) =>
    dialog.locator(".desktop-region").filter({ hasText: text });
  const watch = async (region: ReturnType<typeof target>) => {
    await region.evaluate((element) => {
      element.addEventListener("pointerdown", (event) => {
        const ids = JSON.parse(
          (element as HTMLElement).dataset.testPointerIds ?? "[]",
        );
        ids.push((event as PointerEvent).pointerId);
        (element as HTMLElement).dataset.testPointerIds = JSON.stringify(ids);
      });
    });
    const bounds = await region.boundingBox();
    if (!bounds)
      throw new Error("Multi-pointer component has no desktop bounds");
    return [
      {
        id: 11,
        x: bounds.x + bounds.width / 3,
        y: bounds.y + bounds.height / 2,
      },
      {
        id: 22,
        x: bounds.x + (bounds.width * 2) / 3,
        y: bounds.y + bounds.height / 2,
      },
    ];
  };
  const captures = (region: ReturnType<typeof target>) =>
    region.evaluate((element) =>
      (
        JSON.parse(
          (element as HTMLElement).dataset.testPointerIds ?? "[]",
        ) as number[]
      ).map((id) => element.hasPointerCapture(id)),
    );
  try {
    const ignored = target("Ignored pointer");
    const points = await watch(ignored);
    await touch("touchStart", [points[0]]);
    await touch("touchStart", points);
    await expect.poll(() => captures(ignored)).toEqual([false, false]);
    await touch("touchCancel", []);

    const captured = target("Captured pointer");
    await expect
      .poll(() =>
        captured.evaluate((element) => getComputedStyle(element).touchAction),
      )
      .toBe("none");
    const retained = await watch(captured);
    await touch("touchStart", [retained[0]]);
    await touch("touchStart", retained);
    await expect.poll(() => captures(captured)).toEqual([true, true]);
    await touch("touchEnd", [retained[1]]);
    await expect.poll(() => captures(captured)).toEqual([true, false]);
    const moved = { ...retained[0], y: retained[0].y + 70 };
    await touch("touchMove", [moved]);
    await touch("touchEnd", []);
    await expect.poll(() => captures(captured)).toEqual([false, false]);
    const records = async () =>
      JSON.parse(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "mapped-pointer-events"
        ] ?? "[]",
      ) as { type: string; outside: boolean }[];
    await expect
      .poll(
        async () =>
          (await records()).filter((event) => event.type === "release").length,
      )
      .toBe(2);
    expect(
      (await records()).some((event) => event.type === "drag" && event.outside),
    ).toBe(true);

    await sdkAction(page, "abort");
    await sdkAction(page, "prompt", { message: "/mapped-native-pointer" });
    const input = dialog.getByRole("textbox", {
      name: "Pointer name",
      exact: true,
    });
    await expect
      .poll(() =>
        input.evaluate((element) => getComputedStyle(element).touchAction),
      )
      .toBe("auto");
    const nativePoints = await watch(input);
    await touch("touchStart", [nativePoints[0]]);
    await touch("touchStart", nativePoints);
    await expect(input).toHaveAttribute("data-pointer-active", "2");
    await touch("touchEnd", [nativePoints[0]]);
    await expect
      .poll(() => input.getAttribute("data-pointer-pending"))
      .toBeNull();
    await expect(input).toHaveAttribute("data-pointer-active", "1");
    await touch("touchEnd", []);
    await expect
      .poll(() => input.getAttribute("data-pointer-pending"))
      .toBeNull();
    await expect
      .poll(() => input.getAttribute("data-pointer-active"))
      .toBeNull();
    if (screenshot)
      await page.screenshot({ path: screenshot, animations: "disabled" });
  } finally {
    if (activeTouches.size) await touch("touchCancel", []);
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: false,
    });
    await session.detach();
    await sdkAction(page, "abort");
  }
}

export async function verifyNativeComponentPointer(
  page: Page,
  screenshot?: string,
) {
  await sdkAction(page, "prompt", { message: "/mapped-native-pointer" });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", {
    name: "Pointer name",
    exact: true,
  });
  const editor = dialog.getByRole("textbox", { name: "编辑内容", exact: true });
  await input.click({ button: "right" });
  await input.press("Q");
  await expect(input).toHaveValue("Original mouse overrideQ");
  await dialog
    .getByRole("button", { name: "确认", exact: true })
    .first()
    .click();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "native-input-submit"
        ],
    )
    .toBe("1");
  await input.fill("Native input selection");
  const selection = await input.evaluate((element) => {
    const input = element as HTMLInputElement;
    const style = getComputedStyle(input);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = style.font;
    const bounds = input.getBoundingClientRect();
    const start = bounds.x + parseFloat(style.paddingLeft) + 1;
    return {
      x: start,
      y: bounds.y + bounds.height / 2,
      end: start + context.measureText(input.value.slice(0, 6)).width,
    };
  });
  await page.mouse.move(selection.x, selection.y);
  await page.mouse.down();
  await page.mouse.move(selection.end, selection.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const input = element as HTMLInputElement;
        return [input.selectionStart, input.selectionEnd];
      }),
    )
    .toEqual([0, 6]);
  await input.press("X");
  await expect(input).toHaveValue("X input selection");
  await input.hover();
  await page.mouse.wheel(0, 20);
  await expect
    .poll(() =>
      input.evaluate((element) => (element as HTMLInputElement).selectionStart),
    )
    .toBe(0);
  await input.press("Y");
  await expect(input).toHaveValue("YX input selection");
  const editorStart = await editor.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      x: parseFloat(style.paddingLeft) + 1,
      y: parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2,
    };
  });
  await editor.click({ position: editorStart });
  await expect
    .poll(async () =>
      JSON.parse(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "native-editor-pointer"
        ] ?? "[]",
      ),
    )
    .toContain("click");
  await editor.press("Z");
  await expect(editor).toHaveValue("ZNative textarea selection");
  await editor.hover();
  await page.mouse.wheel(0, 20);
  await expect(editor).toHaveValue("Original editor mouse override");
  const list = dialog.getByRole("listbox", { name: "选择", exact: true });
  await list.getByRole("option", { name: "Pointer high", exact: true }).click();
  await expect
    .poll(async () =>
      JSON.parse(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "native-select-submit"
        ] ?? "null",
      ),
    )
    .toEqual({ value: "high", count: 1 });
  await expect
    .poll(async () =>
      JSON.parse(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "native-select-change"
        ] ?? "null",
      ),
    )
    .toEqual({ value: "high", count: 1 });
  await expect(list).toHaveValue("high");
  await list
    .getByRole("option", { name: "Pointer option 30", exact: true })
    .click();
  await expect
    .poll(async () =>
      JSON.parse(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "native-select-submit"
        ] ?? "null",
      ),
    )
    .toEqual({ value: "extra-30", count: 2 });
  await expect
    .poll(async () =>
      JSON.parse(
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "native-select-change"
        ] ?? "null",
      ),
    )
    .toEqual({ value: "extra-30", count: 2 });
  await expect(list).toHaveValue("extra-30");
  if (screenshot)
    await page.screenshot({ path: screenshot, animations: "disabled" });
  await dialog
    .getByRole("button", { name: "确认", exact: true })
    .last()
    .click();
  await expect(dialog).toBeHidden();
}

export async function verifyNativeMouseRegions(
  page: Page,
  screenshot?: string,
) {
  await sdkAction(page, "prompt", { message: "/mapped-native-regions" });
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", {
    name: "Nested pointer name",
    exact: true,
  });
  await expect(input).toBeVisible();
  const selection = await input.evaluate((element) => {
    const input = element as HTMLInputElement;
    const style = getComputedStyle(input);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = style.font;
    const bounds = input.getBoundingClientRect();
    const x = bounds.x + parseFloat(style.paddingLeft) + 1;
    return {
      x,
      y: bounds.y + bounds.height / 2,
      end: x + context.measureText(input.value.slice(0, 7)).width,
    };
  });
  await page.mouse.move(selection.x, selection.y);
  await page.mouse.down();
  await page.mouse.move(selection.end, selection.y, { steps: 5 });
  await page.mouse.up();
  await input.press("X");
  await expect(input).toHaveValue("Xnested selection");
  await input.hover();
  await page.mouse.wheel(0, 20);
  await expect(input).toHaveValue("Parent wheel override");
  await input.press("Q");
  await expect(input).toHaveValue("Parent wheel overrideQ");
  const bounds = await input.boundingBox();
  if (!bounds) throw new Error("Nested input has no desktop bounds");
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down({ button: "middle" });
  await expect
    .poll(() => input.evaluate((element) => element.hasPointerCapture(1)))
    .toBe(true);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height + 30,
  );
  await expect(input).toHaveValue("Native captured outside");
  await page.mouse.up({ button: "middle" });
  await expect
    .poll(() => input.evaluate((element) => element.hasPointerCapture(1)))
    .toBe(false);
  const mode = dialog.getByRole("button", {
    name: "Mode: compact",
    exact: true,
  });
  await mode.click();
  const status = async (key: string) =>
    (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[key];
  await expect
    .poll(async () =>
      JSON.parse((await status("native-settings-change")) ?? "null"),
    )
    .toEqual({
      id: "mode:choice",
      value: "expanded",
      count: 1,
    });
  await expect
    .poll(async () =>
      JSON.parse((await status("native-settings-pointer")) ?? "[]").filter(
        (type: string) => type !== "move",
      ),
    )
    .toEqual(["press", "release", "click"]);
  await dialog
    .getByRole("button", { name: "Mode: expanded", exact: true })
    .press("Enter");
  await expect
    .poll(async () =>
      JSON.parse((await status("native-settings-change")) ?? "null"),
    )
    .toEqual({
      id: "mode:choice",
      value: "compact",
      count: 2,
    });
  await dialog
    .getByRole("textbox", { name: "搜索", exact: true })
    .fill("Nested");
  await expect(mode).toBeHidden();
  await dialog
    .getByRole("button", { name: "Nested: one", exact: true })
    .click();
  const list = dialog.getByRole("listbox", { name: "选择", exact: true });
  await expect(list).toBeVisible();
  await list.getByRole("option", { name: "Nested two", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Nested: two", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      JSON.parse((await status("native-settings-change")) ?? "null"),
    )
    .toEqual({
      id: "nested:choice",
      value: "two",
      count: 3,
    });
  if (screenshot)
    await page.screenshot({ path: screenshot, animations: "disabled" });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function verifyComponentOverlays(
  page: Page,
  screenshot?: string,
  resize = false,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).changing,
    )
    .toBe(false);
  await sdkAction(page, "prompt", { message: "/mapped-overlays" });
  const first = page.getByRole("textbox", {
    name: "First nested input",
    exact: true,
  });
  await expect(first).toBeVisible();
  await first.fill("First desktop value");
  await first.press("Enter");
  const second = page.getByRole("textbox", {
    name: "Second nested input",
    exact: true,
  });
  await expect(second).toBeVisible();
  await expect(second).toBeFocused();
  await expect(first).toBeVisible();
  const verifyGeometry = async () => {
    for (const [control, corner] of [
      [first, "top-left"],
      [second, "bottom-right"],
    ] as const) {
      await expect
        .poll(
          async () => {
            const measured = await control.evaluate((element) => {
              const root = element.closest<HTMLElement>(".desktop-overlay")!;
              const rect = root.getBoundingClientRect();
              return {
                id: element.closest<HTMLElement>("[data-surface-id]")!.dataset
                  .surfaceId,
                width: innerWidth,
                height: innerHeight,
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                visibleHeight: rect.height,
              };
            });
            const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
            const overlay = snapshot.desktopSurfaces.find(
              (surface) => surface.id === measured.id,
            )?.overlay;
            if (!overlay?.bounds || !overlay.viewport) return false;
            const cell = measured.width / overlay.viewport.width;
            const line = measured.height / overlay.viewport.height;
            const bounds = overlay.bounds;
            const expectedCol =
              corner === "top-left"
                ? 2
                : overlay.viewport.width - bounds.width - 2;
            const expectedRow =
              corner === "top-left"
                ? 2
                : overlay.viewport.height - bounds.height - 2;
            return (
              bounds.col === expectedCol &&
              bounds.row === expectedRow &&
              bounds.height === Math.ceil(measured.visibleHeight / line) &&
              Math.abs(measured.left - bounds.col * cell) < 1 &&
              Math.abs(measured.top - bounds.row * line) < 1 &&
              measured.bottom <= measured.height - 2 * line + 1 &&
              measured.right <= measured.width - 2 * cell + 1
            );
          },
          {
            message: `${corner} overlay uses Pi layout and measured desktop bounds`,
          },
        )
        .toBe(true);
    }
  };
  await verifyGeometry();
  if (resize) {
    const initial = page.viewportSize()!;
    await page.setViewportSize({
      width: initial.width > 600 ? 390 : 1440,
      height: 940,
    });
    await verifyGeometry();
    await page.setViewportSize(initial);
    await verifyGeometry();
  }
  await second.fill("Second desktop value");
  if (screenshot)
    await page.screenshot({ path: screenshot, animations: "disabled" });
  await second.press("Enter");
  await expect(first).toBeHidden();
  await expect(second).toBeHidden();
  const parent = page.getByRole("dialog").getByRole("textbox", {
    name: "Parent confirmation",
    exact: true,
  });
  await expect(parent).toBeVisible();
  await parent.fill("Confirmed");
  await parent.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "nested-overlay-result"
        ],
    )
    .toBe(
      JSON.stringify({
        first: "First desktop value",
        second: "Second desktop value",
        confirmation: "Confirmed",
      }),
    );
}

export async function verifyComponentMapping(page: Page, screenshot: string) {
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/mapped-form" });
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Original factory", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("separator")).toBeVisible();
  const input = dialog.getByRole("textbox", { name: "Name", exact: true });
  await input.fill("Native task");
  await input.press("Enter");
  await expect(
    dialog.getByText("Input submitted: Native task", { exact: true }),
  ).toBeVisible();
  const editor = dialog.getByRole("textbox", { name: "编辑内容", exact: true });
  await editor.pressSequentially("Original editor");
  await expect(editor).toHaveValue("Original editor");
  await editor.press("Control+a");
  await editor.press("Backspace");
  await expect(editor).toHaveValue("");
  await editor.pressSequentially("Native notes");
  await dialog
    .getByRole("combobox", { name: "选择", exact: true })
    .selectOption("high");
  await expect(
    dialog.getByText("High priority", { exact: true }),
  ).toBeVisible();
  const image = dialog.getByRole("img", { name: "fixture.png" });
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (element) => (element as HTMLImageElement).naturalWidth,
    ),
  ).toBeGreaterThan(0);
  const scroll = dialog.locator(".desktop-scroll");
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect
    .poll(async () => {
      const state = await sdkAction<DesktopSnapshot>(page, "snapshot");
      return JSON.stringify(
        state.desktopSurfaces.find((surface) => surface.slot === "dialog")
          ?.view,
      ).includes('"followEnd":false');
    })
    .toBe(true);
  await dialog.getByText("Pointer area", { exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses
            .pointer ?? "{}",
        ).type,
    )
    .toBe("click");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await dialog
    .getByRole("button", { name: "确认", exact: true })
    .last()
    .click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "form-result"
        ],
    )
    .toBe(
      JSON.stringify({
        name: "Native task",
        notes: "Native notes",
        priority: "high",
      }),
    );

  await sdkAction(page, "prompt", { message: "/mapped-bordered-loader" });
  await expect(
    dialog.getByRole("progressbar", { name: "Mapped SDK loader", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "bordered-loader-aborted"
        ],
    )
    .toBe("true");
  await sdkAction(page, "prompt", { message: "/mapped-settings" });
  await expect(
    dialog.getByRole("combobox", { name: "Mode", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("combobox", { name: "Mode", exact: true })
    .selectOption("expanded");
  await dialog
    .getByRole("textbox", { name: "搜索", exact: true })
    .fill("Nested");
  await expect(
    dialog.getByRole("combobox", { name: "Mode", exact: true }),
  ).toBeHidden();
  await dialog.getByRole("button", { name: "Nested", exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "选择", exact: true })
    .selectOption("two");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "setting-result"
        ],
    )
    .toBe("nested:choice=two");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toBeHidden();

  await verifyComponentOverlays(
    page,
    screenshot.replace(".png", "-overlays.png"),
  );

  await verifyComponentPointer(
    page,
    screenshot.replace(".png", "-pointer.png"),
  );
  await verifyComponentMultiPointer(
    page,
    screenshot.replace(".png", "-touch.png"),
  );
  await verifyNativeComponentPointer(
    page,
    screenshot.replace(".png", "-native-pointer.png"),
  );
  await verifyNativeMouseRegions(
    page,
    screenshot.replace(".png", "-native-regions.png"),
  );
  await sdkAction(page, "prompt", { message: "/mapped-editor" });
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).editor.text,
    )
    .toBe("");
  await composer.pressSequentially("!");
  await expect(composer).toHaveValue("mapped");
  await composer.press("Control+a");
  await composer.press("Backspace");
  await composer.pressSequentially("/mapped-s");
  await composer.press("Tab");
  const completion = page
    .locator('[data-surface-id="editor"]')
    .getByRole("listbox", { name: "选择", exact: true });
  await expect(completion).toBeVisible();
  await completion.getByRole("option", { name: /mapped-settings/ }).click();
  await expect(composer).toHaveValue("/mapped-settings ");
  await sdkAction(page, "resources.reload");
  await expect(composer).toBeVisible();
  expect(
    await page
      .locator(".desktop-extension canvas, .desktop-extension .xterm")
      .count(),
  ).toBe(0);
}
