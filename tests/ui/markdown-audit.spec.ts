import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows";
import type { DesktopSnapshot } from "../../shared/types";

const source = [
  "# 一级标题",
  "## 二级标题",
  "### 附赠资源详情",
  "#### 四级标题",
  "##### 五级标题",
  "###### 六级标题",
  "",
  "**粗体 *嵌套斜体***、~~删除线~~、`const inline = 1`、\\*转义星号\\*。",
  "",
  "- **视频教程**：3 个实战演示，复杂表单界面与数据仪表盘。",
  "- **组件画廊**：200+ 组件样式，这是一段会在较窄窗口换行的中文说明，换行后应该与本条文字保持一致的左侧对齐。",
  "  - 子列表",
  "    1. 嵌套有序列表",
  "- **字体推荐**：30+ 字体，分为 UI / 标题 / 正文三类。",
  "",
  "9. 第九项",
  "10. 第十项",
  "",
  "- [x] 已完成",
  "- [ ] 待完成",
  "",
  "> 引用段落 **加粗**",
  ">",
  "> - 引用内列表",
  ">   - 嵌套引用列表",
  "",
  "| 左对齐 | 居中 | 右对齐 |",
  "| :--- | :---: | ---: |",
  "| 转义 a\\|b | `table code` | ~~删除~~ |",
  "",
  "[**文档 `name`**][docs]，自动链接 <https://example.com/auto>，邮箱 <support@example.com>。",
  "",
  "[docs]: https://example.com/docs?a=1&amp;b=2",
  "",
  "实体：&amp; &lt;b&gt; &#x1F600; &amp;amp;",
  "",
  "第一行  ",
  "硬换行",
  "",
  "<script>literal HTML</script>",
  "",
  "~~~js",
  "const literal = '&amp; **code**';",
  "console.log(literal);",
  "~~~",
  "",
  "    indented code",
  "    second line",
  "",
  "---",
  "",
  "![Markdown 图片](http://127.0.0.1:1540/markdown-audit.png)",
  "",
  "![工作区图片](./markdown-audit.png)",
].join("\n");

test("fallback Markdown retains list markers, task states and subtle rules after Tailwind reset", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const rootPath = "/node_modules/.vite/deps/react-dom_client.js";
    const markdownPath = "/src/Messages.tsx";
    const [react, dom, markdown] = await Promise.all([import(reactPath), import(rootPath), import(markdownPath)]);
    const host = document.createElement("section");
    host.id = "markdown-fallback-audit";
    host.className = "markdown";
    document.body.appendChild(host);
    (dom.createRoot ?? dom.default.createRoot)(host).render((react.createElement ?? react.default.createElement)(markdown.Markdown, { text: "- Bullet\n\n9. Ordered\n\n- [x] Checked\n\n---\n\n`inline`" }));
  });
  const body = page.locator("#markdown-fallback-audit");
  await expect(body.locator("ul").first()).toHaveCSS("list-style-type", "disc");
  await expect(body.locator("ol")).toHaveCSS("list-style-type", "decimal");
  await expect(body.getByRole("checkbox")).toBeChecked();
  await expect(body.locator("hr")).toHaveCSS("border-top-width", "1px");
  expect(await body.locator("hr").evaluate(node => getComputedStyle(node).borderTopColor)).not.toBe("rgb(20, 20, 19)");
});

