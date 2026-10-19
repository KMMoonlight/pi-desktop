import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("custom providers import model lists, preserve edits on refresh and errors, and only persist on save", async ({
  page,
}) => {
  let status = 200;
  const authorizations: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    authorizations.push(req.headers.authorization);
    if (req.url !== "/gateway/v1/models") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          { id: "remote-a", name: "Remote A" },
          { id: "remote-b" },
          { id: "remote-c" },
          { id: "remote-d" },
          { id: "remote-a" },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/gateway/v1/`;
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const original = await sdkAction<string>(page, "config.read", {
    name: "models.json",
  });
  try {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings
      .getByRole("button", { name: "模型与账号", exact: true })
      .click();
    await settings
      .getByRole("button", { name: "添加自定义端点", exact: true })
      .click();
    const form = settings.locator(".custom-provider-form");
    const fetchModels = form.getByRole("button", {
      name: "从 API 获取模型",
      exact: true,
    });
    await form
      .getByRole("textbox", { name: "提供商 ID", exact: true })
      .fill("ui-discovered");
    await form
      .getByRole("textbox", { name: "API 地址", exact: true })
      .fill("bad-url");
    await fetchModels.click();
    await expect(settings.getByRole("alert")).toContainText("HTTP 或 HTTPS");
    await expect(
      form.getByRole("textbox", { name: "模型 ID", exact: true }),
    ).toHaveValue("");
    await form
      .getByRole("textbox", { name: "API 地址", exact: true })
      .fill(url);
    await form
      .getByRole("textbox", { name: "API Key 或环境变量", exact: true })
      .fill("discovery-key");
    await fetchModels.click();
    await expect(form.getByRole("status")).toHaveText(
      "已获取 4 个模型，保存端点后生效。",
    );
    await expect(form.locator(".provider-model-fields")).toHaveCount(0);
    await form
      .getByRole("button", { name: "展开 4 个模型的配置", exact: true })
      .click();
    await expect
      .poll(() =>
        form
          .getByRole("textbox", { name: "模型 ID", exact: true })
          .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value),
          ),
      )
      .toEqual(["remote-a", "remote-b", "remote-c", "remote-d"]);
    await form
      .getByRole("textbox", { name: "显示名称", exact: true })
      .first()
      .fill("My custom name");
    await form
      .getByRole("spinbutton", { name: "上下文长度", exact: true })
      .first()
      .fill("65536");
    await fetchModels.click();
    await expect(form.getByRole("status")).toHaveText(
      "已获取 4 个模型，保存端点后生效。",
    );
    await expect(form.locator(".provider-model-fields")).toHaveCount(4);
    await expect(
      form.getByRole("textbox", { name: "显示名称", exact: true }).first(),
    ).toHaveValue("My custom name");
    await expect(
      form.getByRole("spinbutton", { name: "上下文长度", exact: true }).first(),
    ).toHaveValue("65536");
    expect(await sdkAction(page, "config.read", { name: "models.json" })).toBe(
      original,
    );
    await form
      .getByRole("button", { name: "收起模型配置", exact: true })
      .click();
    await mkdir(".local/provider-discovery", { recursive: true });
    await page.screenshot({ path: ".local/provider-discovery/imported.png" });
    await form.getByRole("button", { name: "保存端点", exact: true }).click();
    await expect(form).toHaveCount(0);
    const saved = await sdkAction<string>(page, "config.read", {
      name: "models.json",
    });
    const provider = JSON.parse(saved).providers["ui-discovered"];
    expect(provider.models).toEqual([
      { id: "remote-a", name: "My custom name", contextWindow: 65536 },
      { id: "remote-b" },
      { id: "remote-c" },
      { id: "remote-d" },
    ]);
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(
      snapshot.models.filter(
        (model) => model.provider === "ui-discovered" && model.available,
      ),
    ).toHaveLength(4);
    await settings
      .getByRole("button", { name: "编辑端点 ui-discovered", exact: true })
      .click();
    status = 401;
    await fetchModels.click();
    await expect(settings.getByRole("alert")).toContainText("HTTP 401");
    await form
      .getByRole("button", { name: "展开 4 个模型的配置", exact: true })
      .click();
    await expect(
      form.getByRole("textbox", { name: "显示名称", exact: true }).first(),
    ).toHaveValue("My custom name");
    await form.getByRole("button", { name: "取消编辑", exact: true }).click();
    expect(await sdkAction(page, "config.read", { name: "models.json" })).toBe(
      saved,
    );
    status = 200;
    await settings
      .getByRole("button", { name: "添加自定义端点", exact: true })
      .click();
    await form
      .getByRole("textbox", { name: "提供商 ID", exact: true })
      .fill("ui-cancelled");
    await form
      .getByRole("textbox", { name: "API 地址", exact: true })
      .fill(url);
    await form
      .getByRole("textbox", { name: "API Key 或环境变量", exact: true })
      .fill("discovery-key");
    await fetchModels.click();
    await expect(form.getByRole("status")).toContainText("4 个模型");
    await form.getByRole("button", { name: "取消编辑", exact: true }).click();
    expect(await sdkAction(page, "config.read", { name: "models.json" })).toBe(
      saved,
    );
    expect(authorizations).toEqual(Array(4).fill("Bearer discovery-key"));
  } finally {
    await sdkAction(page, "config.save", {
      name: "models.json",
      content: original,
    });
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
