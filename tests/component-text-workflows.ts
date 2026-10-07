import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyTextSurfaces(page: Page, screenshot: string) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/text-surface-probe" });
  const above = page.locator('[data-extension-widget="surface-above"]');
  const below = page.locator('[data-extension-widget="surface-below"]');
  await expect(above).toHaveText(
    /^\s*Above widget\s+Continued color plain widget\s*$/,
  );
  const aboveStyle = above
    .locator("span")
    .filter({ hasText: "Above widget" })
    .first();
  await expect(aboveStyle).toHaveCSS("color", "rgb(44, 95, 146)");
  await expect(aboveStyle).toHaveCSS("font-style", "italic");
  await expect(above.getByText("plain widget", { exact: true })).toHaveCSS(
    "font-style",
    "normal",
  );
  await expect(below.getByText("Below widget", { exact: true })).toHaveCSS(
    "color",
    "rgb(113, 54, 95)",
  );
  await expect(
    below.getByRole("link", { name: "Widget link", exact: true }),
  ).toHaveAttribute("href", "https://example.com/widget");
  const working = page.locator(".composer-footnote");
  await expect(working.getByText("Working text", { exact: true })).toHaveCSS(
    "color",
    "rgb(31, 82, 133)",
  );
  await page.screenshot({ path: screenshot, animations: "disabled" });
  const openInspector = page.getByRole("button", {
    name: "打开检查器",
    exact: true,
  });
  if (await openInspector.isVisible()) await openInspector.click();
  const status = page.locator('[data-extension-status="surface-text"]');
  await expect(status.getByText("Ready", { exact: true })).toHaveCSS(
    "color",
    "rgb(18, 130, 90)",
  );
  await expect(status.getByText("Ready", { exact: true })).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(status.locator("script")).toHaveCount(0);
  await expect(
    status.getByText("normal <script>status text</script>", { exact: true }),
  ).toHaveCSS("font-weight", "400");
  await expect(
    status.getByRole("link", { name: "Status link", exact: true }),
  ).toHaveAttribute("href", "https://example.com/status");
  await sdkAction(page, "prompt", { message: "/text-surface-probe component" });
  await expect(above).toHaveCount(0);
  await expect(
    page.getByText("Component widget", { exact: true }),
  ).toBeVisible();
  await sdkAction(page, "prompt", { message: "/text-surface-probe update" });
  await expect(page.getByText("Component widget", { exact: true })).toHaveCount(
    0,
  );
  await expect(above).toHaveText("Moved plain widget");
  await expect(below).toHaveCount(0);
  await expect(status.locator("p")).toHaveText("Plain status");
  await expect(status.locator("p span, p a")).toHaveCount(0);
  await expect(working).toContainText("Plain working");
  await expect(working.getByText("Working text", { exact: true })).toHaveCount(
    0,
  );
  await expect
    .poll(async () => {
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      return snapshot.widgetPlacements["surface-above"];
    })
    .toBe("belowEditor");
  await sdkAction(page, "prompt", { message: "/text-surface-probe clear" });
  await expect(status).toHaveCount(0);
  await expect(above).toHaveCount(0);
  await expect(working).not.toContainText("Plain working");
  await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
  await sdkAction(page, "resources.reload");
  await sdkAction(page, "session.new");
  await expect(page.locator("[data-extension-widget]")).toHaveCount(0);
}

