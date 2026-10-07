import { createServer } from "node:http";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";

export async function verifyDesktopLinks(
  page: Page,
  screenshot: string,
  native = false,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/link-probe" });
  await page.evaluate((native) => {
    const opened: string[] = [];
    Reflect.set(window, "__desktopLinkOpens", opened);
    if (native) {
      // Tauri's invoke property is read-only. Intercept only its opener transport.
      const original = window.fetch;
      window.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (
          url.hostname === "ipc.localhost" &&
          ["/plugin:opener|open_url", "/open_external_protocol"].includes(
            decodeURIComponent(url.pathname),
          )
        ) {
          const payload = JSON.parse(String(init?.body));
          opened.push(payload.url);
          return new Response("null", {
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": "ok",
            },
          });
        }
        return original.call(window, input, init);
      };
      if (window.fetch === original)
        throw new Error(
          "Native opener transport interceptor was not installed",
        );
      Reflect.set(window, "__restoreDesktopLinkOpener", () => {
        window.fetch = original;
      });
    } else {
      const original = window.open;
      window.open = (url) => {
        opened.push(String(url));
        return null;
      };
      Reflect.set(window, "__restoreDesktopLinkOpener", () => {
        window.open = original;
      });
    }
  }, native);
  const dialog = page.getByRole("dialog");
  const targets = [
    ["Text email", "mailto:pi@example.invalid?subject=Pi%20desktop"],
    ["Text phone", "tel:+15550123456"],
    ["Markdown email", "mailto:pi@example.invalid?subject=Pi%20desktop"],
    ["Markdown phone", "tel:+15550123456"],
    ["Text custom", "pi-desktop-test:open?file=hello%20world&line=12#part"],
    ["Markdown custom", "pi-desktop-test:open?file=hello%20world&line=12#part"],
  ];
  try {
    for (const [label, href] of targets) {
      const link = dialog.getByRole("link", { name: label, exact: true });
      await expect(link).toHaveAttribute("href", href);
      await link.click();
    }
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "__desktopLinkOpens")),
      )
      .toEqual(targets.map(([, href]) => href));
    await page.screenshot({ path: screenshot, animations: "disabled" });
  } finally {
    await page.evaluate(() => {
      Reflect.get(window, "__restoreDesktopLinkOpener")();
      Reflect.deleteProperty(window, "__restoreDesktopLinkOpener");
      Reflect.deleteProperty(window, "__desktopLinkOpens");
    });
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
}

/** Exercise the real native opener scope/default browser against a disposable local page. */
export async function verifyNativeLinkLaunch(page: Page) {
  let received = false;
  const server = createServer((request, response) => {
    if (request.url !== "/pi-desktop-link-check") {
      response.writeHead(404).end();
      return;
    }
    received = true;
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Pi Desktop link check</title><p>Native link check complete. This temporary tab can be closed.</p><script>setTimeout(()=>window.close(),100)</script>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local link-check port");
  const url = `http://127.0.0.1:${address.port}/pi-desktop-link-check`;
  console.log("Native external link check:", url);
  try {
    await page.evaluate(async (url) => {
      await Reflect.get(window, "__TAURI_INTERNALS__").invoke(
        "plugin:opener|open_url",
        { url },
      );
    }, url);
    await expect.poll(() => received, { timeout: 15000 }).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