for (const { width, theme, mono } of [
  { width: 1440, theme: "light", mono: false },
  { width: 1024, theme: "dark", mono: true },
  { width: 760, theme: "light", mono: true },
])
  test(`Markdown semantic rendering, wrapping and persistence at ${width}px ${theme}`, async ({
    page,
    context,
  }) => {
    await mkdir(".local/markdown-audit", { recursive: true });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const image = await readFile("src-tauri/icons/128x128.png");
    await page.route("**/markdown-audit.png", (route) =>
      route.fulfill({ body: image, contentType: "image/png" }),
    );
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).changing).toBe(false);
    await sdkAction(page, "session.new");
    await sdkAction(page, "theme.set", { theme });
    await page.evaluate(async (mono) => {
      const modulePath = "/src/fonts.ts";
      const fonts = await import(modulePath);
      fonts.setFontPreference("interface", mono ? "Courier New" : "");
    }, mono);
    const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
    await writeFile(join(initial.cwd, "markdown-audit.png"), image);
    const seed = join(initial.agentDir, "desktop", "markdown-audit.mjs");
    await writeFile(
      seed,
      `export default ({session}, args) => {
    session.sessionManager.appendMessage({role: "user", content: "检查 Markdown", timestamp: Date.now()});
    session.sessionManager.appendMessage({role: "assistant", content: [{type: "text", text: args.source}], api: "openai-completions", provider: "desktop-test", model: "desktop-test", stopReason: "stop", timestamp: Date.now(), usage: {input:1, output:1, cacheRead:0, cacheWrite:0, totalTokens:2, cost:{input:0, output:0, cacheRead:0, cacheWrite:0, total:0}}});
    session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
  };`,
    );
    await sdkAction(page, "sdk.run", { path: seed, args: { source } });
    const body = page
      .locator(".message-assistant .message-body > .desktop-markdown")
      .last();
    await expect(body.getByRole("heading")).toHaveCount(6);
    await expect(
      body.getByRole("heading", { name: "附赠资源详情", exact: true }),
    ).toBeVisible();
    await expect(body).not.toContainText("###");
    await expect(body.locator(".desktop-markdown-marker").first()).toHaveText(
      "•",
    );
    const ordered = body.locator("ol").filter({ hasText: "第九项" });
    const aligned = await ordered
      .locator(":scope > li > div")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().left),
      );
    expect(Math.max(...aligned) - Math.min(...aligned)).toBeLessThan(1);
    await expect(ordered).toHaveAttribute("start", "9");
    await expect(ordered.locator(".desktop-markdown-marker").last()).toHaveText(
      "10.",
    );
    await ordered.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/markdown-audit/${width}-${theme}-lists.png` });
    await expect(
      body.getByRole("checkbox", { name: "已完成", exact: true }),
    ).toBeChecked();
    await expect(
      body.getByRole("checkbox", { name: "待完成", exact: true }),
    ).not.toBeChecked();
    await expect(body.getByRole("checkbox").first()).toBeDisabled();
    await expect(body.locator("blockquote ul ul")).toHaveCount(1);
    await expect(body.locator("td").nth(0)).toHaveText("转义 a|b");
    await expect(body.locator("td").nth(1)).toHaveCSS("text-align", "center");
    await expect(body.locator("td").nth(2)).toHaveCSS("text-align", "right");
    await expect(body.locator("td code")).toHaveText("table code");
    await expect(body.locator("a code")).toHaveText("name");
    await expect(body.locator("a").first()).toHaveAttribute(
      "href",
      "https://example.com/docs?a=1&b=2",
    );
    await expect(body).not.toContainText("(https://example.com/docs");
    await expect(body).toContainText("实体：& <b> 😀 &amp;");
    await expect(body).toContainText("<script>literal HTML</script>");
    await expect(body.locator("script")).toHaveCount(0);
    const code = body.locator("code[data-language='js']");
    await expect(code).toContainText("const literal = '&amp; **code**';");
    await code.scrollIntoViewIfNeeded();
    await code
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "复制 js 代码", exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "const literal = '&amp; **code**';\nconsole.log(literal);",
    );
    await page.screenshot({ path: `.local/markdown-audit/${width}-${theme}-code.png` });
    const thumbnail = body.getByRole("button", {
      name: "放大查看 Markdown 图片",
      exact: true,
    });
    await thumbnail.click();
    await expect(
      page.getByRole("dialog", { name: "图片预览", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const localThumbnail = body.getByRole("button", {
      name: "放大查看 工作区图片",
      exact: true,
    });
    await expect(localThumbnail.locator("img")).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/,
    );
    await localThumbnail.click();
    await expect(
      page.getByRole("dialog", { name: "图片预览", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await body.getByRole("heading").first().scrollIntoViewIfNeeded();
    const overflow = await body.evaluate(
      (node) => node.scrollWidth - node.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `.local/markdown-audit/${width}-${theme}-top.png`,
    });
    await body.locator("table").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.local/markdown-audit/${width}-${theme}-bottom.png`,
    });
    await page.reload();
    await expect(body.locator("td code")).toHaveText("table code");
    await expect(
      body.getByRole("checkbox", { name: "已完成", exact: true }),
    ).toBeChecked();
    const restored = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(restored.messages.at(-1)?.content[0].text).toBe(source);
    await page.evaluate(async () => {
      const modulePath = "/src/fonts.ts";
      const fonts = await import(modulePath);
      fonts.setFontPreference("interface", "");
    });
  });
