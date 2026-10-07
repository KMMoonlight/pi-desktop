import { expect, type Page, type Locator } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";

async function waitForIdle(page: Page) {
  await expect
    .poll(async () => !(await sdkAction<{ busy: boolean }>(page, "snapshot")).busy)
    .toBe(true);
}

async function reference(
  page: Page,
  editor: Locator,
  value: string,
  offset: number,
) {
  const identity = await editor.evaluate((control) => ({
    id: control.closest<HTMLElement>("[data-surface-id]")!.dataset.surfaceId,
    instanceId:
      control.closest<HTMLElement>("[data-surface-id]")!.dataset.instanceId,
    action: (control as HTMLElement).dataset.desktopAction,
  }));
  await sdkAction(page, "desktop.action", { ...identity, value });
  await expect(editor).toHaveValue(value);
  if (identity.action?.startsWith("component:")) {
    await editor.evaluate((control: HTMLTextAreaElement) =>
      control.setSelectionRange(control.value.length, control.value.length),
    );
    await sdkAction(page, "desktop.action", {
      ...identity,
      action: `${identity.action}:selection`,
      value: { start: offset, end: offset, text: value },
    });
    await expect
      .poll(() =>
        editor.evaluate(
          (control: HTMLTextAreaElement) => control.selectionStart,
        ),
      )
      .toBe(offset);
  }
  await editor.evaluate((control: HTMLTextAreaElement, offset) => {
    document.getElementById("navigation-reference")?.remove();
    const native = document.createElement(
      control instanceof HTMLInputElement ? "input" : "textarea",
    );
    const css = getComputedStyle(control);
    for (const key of css)
      native.style.setProperty(key, css.getPropertyValue(key));
    Object.assign(native.style, {
      position: "fixed",
      top: "0",
      left: "0",
      zIndex: "9999",
      width: `${control.getBoundingClientRect().width}px`,
    });
    native.dataset.desktopNativeInput = "true";
    native.id = "navigation-reference";
    native.setAttribute("aria-label", "Navigation reference");
    native.value = control.value;
    document.body.append(native);
    control.setSelectionRange(offset, offset);
    native.setSelectionRange(offset, offset);
  }, offset);
  return page.locator("#navigation-reference");
}

export async function verifyEditorNavigation(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  for (const kind of ["default", "custom", "dialog"]) {
    if (kind !== "default")
      await sdkAction(page, "prompt", {
        message: kind === "custom" ? "/mapped-editor" : "/mapped-form",
      });
    const editor =
      kind === "dialog"
        ? page
            .getByRole("dialog")
            .getByRole("textbox", { name: "编辑内容", exact: true })
        : page.getByRole("textbox", { name: "消息", exact: true });
    await expect(editor).toBeVisible();
    await editor.evaluate((control: HTMLTextAreaElement) => {
      control.style.height = "200px";
      control.style.minHeight = "200px";
      control.style.maxHeight = "200px";
    });
    for (const sample of [
      { value: "Wide WWWW narrow iiii word ".repeat(100), offset: 20 },
      { value: "宽字符🙂 e\u0301 words WWWW iiii ".repeat(100), offset: 5 },
      { value: "English العربية עברית 123 words ".repeat(100), offset: 12 },
      {
        value:
          "Wide WWWW narrow iiii word\nshort\n" +
          "Wide WWWW narrow iiii word ".repeat(100),
        offset: 20,
      },
    ]) {
      const native = await reference(page, editor, sample.value, sample.offset);
      const keys = ["ArrowDown", "ArrowDown", "ArrowUp", "PageDown", "PageUp"];
      const positions: number[] = [];
      await native.focus();
      for (const key of keys) {
        await native.press(key);
        positions.push(
          await native.evaluate(
            (el) => (el as HTMLTextAreaElement).selectionStart,
          ),
        );
      }
      await editor.focus();
      for (const [index, key] of keys.entries()) {
        const position = positions[index];
        await editor.press(key);
        await expect
          .poll(
            () =>
              editor.evaluate(
                (el) => (el as HTMLTextAreaElement).selectionStart,
              ),
            { message: `${kind} ${key}: ${sample.value.slice(0, 30)}` },
          )
          .toBe(position);
        await expect(editor).toHaveValue(sample.value);
      }
      await page.locator("#navigation-reference").evaluate((el) => el.remove());
    }
    const nativeSelection = await reference(
      page,
      editor,
      "Wide WWWW narrow iiii word ".repeat(100),
      20,
    );
    const selectionKeys = [
      "Shift+ArrowDown",
      "Shift+ArrowDown",
      "Shift+ArrowUp",
    ];
    const selections: { start: number; end: number; direction: string }[] = [];
    await nativeSelection.focus();
    for (const key of selectionKeys) {
      await nativeSelection.press(key);
      selections.push(
        await nativeSelection.evaluate((el: HTMLTextAreaElement) => ({
          start: el.selectionStart,
          end: el.selectionEnd,
          direction: el.selectionDirection,
        })),
      );
    }
    await editor.focus();
    for (const [index, key] of selectionKeys.entries()) {
      await editor.press(key);
      await expect
        .poll(() =>
          editor.evaluate((el: HTMLTextAreaElement) => ({
            start: el.selectionStart,
            end: el.selectionEnd,
            direction: el.selectionDirection,
          })),
        )
        .toEqual(selections[index]);
    }
    await nativeSelection.evaluate((el) => el.remove());
    if (kind === "custom") {
      await editor.fill("");
      await editor.press("!");
      await expect(editor).toHaveValue("mapped");
    }
    if (kind === "dialog")
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true })
        .click();
  }
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await waitForIdle(page);
  await sdkAction(page, "session.new");
}

