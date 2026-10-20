import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { DiscoveredProviderModel, RecordValue } from "../shared/types.ts";
import { providerModelMetadata } from "./provider-model-metadata.ts";

/** Read an OpenAI-compatible model list without saving the provider draft. */
export async function discoverProviderModels(
  args: RecordValue,
  lifetime: AbortSignal,
): Promise<DiscoveredProviderModel[]> {
  let url: URL;
  try {
    url = new URL(String(args.baseUrl ?? "").trim());
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error("请输入有效的 HTTP 或 HTTPS API 地址");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  url.hash = "";
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15_000)]);
  signal.throwIfAborted();

  // Use the public SDK auth resolver so interpolation and !commands behave
  // exactly like saved provider keys and headers. Keep the draft in memory.
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async () => undefined,
      delete: async () => {},
    },
    signal,
  });
  const headersConfig = args.headers;
  if (
    headersConfig !== undefined &&
    (!headersConfig ||
      typeof headersConfig !== "object" ||
      Array.isArray(headersConfig) ||
      Object.values(headersConfig).some((value) => typeof value !== "string"))
  )
    throw new Error("提供商请求头必须是字符串键值对");
  runtime.registerProvider("desktop-model-discovery", {
    apiKey: String(args.apiKey ?? "").trim(),
    headers: headersConfig as Record<string, string> | undefined,
  });
  const auth = (await runtime.getAuth("desktop-model-discovery", { signal }))
    ?.auth;
  const headers = new Headers();
  for (const [key, value] of Object.entries(auth?.headers ?? {}))
    if (value !== null) headers.set(key, value);
  if (auth?.apiKey && !headers.has("Authorization"))
    headers.set("Authorization", `Bearer ${auth.apiKey}`);
  headers.set("Accept", "application/json");
  let response: Response;
  try {
    response = await fetch(url, { headers, signal });
  } catch {
    lifetime.throwIfAborted();
    if (signal.aborted) throw new Error("获取模型超时，请检查 API 地址后重试");
    throw new Error("无法连接模型列表端点，请检查 API 地址和网络");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `获取模型失败（HTTP ${response.status}），请检查 API 地址和凭据`,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    lifetime.throwIfAborted();
    if (signal.aborted) throw new Error("获取模型超时，请检查 API 地址后重试");
    throw new Error("模型列表格式无效，需要包含 data 数组的 JSON 响应");
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("data" in value) ||
    !Array.isArray(value.data)
  )
    throw new Error("模型列表格式无效，需要包含 data 数组的 JSON 响应");
  const models = new Map<string, DiscoveredProviderModel>();
  for (const item of value.data) {
    if (!item || typeof item !== "object" || typeof item.id !== "string")
      continue;
    const id = item.id.trim();
    if (!id || models.has(id)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    models.set(id, {
      id,
      ...(name ? { name } : {}),
      ...providerModelMetadata(item),
    });
  }
  if (!models.size) throw new Error("端点未返回可用模型");
  return [...models.values()];
}
