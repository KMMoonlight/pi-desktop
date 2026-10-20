import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("custom providers import model lists, preserve edits on refresh and errors, and only persist on save", async ({
  page,
}) => {
  let status = 200;
  let refreshed = false;
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
          {
            id: "remote-a",
            name: "Remote A",
            context_length: 128000,
            top_provider: { max_completion_tokens: 8192 },
            architecture: { input_modalities: ["text", "image"] },
            supported_parameters: ["tools", "reasoning"],
            reasoning: { supported_efforts: ["none", "low", "high"] },
            thinkingLevelMap: {
              off: "none",
              minimal: null,
              low: "8192",
              medium: null,
              high: "high_effort",
              xhigh: null,
              max: null,
            },
            compat: {
              supportsReasoningEffort: true,
              supportsStrictMode: true,
              supportsStrictTools: true,
            },
          },
          {
            id: "remote-b",
            thinkingLevelMap: refreshed
              ? {
                  low: "low",
                  medium: "medium_effort",
                  high: "high_effort",
                  xhigh: "maximum",
                }
              : { low: "custom_low", high: null },
            ...(refreshed
              ? { contextWindow: 32000, supportsTools: false }
              : {}),
          },
          {
            id: "remote-c",
            capabilities: [],
            compat: { supportsReasoningEffort: false },
          },
          {
            id: "remote-d",
            supported_parameters: [],
            reasoning: true,
            thinkingLevelMap: {
              off: null,
              minimal: null,
              low: null,
              medium: null,
              high: null,
              xhigh: null,
              max: null,
            },
          },
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
    const firstModel = form.locator(".provider-model-fields").first();
    await expect(
      firstModel.getByRole("spinbutton", { name: "上下文长度", exact: true }),
    ).toHaveValue("128000");
    await expect(
      firstModel.getByRole("spinbutton", {
        name: "最大输出 tokens",
        exact: true,
      }),
    ).toHaveValue("8192");
    await expect(
      firstModel.getByRole("switch", { name: "支持思考", exact: true }),
    ).toBeChecked();
    await expect(
      firstModel.getByLabel("工具调用（接口声明）", { exact: true }),
    ).toHaveText("支持");
    await expect(
      firstModel.getByText("推理强度参数 · 严格参数模式 · 严格工具模式", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      form
        .locator(".provider-model-fields")
        .nth(2)
        .locator(".provider-model-tools small"),
    ).toHaveCount(0);
    for (const index of [2, 3]) {
      await expect(
        form
          .locator(".provider-model-fields")
          .nth(index)
          .getByLabel("工具调用（接口声明）", { exact: true }),
      ).toHaveText("未声明");
    }
    const zeroLevels = form.locator(".provider-model-fields").nth(3);
    await expect(
      zeroLevels.getByRole("checkbox", { checked: true }),
    ).toHaveCount(0);
    await expect(zeroLevels.locator(".provider-thinking-note")).toBeVisible();
    await form.getByRole("button", { name: "保存端点", exact: true }).click();
    await expect(settings.getByRole("alert")).toHaveText(
      "支持思考的模型至少需要一个可用档位",
    );
    await zeroLevels
      .getByRole("checkbox", { name: "关闭", exact: true })
      .check();
    await expect(
      firstModel.getByRole("checkbox", { name: "low", exact: true }),
    ).toBeChecked();
    await expect(
      firstModel.getByRole("checkbox", { name: "high", exact: true }),
    ).toBeChecked();
    await expect(
      firstModel.getByRole("checkbox", { name: "medium", exact: true }),
    ).not.toBeChecked();
    await expect(
      firstModel.getByRole("checkbox", { name: "xhigh", exact: true }),
    ).not.toBeChecked();
    await mkdir(".local/provider-discovery", { recursive: true });
    await firstModel.screenshot({
      path: ".local/provider-discovery/capabilities.png",
    });
    await firstModel
      .getByRole("checkbox", { name: "high", exact: true })
      .uncheck();
    await firstModel
      .getByRole("checkbox", { name: "关闭", exact: true })
      .uncheck();
    await expect(
      firstModel.getByRole("checkbox", { name: "low", exact: true }),
    ).toBeDisabled();
    await expect(
      firstModel.getByText(
        "至少保留一个思考档位；如需停用思考，请关闭“支持思考”。",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      firstModel.locator(".provider-thinking-levels"),
    ).toHaveAttribute("aria-describedby", "model-thinking-note-0");
    await firstModel
      .getByRole("checkbox", { name: "关闭", exact: true })
      .check();
    await form
      .getByRole("textbox", { name: "显示名称", exact: true })
      .first()
      .fill("My custom name");
    await form
      .getByRole("spinbutton", { name: "上下文长度", exact: true })
      .first()
      .fill("65536");
    refreshed = true;
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
    await expect(
      firstModel.getByRole("checkbox", { name: "high", exact: true }),
    ).not.toBeChecked();
    const secondModel = form.locator(".provider-model-fields").nth(1);
    await expect(
      secondModel.getByRole("spinbutton", { name: "上下文长度", exact: true }),
    ).toHaveValue("32000");
    await expect(
      secondModel.getByLabel("工具调用（接口声明）", { exact: true }),
    ).toHaveText("不支持");
    await expect(
      secondModel.getByRole("checkbox", { name: "xhigh", exact: true }),
    ).toBeChecked();
    await expect(
      secondModel.getByRole("checkbox", { name: "high", exact: true }),
    ).not.toBeChecked();
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
    let saved = await sdkAction<string>(page, "config.read", {
      name: "models.json",
    });
    const provider = JSON.parse(saved).providers["ui-discovered"];
    expect(provider.models).toEqual([
      {
        id: "remote-a",
        name: "My custom name",
        contextWindow: 65536,
        maxTokens: 8192,
        input: ["text", "image"],
        reasoning: true,
        supportsTools: true,
        thinkingLevelMap: {
          off: "none",
          minimal: null,
          low: "8192",
          medium: null,
          high: null,
          xhigh: null,
          max: null,
        },
        disabledThinkingLevelMap: { high: "high_effort" },
        compat: {
          supportsReasoningEffort: true,
          supportsStrictMode: true,
          supportsStrictTools: true,
        },
      },
      {
        id: "remote-b",
        reasoning: true,
        contextWindow: 32000,
        supportsTools: false,
        thinkingLevelMap: {
          low: "custom_low",
          medium: "medium_effort",
          high: null,
          xhigh: "maximum",
        },
      },
      { id: "remote-c", compat: { supportsReasoningEffort: false } },
      {
        id: "remote-d",
        reasoning: true,
        thinkingLevelMap: {
          off: "none",
          minimal: null,
          low: null,
          medium: null,
          high: null,
          xhigh: null,
          max: null,
        },
      },
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
    await settings
      .getByRole("button", { name: "编辑端点 ui-discovered", exact: true })
      .click();
    await form
      .getByRole("button", { name: "展开 4 个模型的配置", exact: true })
      .click();
    await firstModel
      .getByRole("checkbox", { name: "high", exact: true })
      .check();
    await form.getByRole("button", { name: "保存端点", exact: true }).click();
    await expect(form).toHaveCount(0);
    saved = await sdkAction<string>(page, "config.read", {
      name: "models.json",
    });
    const restored = JSON.parse(saved).providers["ui-discovered"].models[0];
    expect(restored.thinkingLevelMap.high).toBe("high_effort");
    expect(restored.disabledThinkingLevelMap).toBeUndefined();
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
