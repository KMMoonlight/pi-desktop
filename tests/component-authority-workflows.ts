import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyComponentAuthority(
  page: Page,
  kind: "input" | "editor" | "custom-editor",
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const modulePath = `${initial.agentDir}/desktop/authority-action.mjs`;
  const pending = sdkAction(page, "prompt", { message: `/authority-${kind}` });
  const dialog = page.getByRole("dialog");
  const control = dialog.getByRole("textbox");
  await expect(control).toHaveValue("abcdef");
  await expect(control).toHaveAttribute("data-control-version", /^\d+$/);
  await page.evaluate(`((modulePath) => {
    const state = { pending: null, hits: 0, fetch: window.fetch, records: [] };
    window.authorityGate = state;
    const matches = (request) => {
      const gate = state.pending;
      if (!gate) return false;
      const args = request.args ?? {};
      if (gate.mode === "key") return request.action === "desktop.input" &&
        (args.data === gate.data || args.event?.key === gate.data);
      if (gate.mode === "selection") return request.action === "desktop.action" &&
        args.action?.endsWith(":selection") && args.value?.start === 0 && args.value?.end === 2;
      return request.action === "desktop.action" && args.value?.text === "obsolete";
    };
    const mutate = async (request, send) => {
      if (!matches(request)) return;
      const gate = state.pending;
      state.pending = null;
      state.hits++;
      await send({ action: "sdk.run", args: { path: modulePath, args: gate.mutate } });
    };
    // Tauri's invoke property is read-only; intercept its actual fetch transport.
    window.fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const native = url.hostname === "ipc.localhost" && decodeURIComponent(url.pathname) === "/sdk_action";
      if ((native || url.pathname === "/api/action") && options?.body) {
        const request = JSON.parse(options.body);
        const record = { request };
        if (request.action === "desktop.action" || request.action === "desktop.input")
          state.records.push(record);
        await mutate(request, async (operation) => {
          const response = await state.fetch.call(window, input, { ...options, body: JSON.stringify(operation) });
          const result = await response.json();
          if (native && response.headers.get("Tauri-Response") !== "ok")
            throw new Error(typeof result === "string" ? result : JSON.stringify(result));
          if (!native && result.error) throw new Error(result.error);
        });
        const response = await state.fetch.call(window, input, options);
        if (request.action === "desktop.action" || request.action === "desktop.input")
          record.result = await response.clone().json();
        return response;
      }
      return state.fetch.call(window, input, options);
    };
    if (window.fetch === state.fetch) throw new Error("Authority transport interceptor was not installed");
  })(${JSON.stringify(modulePath)})`);
  const gate = async (
    mode: string,
    mutate: Record<string, unknown>,
    data = "!",
  ) => {
    await page.evaluate(
      ({ mode, mutate, data }) => {
        Reflect.get(window, "authorityGate").pending = { mode, mutate, data };
      },
      { mode, mutate, data },
    );
  };
  const read = () =>
    sdkAction<string>(page, "sdk.run", {
      path: modulePath,
      args: { read: true },
    });
  const selection = () =>
    control.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]);
  try {
    await control.selectText();
    await gate("key", { text: "SDK replacement" });
    await control.press("!");
    await expect(control).toHaveValue("SDK replacement!");
    await expect.poll(read).toBe("SDK replacement!");
    expect(
      await page.evaluate(() => Reflect.get(window, "authorityGate").hits),
    ).toBe(1);

    await control.fill("abcdef");
    await gate("key", { left: 3 });
    await control.press("!");
    await expect(control).toHaveValue("abc!def");
    await expect.poll(read).toBe("abc!def");

    await control.fill("abcdef");
    await expect.poll(read).toBe("abcdef");
    await expect(control).not.toHaveAttribute("data-pi-input-pending", "true");
    await gate("selection", { left: 3 });
    await control.evaluate(
      (element: HTMLInputElement | HTMLTextAreaElement) => {
        element.focus();
        element.setSelectionRange(0, 2);
        element.dispatchEvent(new Event("select", { bubbles: true }));
      },
    );
    await expect.poll(selection).toEqual([3, 3]);
    await control.press("!");
    await expect(control).toHaveValue("abc!def");

    await gate("value", { text: "SDK kept value" });
    await control.evaluate(
      (element: HTMLInputElement | HTMLTextAreaElement) => {
        const prototype =
          element instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
          element,
          "obsolete",
        );
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertReplacementText",
            data: "obsolete",
          }),
        );
      },
    );
    await expect(control).toHaveValue("SDK kept value");
    await expect.poll(read).toBe("SDK kept value");

    await gate("key", { text: "SDK native selection" }, "a");
    await control.press("Control+a");
    await expect(control).toHaveValue("SDK native selection");
    await expect.poll(selection).toEqual([0, "SDK native selection".length]);

    await control.fill("browser before error");
    await expect.poll(read).toBe("browser before error");
    const surface = (
      await sdkAction<DesktopSnapshot>(page, "snapshot")
    ).desktopSurfaces.find((surface) => surface.slot === "dialog")!;
    const context = await control.evaluate(
      (element: HTMLInputElement | HTMLTextAreaElement) => ({
        controlAction: element.dataset.desktopAction,
        controlText: element.value,
        controlVersion: Number(element.dataset.controlVersion),
        selection: {
          start: element.selectionStart ?? 0,
          end: element.selectionEnd ?? 0,
        },
      }),
    );
    await expect(
      sdkAction(page, "desktop.input", {
        surfaceId: surface.id,
        instanceId: surface.instanceId,
        data: "authority-mutate-throw",
        ...context,
      }),
    ).rejects.toThrow(/Original authority callback failed/);
    await control.press("!");
    await expect(control).toHaveValue("SDK callback after error!");
    await expect.poll(read).toBe("SDK callback after error!");

    await control.fill("abcdef");
    await control.evaluate(
      (element: HTMLInputElement | HTMLTextAreaElement) => {
        element.setSelectionRange(2, 4);
        element.dispatchEvent(new Event("select", { bubbles: true }));
      },
    );
    await gate("key", { text: "SDK composition" }, "中文");
    await control.evaluate(
      (element: HTMLInputElement | HTMLTextAreaElement) => {
        for (const data of ["中文", "乙"]) {
          element.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true }),
          );
          const prototype =
            element instanceof HTMLInputElement
              ? HTMLInputElement.prototype
              : HTMLTextAreaElement.prototype;
          const start = element.selectionStart ?? 0,
            end = element.selectionEnd ?? start;
          const value =
            element.value.slice(0, start) + data + element.value.slice(end);
          Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
            element,
            value,
          );
          element.setSelectionRange(start + data.length, start + data.length);
          element.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertCompositionText",
              data,
              isComposing: true,
            }),
          );
          element.dispatchEvent(
            new CompositionEvent("compositionend", { bubbles: true, data }),
          );
          element.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertFromComposition",
              data,
            }),
          );
        }
      },
    );
    await expect(control).toHaveValue("SDK composition中文乙");
    await expect.poll(read).toBe("SDK composition中文乙");
    expect(
      await page.evaluate(() => Reflect.get(window, "authorityGate").hits),
    ).toBe(6);
    await page.screenshot({ path: screenshot });
    await control.press("Enter");
    await pending;
    await expect(dialog).toBeHidden();
    const status = (await sdkAction<DesktopSnapshot>(page, "snapshot"))
      .statuses["authority-result"];
    expect(JSON.parse(status)).toEqual({
      text: "SDK composition中文乙",
      submitted: 1,
      disposed: 1,
    });
  } catch (error) {
    console.error(
      "Authority transport state:",
      JSON.stringify(
        await page.evaluate(() => {
          const state = Reflect.get(window, "authorityGate");
          return {
            hits: state?.hits,
            pending: state?.pending,
            records: state?.records.slice(-12),
          };
        }),
      ),
    );
    throw error;
  } finally {
    await page.evaluate(() => {
      const state = Reflect.get(window, "authorityGate");
      if (state) {
        window.fetch = state.fetch;
        Reflect.deleteProperty(window, "authorityGate");
      }
    });
    await sdkAction(page, "abort").catch(() => {});
    await pending.catch(() => {});
  }
}
