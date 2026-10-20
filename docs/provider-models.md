# 自定义模型导入

在自定义端点中点击「从 API 获取模型」，会请求 API 地址下的 `/models`。响应需要包含 `data` 数组，每个模型必须有非空字符串 `id`。以下字段会在保存端点后生效：

```json
{
  "data": [{
    "id": "example-chat",
    "name": "Example Chat",
    "contextWindow": 128000,
    "maxTokens": 16384,
    "reasoning": true,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "input": ["text", "image"],
    "supportsTools": true,
    "compat": { "supportsStrictMode": true }
  }]
}
```

| 信息 | SDK 原生字段 | 兼容的字段 |
| --- | --- | --- |
| 模型标识、名称 | `id`、`name` | — |
| 上下文长度 | `contextWindow` | `context_length`、`context_window`、`max_context_length`、`max_model_len`、`limit.context`、`top_provider.context_length` |
| 最大输出 tokens | `maxTokens` | `max_output_tokens`、`max_completion_tokens`、`max_tokens`、`limit.output`、`top_provider.max_completion_tokens` |
| 思考能力 | `reasoning` | `supportsReasoning`、`supports_reasoning`、`capabilities.reasoning`、`capabilities` 中的 `reasoning`，以及 `supported_parameters` 中的 `reasoning`、`reasoning_effort` 或 `include_reasoning` |
| 思考档位 | `thinkingLevelMap` | `supported_thinking_levels`、`thinking_levels`、`supported_reasoning_efforts`、`reasoning_efforts`、`reasoning.supported_efforts` |
| 视觉输入 | `input` | `input_modalities`、`architecture.input_modalities`、`vision`、`supportsVision`、`supports_vision`、`capabilities.vision`、`capabilities` 中的 `vision` |
| 工具调用声明 | `supportsTools`（桌面端元数据） | `supports_tools`、`tool_calling`、`supports_function_calling`、布尔值 `tools`、`capabilities.tools` / `capabilities.tool_calling`，能力数组中的 `tools` / `tool_calling` / `function_calling`，以及 `supported_parameters` 中的 `tools` / `tool_choice` / `functions` |

原生字段优先；长度只接受正的安全整数或纯数字字符串。输入模态接受数组及单个字符串，只保留当前 SDK 支持的 `text` 和 `image`。前端思考档位使用轻量字面量，通过 SDK 类型约束和回归测试与 `MODEL_THINKING_LEVELS`、`getSupportedThinkingLevels` 保持一致，避免加载 SDK 的 TypeBox schema。完整思考档位列表会转为 SDK 的 `thinkingLevelMap`，未列出的档位设为 `null`；`none` 对应界面的「关闭」。原生映射中的空缺保留 SDK 默认行为，`null` 表示不支持。

界面可以调整支持的档位。取消勾选自定义映射时，桌面端会在 `disabledThinkingLevelMap` 中记住原始值；重新勾选时恢复，保存并重新打开后也会保留。该字段是随模型配置保存的可选桌面端元数据，不控制 SDK 的思考行为；SDK 仍使用 `thinkingLevelMap`。其他工具重写 `models.json` 时如果清理了该字段，模型配置仍有效，但恢复自定义值的记忆会丢失。刷新端点不会替换已有记忆值；如需采用端点的新映射，需要修改配置，或移除该模型后重新导入。支持思考的模型在界面中至少保留一个思考档位；零个或仅剩一个档位时均显示说明，零档位必须先选择有效档位或关闭「支持思考」才能保存。

工具声明在界面中只读显示为「支持 / 不支持 / 未声明」，作为能力信息保存；当前 SDK 没有通用的工具禁用开关。空数组或能力列表中没有工具相关字段时，仍视为「未声明」；只有明确的布尔值 `false` 才表示「不支持」。思考、视觉能力和 token 限制可以在界面补充。`compat` 中只导入 SDK 支持的布尔选项：`supportsReasoningEffort`、`supportsStrictMode`、`supportsStrictTools`、`supportsOpenAIGrammarTools`、`supportsToolSearch`、`supportsAdditionalTools`。界面仅列出启用的兼容选项；其中 `supportsReasoningEffort` 显示为「推理强度参数」，`supportsStrictMode` 和 `supportsStrictTools` 分别显示为「严格参数模式」和「严格工具模式」。这些选项会交给所选 API 协议处理。

重新获取只补齐已有模型缺少的字段，并追加新模型；`thinkingLevelMap` 和 `compat` 逐项合并，已有映射（包括表示禁用的 `null`）和工具兼容选项优先，缺少的键从接口补齐。已有名称、token 限制和视觉设置也优先。接口缺少字段时不猜测模型能力，不会把推断值写入配置；运行时对缺失字段仍采用 SDK 默认值。无效的附加字段会被忽略，不影响有效模型的导入。远端模型上的 API 地址、协议、凭据、请求头和任意请求参数不会导入。

保存后的 `null` 不区分来自接口还是用户操作，刷新时都会保留。因此端点后来新增的档位不会自动启用；需要手动启用并确认映射值，或移除该模型后重新导入，以采用端点的完整新定义。

OpenRouter 字段格式参考：[List all models and their properties](https://openrouter.ai/docs/api/api-reference/models/get-models)。