export async function verifyEditorBidi(
  page: Page,
  kinds = ["default", "custom", "dialog"],
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  const keys = [
    "ArrowLeft",
    "ArrowLeft",
    "ArrowRight",
    "Shift+ArrowRight",
    "Shift+ArrowLeft",
    "Shift+ArrowLeft",
    "ArrowRight",
  ];
  const selection = (control: Locator) =>
    control.evaluate((el: HTMLTextAreaElement) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
      direction: el.selectionDirection,
    }));
  for (const kind of kinds) {
    if (kind !== "default")
      await sdkAction(page, "prompt", {
        message: kind === "custom" ? "/mapped-editor" : "/mapped-form",
      });
    const editor =
      kind === "input"
        ? page
            .getByRole("dialog")
            .getByRole("textbox", { name: "Name", exact: true })
        : kind === "dialog"
          ? page
              .getByRole("dialog")
              .getByRole("textbox", { name: "编辑内容", exact: true })
          : page.getByRole("textbox", { name: "消息", exact: true });
    for (const direction of ["ltr", "rtl"]) {
      await editor.evaluate((el, direction) => {
        el.style.direction = direction;
      }, direction);
      for (const sample of [
        { value: "English العربية עברית 123 words", offset: 12 },
        { value: "العربية English עברית 123", offset: 7 },
      ]) {
        const native = await reference(
          page,
          editor,
          sample.value,
          sample.offset,
        );
        const expected = [];
        await native.focus();
        for (const key of keys) {
          await native.press(key);
          expected.push(await selection(native));
        }
        await editor.focus();
        for (const [index, key] of keys.entries()) {
          await editor.press(key);
          await expect
            .poll(() => selection(editor), {
              message: `${kind} ${direction} ${key}: ${sample.value}`,
            })
            .toEqual(expected[index]);
          await expect(editor).toHaveValue(sample.value);
        }
        for (const key of ["Backspace", "Delete"]) {
          await native.focus();
          await native.press(key);
          const value = await native.inputValue();
          const range = await selection(native);
          await editor.focus();
          await editor.press(key);
          await expect(editor).toHaveValue(value);
          await expect
            .poll(() => selection(editor), {
              message: `${kind} ${direction} ${key}`,
            })
            .toEqual(range);
        }
        await native.evaluate((el) => el.remove());
      }
    }
    await editor.evaluate((el) => el.style.removeProperty("direction"));
    if (kind === "dialog" || kind === "input")
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true })
        .click();
  }
  await waitForIdle(page);
  await sdkAction(page, "session.new");
}

