import type {
  DiscoveredProviderModel,
  ModelThinkingLevel,
  RecordValue,
} from "./types.ts";
import { modelThinkingLevels } from "./types.ts";

const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};

/** Fill absent metadata while retaining explicit values, including null. */
export function mergeDiscoveredProviderModels(
  models: unknown,
  discovered: DiscoveredProviderModel[],
): RecordValue[] {
  const existing = Array.isArray(models)
    ? models
        .map(object)
        .filter(
          (model) =>
            String(model.id ?? "").trim() ||
            Object.keys(model).some((key) => key !== "id"),
        )
    : [];
  const imported = new Map<string, DiscoveredProviderModel>();
  for (const model of discovered)
    if (!imported.has(model.id)) imported.set(model.id, model);
  const ids = new Set(existing.map((model) => String(model.id ?? "").trim()));
  return [
    ...existing.map((model) => {
      const remote = imported.get(String(model.id ?? "").trim());
      if (!remote) return model;
      const merged: RecordValue = { ...remote, ...model };
      for (const key of ["compat", "thinkingLevelMap"] as const) {
        if (remote[key] && model[key])
          merged[key] = { ...remote[key], ...object(model[key]) };
      }
      return merged;
    }),
    ...[...imported.values()]
      .filter((model) => !ids.has(model.id))
      .map((model) => ({ ...model })),
  ];
}

/** Match the SDK's supported levels without loading its runtime in the renderer. */
export function providerThinkingLevels(
  model: RecordValue,
): ModelThinkingLevel[] {
  if (model.reasoning !== true) return ["off"];
  const map = object(model.thinkingLevelMap);
  return modelThinkingLevels.filter(
    (level) =>
      map[level] !== null &&
      ((level !== "xhigh" && level !== "max") || map[level] !== undefined),
  );
}

/** Remember provider-specific effort strings while a level is disabled. */
export function setProviderThinkingLevel(
  model: RecordValue,
  level: ModelThinkingLevel,
  enabled: boolean,
): RecordValue {
  const map = object(model.thinkingLevelMap);
  const remembered = { ...object(model.disabledThinkingLevelMap) };
  const defaultValue = level === "off" ? "none" : level;
  let value: string | null = null;
  if (enabled) {
    value =
      typeof map[level] === "string"
        ? map[level]
        : typeof remembered[level] === "string"
          ? remembered[level]
          : defaultValue;
    delete remembered[level];
  } else if (typeof map[level] === "string" && map[level] !== defaultValue) {
    remembered[level] = map[level];
  }
  const next: RecordValue = {
    ...model,
    thinkingLevelMap: { ...map, [level]: value },
  };
  if (Object.keys(remembered).length)
    next.disabledThinkingLevelMap = remembered;
  else delete next.disabledThinkingLevelMap;
  return next;
}
