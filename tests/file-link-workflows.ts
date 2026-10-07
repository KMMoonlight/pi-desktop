import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types";

export async function verifyFileLinks(
  page: Page,
  screenshot: string,
  native = false,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(snapshot.cwd, "中文 file #1%.txt");
  await writeFile(path, "Native file opener fixture");
  const url = pathToFileURL(path).href;
  await sdkAction(page, "prompt", { message: `/file-link-probe ${url}` });
  const dialog = page.getByRole("dialog");
  if (native)
    await page.evaluate(() => {
      const opened: string[] = [];
      const original = window.fetch;
      window.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (
          url.hostname === "ipc.localhost" &&
          decodeURIComponent(url.pathname) === "/plugin:opener|open_path"
        ) {
          opened.push(JSON.parse(String(init?.body)).path);
          return new Response(
            JSON.stringify(
              opened.length === 1 ? "File handler unavailable" : null,
            ),
            {
              headers: {
                "Content-Type": "application/json",
                "Tauri-Response": opened.length === 1 ? "error" : "ok",
              },
            },
          );
        }
        return original.call(window, input, init);
      };
      if (window.fetch === original)
        throw new Error("File opener interceptor was not installed");
      Reflect.set(window, "__fileLinkOpens", opened);
      Reflect.set(window, "__restoreFileLinkOpener", () => {
        window.fetch = original;
      });
    });
  try {
    for (const name of ["Text file", "Markdown file"])
      await expect(
        dialog.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", url);
    await dialog.getByRole("link", { name: "Text file", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      native ? "File handler unavailable" : "文件链接需要在桌面应用中打开",
    );
    if (native) {
      await dialog
        .getByRole("link", { name: "Text file", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
    }
    await dialog
      .getByRole("link", { name: "Markdown file", exact: true })
      .click();
    if (native)
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, "__fileLinkOpens")))
        .toEqual([path, path, path]);
    else await expect(dialog.getByRole("alert")).toHaveCount(2);
    await page.screenshot({ path: screenshot, animations: "disabled" });
  } finally {
    if (native)
      await page.evaluate(() => {
        Reflect.get(window, "__restoreFileLinkOpener")();
        Reflect.deleteProperty(window, "__restoreFileLinkOpener");
        Reflect.deleteProperty(window, "__fileLinkOpens");
      });
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await sdkAction(page, "message.custom", {
    customType: "file-link-proof",
    content: `[Transcript file](${url})`,
  });
  const transcriptLink = page.getByRole("link", {
    name: "Transcript file",
    exact: true,
  });
  await expect(transcriptLink).toHaveAttribute("href", url);
  await transcriptLink.click();
  await expect(page.locator(".file-preview")).toContainText(
    "Native file opener fixture",
  );
  await page.getByRole("button", { name: "关闭文件面板", exact: true }).click();
  await sdkAction(page, "message.custom", {
    customType: "link-state-refresh",
    content: "Unrelated conversation update",
  });
  await expect(
    page.getByText("Unrelated conversation update", { exact: true }),
  ).toBeVisible();
  await transcriptLink.click();
  await expect(page.locator(".file-preview")).toContainText(
    "Native file opener fixture",
  );
  await page.getByRole("button", { name: "关闭文件面板", exact: true }).click();
}

export async function verifyNativeFileLinkLaunch(page: Page) {
  let received = false;
  const server = createServer((request, response) => {
    if (request.url === "/file-opened") received = true;
    response
      .writeHead(200, { "Content-Type": "text/html" })
      .end(
        "<!doctype html><title>Pi Desktop file check complete</title><p>File check complete.</p><script>setTimeout(()=>window.close(),100)</script>",
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing file-open check port");
  try {
    await sdkAction(page, "session.new");
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const path = join(snapshot.cwd, "中文 file #1%.html");
    await writeFile(
      path,
      `<!doctype html><title>Pi Desktop file link check</title><script>location.replace("http://127.0.0.1:${address.port}/file-opened")</script>`,
    );
    await sdkAction(page, "prompt", {
      message: `/file-link-probe ${pathToFileURL(path).href}`,
    });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("link", { name: "Text file", exact: true }).click();
    await expect.poll(() => received, { timeout: 15000 }).toBe(true);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog).toBeHidden();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
