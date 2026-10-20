import {
  modelThinkingLevels,
  type DiscoveredProviderModel,
} from "../shared/types.ts";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value.map((item) => item.trim()).filter(Boolean)
    : undefined;
const boolean = (...values: unknown[]): boolean | undefined =>
  values.find((value) => typeof value === "boolean") as boolean | undefined;
function tokens(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number =
      typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value)
        : value;
    if (
      typeof number === "number" &&
      Number.isSafeInteger(number) &&
      number > 0
    )
      return number;
  }
}

// Only copy inert model metadata. Never import remote URLs, auth, headers,
// request parameters, or arbitrary compatibility/routing objects.
export function providerModelMetadata(
  item: Record<string, unknown>,
): Omit<DiscoveredProviderModel, "id" | "name"> {
  const result: Omit<DiscoveredProviderModel, "id" | "name"> = {};
  const architecture = object(item.architecture);
  const limits = object(item.limit);
  const topProvider = object(item.top_provider);
  const capabilities = object(item.capabilities);
  const capabilityNames = strings(item.capabilities);
  const parameters = strings(item.supported_parameters);
  const contextWindow = tokens(
    item.contextWindow,
    item.context_length,
    item.context_window,
    item.max_context_length,
    item.max_model_len,
    limits.context,
    topProvider.context_length,
  );
  const maxTokens = tokens(
    item.maxTokens,
    item.max_output_tokens,
    item.max_completion_tokens,
    item.max_tokens,
    limits.output,
    topProvider.max_completion_tokens,
  );
  if (contextWindow !== undefined) result.contextWindow = contextWindow;
  if (maxTokens !== undefined) result.maxTokens = maxTokens;

  const input = [
    item.input,
    item.input_modalities,
    architecture.input_modalities,
  ]
    .map((value) => strings(typeof value === "string" ? [value] : value))
    .find((value) =>
      value?.some((modality) => modality === "text" || modality === "image"),
    );
  const vision = boolean(
    item.vision,
    item.supportsVision,
    item.supports_vision,
    capabilities.vision,
    capabilityNames?.includes("vision") || undefined,
  );
  if (input)
    result.input = [
      ...new Set(
        input.filter(
          (value): value is "text" | "image" =>
            value === "text" || value === "image",
        ),
      ),
    ];
  else if (vision !== undefined)
    result.input = vision ? ["text", "image"] : ["text"];

  const nativeMap = object(item.thinkingLevelMap);
  const thinkingLevelMap: NonNullable<
    DiscoveredProviderModel["thinkingLevelMap"]
  > = {};
  for (const level of modelThinkingLevels) {
    const value = nativeMap[level];
    if (value === null || (typeof value === "string" && value.trim()))
      thinkingLevelMap[level] = typeof value === "string" ? value.trim() : null;
  }
  if (!Object.keys(thinkingLevelMap).length) {
    const efforts = [
      item.supported_thinking_levels,
      item.thinking_levels,
      item.supported_reasoning_efforts,
      item.reasoning_efforts,
      object(item.reasoning).supported_efforts,
    ]
      .map(strings)
      .find((value) =>
        value?.some(
          (effort) =>
            effort === "none" ||
            modelThinkingLevels.includes(
              effort as (typeof modelThinkingLevels)[number],
            ),
        ),
      );
    if (efforts) {
      for (const level of modelThinkingLevels)
        thinkingLevelMap[level] = efforts.includes(level)
          ? level
          : level === "off" && efforts.includes("none")
            ? "none"
            : null;
    }
  }
  if (Object.keys(thinkingLevelMap).length)
    result.thinkingLevelMap = thinkingLevelMap;
  const reasoning = boolean(
    item.reasoning,
    item.supportsReasoning,
    item.supports_reasoning,
    capabilities.reasoning,
    Object.entries(thinkingLevelMap).some(
      ([level, value]) => level !== "off" && value !== null,
    ) || undefined,
    parameters?.some((parameter) =>
      ["reasoning", "reasoning_effort", "include_reasoning"].includes(
        parameter,
      ),
    ) || undefined,
    capabilityNames?.includes("reasoning") || undefined,
  );
  if (reasoning !== undefined) result.reasoning = reasoning;

  const supportsTools = boolean(
    item.supportsTools,
    item.supports_tools,
    item.tool_calling,
    item.supports_function_calling,
    item.tools,
    capabilities.tools,
    capabilities.tool_calling,
    // Positive evidence is useful even for partial capability lists. Absence
    // (including an empty list) is not an explicit declaration of no tools.
    capabilityNames?.some((name) =>
      ["tools", "tool_calling", "function_calling"].includes(name),
    ) ||
      parameters?.some((parameter) =>
        ["tools", "tool_choice", "functions"].includes(parameter),
      ) ||
      undefined,
  );
  if (supportsTools !== undefined) result.supportsTools = supportsTools;

  const compat = object(item.compat);
  const supportedCompat: Record<string, boolean> = {};
  for (const key of [
    "supportsReasoningEffort",
    "supportsStrictMode",
    "supportsStrictTools",
    "supportsOpenAIGrammarTools",
    "supportsToolSearch",
    "supportsAdditionalTools",
  ]) {
    if (typeof compat[key] === "boolean") supportedCompat[key] = compat[key];
  }
  if (Object.keys(supportedCompat).length) result.compat = supportedCompat;
  return result;
}