export async function verifyComponentText(
  page: Page,
  screenshot: string,
  native = false,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/text-style-probe" });
  const dialog = page.getByRole("dialog");
  const styled = dialog.getByText("Styled message", { exact: true });
  await expect(styled).toHaveCSS("color", "rgb(18, 130, 90)");
  await expect(styled).toHaveCSS("background-color", "rgb(0, 95, 135)");
  await expect(styled).toHaveCSS("font-weight", "700");
  await expect(styled).toHaveCSS("font-style", "italic");
  await expect(styled).toHaveCSS(
    "text-decoration-line",
    "underline line-through",
  );
  await expect(styled.locator("..")).toHaveCSS(
    "background-color",
    "rgb(31, 41, 51)",
  );
  await expect(dialog.locator(".desktop-column").first()).toHaveCSS(
    "background-color",
    "rgb(20, 30, 40)",
  );
  const plain = dialog.getByText("Plain text", { exact: true });
  await expect(plain).toHaveCSS("font-weight", "400");
  await expect(plain).toHaveCSS("font-style", "normal");
  await expect(plain).toHaveCSS("text-decoration-line", "none");
  const reset = dialog.getByText("Reset once", { exact: true });
  await expect(reset).toHaveCSS("font-weight", "400");
  await expect(reset).toHaveCSS("font-style", "normal");
  await expect(reset).toHaveCSS("text-decoration-line", "none");
  const extended = dialog.getByText("Extended underline", { exact: true });
  await expect(extended).toHaveCSS("color", "rgb(10, 20, 30)");
  await expect(extended).toHaveCSS("text-decoration-style", "wavy");
  await expect(extended).toHaveCSS("text-decoration-color", "rgb(255, 0, 0)");
  await expect(extended.locator("..")).toHaveCSS(
    "text-decoration-line",
    "overline line-through",
  );
  await expect(extended.locator("..")).toHaveCSS(
    "text-decoration-style",
    "solid",
  );
  await expect(extended.locator("..")).toHaveCSS(
    "text-decoration-color",
    "rgb(10, 20, 30)",
  );
  await expect(dialog.getByText("Overline", { exact: true })).toHaveCSS(
    "text-decoration-line",
    "overline",
  );
  await expect(dialog.getByText("Plain decoration", { exact: true })).toHaveCSS(
    "text-decoration-line",
    "none",
  );
  const reversed = dialog.getByText("Reverse dim", { exact: true });
  await expect(reversed).toHaveCSS("color", "rgb(31, 41, 51)");
  await expect(reversed).toHaveCSS("opacity", "0.6");
  await expect(dialog.locator("script")).toHaveCount(0);
  await expect(
    dialog.getByText("<script>visible text</script>", { exact: true }),
  ).toBeVisible();
  const link = dialog.getByRole("link", { name: "Pi link", exact: true });
  await expect(link).toHaveAttribute("href", "https://example.com/pi?x=1&y=2");
  await expect(link).toHaveCSS("color", "rgb(23, 45, 67)");
  if (!native) {
    await page.context().route("https://example.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<p>Local link fixture</p>",
      }),
    );
    try {
      const opened = page.waitForEvent("popup");
      await link.click();
      const popup = await opened;
      await expect
        .poll(() => popup.url())
        .toBe("https://example.com/pi?x=1&y=2");
      await popup.close();
    } finally {
      await page.context().unroute("https://example.com/**");
    }
  }
  const truncated = dialog.locator(".desktop-truncated");
  await expect(truncated.locator("span")).toHaveCSS("color", "rgb(255, 0, 0)");
  await expect(truncated).not.toContainText("Hidden second line");
  await expect(truncated).toHaveCSS("text-overflow", "ellipsis");
  const markdown = dialog.locator(".markdown");
  const markdownText = markdown.getByText("Markdown default style", {
    exact: true,
  });
  await expect(markdownText).toHaveCSS("color", "rgb(75, 85, 95)");
  await expect(markdown).toHaveCSS("background-color", "rgb(205, 215, 225)");
  await expect(markdownText).toHaveCSS("font-weight", "700");
  await expect(markdownText).toHaveCSS("font-style", "italic");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  const input = dialog.getByRole("textbox", {
    name: "Text update",
    exact: true,
  });
  await input.fill("Updated by original callback");
  await input.press("Enter");
  await expect(
    dialog.getByText("Updated by original callback", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "确认", exact: true })
    .last()
    .click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "styled-result"
        ],
    )
    .toBe("closed");
}