export async function verifyEditorResize(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  for (const name of ["关闭检查器", "收起侧边栏"]) {
    const close = page.getByRole("button", { name, exact: true });
    if (await close.isVisible()) await close.click();
  }
  await sdkAction(page, "session.new");
  const viewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  try {
    for (const kind of ["default", "custom", "dialog"]) {
      await page.setViewportSize(viewport);
      if (kind !== "default")
        await sdkAction(page, "prompt", {
          message: kind === "custom" ? "/mapped-editor" : "/mapped-form",
        });
      const editor =
        kind === "dialog"
          ? page
              .getByRole("dialog")
              .getByRole("textbox", { name: "编辑内容", exact: true })
          : page.getByRole("textbox", { name: "消息", exact: true });
      const value = "Wide WWWW narrow iiii words 宽字符🙂 e\u0301 ".repeat(25);
      const native = await reference(page, editor, value, 20);
      await native.focus();
      await native.press("ArrowDown");
      const position = await native.evaluate(
        (control: HTMLTextAreaElement) => control.selectionStart,
      );
      await page.evaluate(() => {
        const target = window as unknown as {
          fetch: typeof fetch;
          editorResizeGate?: {
            fetch: typeof fetch;
            waiting: boolean;
            used: boolean;
            release?: () => void;
          };
        };
        const gate = {
          fetch: target.fetch,
          waiting: false,
          used: false,
        } as NonNullable<typeof target.editorResizeGate>;
        target.editorResizeGate = gate;
        target.fetch = async (input, options) => {
          const url = new URL(
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
            location.href,
          );
          const request = ["/api/action", "/sdk_action"].includes(
            decodeURIComponent(url.pathname),
          )
            ? (JSON.parse(String(options?.body ?? "{}")) as {
                action?: string;
                args?: { event?: { key?: string } };
              })
            : undefined;
          const response = await gate.fetch.call(window, input, options);
          if (
            !gate.used &&
            request?.action === "desktop.input" &&
            request.args?.event?.key === "ArrowDown"
          ) {
            gate.used = true;
            gate.waiting = true;
            await new Promise<void>((resolve) => {
              gate.release = resolve;
            });
            gate.waiting = false;
          }
          return response;
        };
      });
      try {
        await editor.focus();
        await editor.press("ArrowDown");
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  (
                    window as unknown as {
                      editorResizeGate?: { waiting: boolean };
                    }
                  ).editorResizeGate?.waiting,
              ),
            { message: `${kind} pending input confirmation` },
          )
          .toBe(true);
        await page.setViewportSize({
          width: viewport.width > 600 ? 390 : 1440,
          height: viewport.height,
        });
        await editor.evaluate((control: HTMLTextAreaElement) => {
          const native = document.getElementById(
            "navigation-reference",
          )! as HTMLTextAreaElement;
          native.style.width = `${control.getBoundingClientRect().width}px`;
          native.style.height = `${control.getBoundingClientRect().height}px`;
        });
        await native.press("Shift+ArrowDown");
        const selection = await native.evaluate(
          (control: HTMLTextAreaElement) => ({
            start: control.selectionStart,
            end: control.selectionEnd,
            direction: control.selectionDirection,
          }),
        );
        await editor.press("Shift+ArrowDown");
        await page.evaluate(() =>
          (
            window as unknown as { editorResizeGate?: { release?: () => void } }
          ).editorResizeGate?.release?.(),
        );
        await expect
          .poll(
            () =>
              editor.evaluate((control: HTMLTextAreaElement) => ({
                start: control.selectionStart,
                end: control.selectionEnd,
                direction: control.selectionDirection,
              })),
            {
              message: `${kind} selection after resize; previous caret ${position}`,
            },
          )
          .toEqual(selection);
        await expect(editor).toHaveValue(value);
        await native.evaluate((control) => control.remove());
        await page.screenshot({
          path: screenshot.replace(".png", `-${kind}.png`),
          animations: "disabled",
        });
      } finally {
        await page.evaluate(() => {
          const target = window as unknown as {
            fetch: typeof fetch;
            editorResizeGate?: { fetch: typeof fetch; release?: () => void };
          };
          target.editorResizeGate?.release?.();
          if (target.editorResizeGate)
            target.fetch = target.editorResizeGate.fetch;
          delete target.editorResizeGate;
          document.getElementById("navigation-reference")?.remove();
        });
      }
      if (kind === "dialog") await sdkAction(page, "abort");
    }
    await page.screenshot({ path: screenshot, animations: "disabled" });
  } finally {
    await page.setViewportSize(viewport);
    await sdkAction(page, "abort");
    await waitForIdle(page);
    await sdkAction(page, "session.new");
  }
}