export async function verifyComponentMarkdown(
  page: Page,
  screenshot: string,
  native = false,
) {
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible();
  await sdkAction(page, "session.new");
  await sdkAction(page, "prompt", { message: "/markdown-style-probe" });
  const dialog = page.getByRole("dialog");
  const markdown = dialog.locator(".desktop-markdown").first();
  const heading = markdown.getByRole("heading", {
    name: "SEMANTIC TITLE",
    exact: true,
  });
  await expect(heading).toBeVisible();
  const headingText = heading.getByText("SEMANTIC TITLE", { exact: true });
  await expect(headingText).toHaveCSS("color", "rgb(18, 130, 90)");
  await expect(headingText).toHaveCSS("font-weight", "700");
  await expect(headingText).toHaveCSS("text-decoration-line", "underline");
  await expect(markdown.getByText("bold", { exact: true })).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(markdown.getByText("inline", { exact: true })).toHaveCSS(
    "color",
    "rgb(44, 55, 66)",
  );
  await expect(markdown.getByText("strike", { exact: true })).toHaveCSS(
    "text-decoration-line",
    "line-through",
  );
  await expect(markdown.getByText("Inline ANSI", { exact: true })).toHaveCSS(
    "color",
    "rgb(21, 43, 65)",
  );
  await expect(markdown.locator("blockquote")).toHaveCSS(
    "border-left-color",
    "rgb(101, 102, 103)",
  );
  await expect(markdown.getByText("Quote", { exact: true })).toHaveCSS(
    "color",
    "rgb(77, 88, 99)",
  );
  await expect(markdown.getByText("nested", { exact: true })).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(markdown.locator("ol")).toHaveAttribute("start", "7");
  await expect(markdown.locator(".desktop-markdown-marker").first()).toHaveText(
    "7) ",
  );
  await expect(
    markdown.locator(".desktop-markdown-marker").first().locator("span"),
  ).toHaveCSS("color", "rgb(104, 105, 106)");
  await expect(markdown.getByRole("columnheader", { name: "Other" })).toHaveCSS(
    "text-align",
    "right",
  );
  await expect(markdown.getByRole("cell", { name: "Value" })).toHaveCSS(
    "text-align",
    "right",
  );
  await expect(markdown.getByText("LET VALUE = 1;", { exact: true })).toHaveCSS(
    "color",
    "rgb(113, 114, 115)",
  );
  await expect(markdown.locator("code")).toHaveAttribute("data-language", "js");
  await expect(markdown.locator("hr")).toHaveCSS(
    "border-top-color",
    "rgb(107, 108, 109)",
  );
  await expect(markdown.getByText("\u03b1", { exact: true })).toBeVisible();
  await expect(markdown.locator("script")).toHaveCount(0);
  await expect(
    markdown.getByText("<script>literal markdown</script>", { exact: true }),
  ).toBeVisible();
  const defaults = dialog.locator(".desktop-markdown").last();
  await expect(defaults.getByText("Default", { exact: true })).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(defaults.getByText("Default", { exact: true })).toHaveCSS(
    "font-style",
    "italic",
  );
  await expect(defaults.getByText("reset code", { exact: true })).toHaveCSS(
    "font-weight",
    "400",
  );
  await expect(defaults.getByText("reset code", { exact: true })).toHaveCSS(
    "font-style",
    "normal",
  );
  await expect(defaults.getByText("restored", { exact: true })).toHaveCSS(
    "font-weight",
    "700",
  );
  const link = markdown.getByRole("link", { name: "Clickable", exact: true });
  await expect(link).toHaveAttribute("href", "https://example.com/markdown");
  await expect(link).toHaveCSS("color", "rgb(23, 45, 67)");
  if (!native) {
    await page.context().route("https://example.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<p>Local Markdown link fixture</p>",
      }),
    );
    try {
      const opened = page.waitForEvent("popup");
      await link.click();
      const popup = await opened;
      await expect.poll(() => popup.url()).toBe("https://example.com/markdown");
      await popup.close();
    } finally {
      await page.context().unroute("https://example.com/**");
    }
  }
  await page.screenshot({ path: screenshot, animations: "disabled" });
  const input = dialog.getByRole("textbox", {
    name: "Markdown update",
    exact: true,
  });
  await input.fill("Original Markdown callback");
  await input.press("Enter");
  await expect(
    markdown.getByRole("heading", {
      name: "Original Markdown callback",
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "确认", exact: true })
    .last()
    .click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "markdown-result"
        ],
    )
    .toBe("closed");
}
