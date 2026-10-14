import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getPackageDir,
  VERSION,
  type LoadedMcpConfig,
  type McpExposure,
} from "@earendil-works/pi-coding-agent";
import type { McpSettingsSnapshot, RecordValue } from "../shared/types.ts";

interface NativeConfig {
  loadMcpConfig(options: {
    agentDir: string;
    cwd: string;
    projectTrusted: boolean;
  }): LoadedMcpConfig;
  updateMcpServerConfig(
    path: string,
    name: string,
    patch: { enabled?: boolean; exposure?: McpExposure },
    options?: { override?: boolean },
  ): void;
  removeMcpServerConfig(path: string, name: string): boolean;
}
let module: Promise<NativeConfig> | undefined;
async function nativeConfig(): Promise<NativeConfig> {
  if (VERSION !== "1.2.0")
    throw new Error(
      `Pi ${VERSION}: MCP settings require a compatibility update`,
    );
  return (module ??= import(
    pathToFileURL(join(getPackageDir(), "dist/extensions/mcp/config.js")).href
  ));
}
export async function readMcpSettings(
  agentDir: string,
  cwd: string,
  project: boolean,
  trusted: boolean,
): Promise<McpSettingsSnapshot> {
  const loaded = (await nativeConfig()).loadMcpConfig({
    agentDir,
    cwd,
    projectTrusted: project && trusted,
  });
  return {
    servers: loaded.servers.map((entry) => ({
      name: entry.name,
      config: { ...entry.config },
      inherited: project && entry.scope === "global",
      overridden: !!entry.override,
    })),
    errors: loaded.errors,
  };
}
/** Use the same patch/default-removal and override rules as Pi's /mcp manager. */
export async function changeMcpSettings(
  agentDir: string,
  cwd: string,
  project: boolean,
  trusted: boolean,
  args: RecordValue,
) {
  if (project && !trusted) throw new Error("请先信任此项目");
  const name = typeof args.name === "string" ? args.name : "";
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("MCP 操作格式错误");
  const native = await nativeConfig();
  const loaded = native.loadMcpConfig({
    agentDir,
    cwd,
    projectTrusted: project && trusted,
  });
  const entry = loaded.servers.find((entry) => entry.name === name);
  if (!entry) throw new Error(`MCP server "${name}" is not configured.`);
  const path = project
    ? join(cwd, ".pi", "mcp.json")
    : join(agentDir, "mcp.json");
  if (args.remove === true) {
    if (project && entry.scope === "global" && !entry.override)
      throw new Error("此服务器继承全局配置");
    native.removeMcpServerConfig(path, name);
  } else {
    const patch: { enabled?: boolean; exposure?: McpExposure } = {};
    if (args.enabled !== undefined) {
      if (typeof args.enabled !== "boolean")
        throw new Error("MCP 操作格式错误");
      patch.enabled = args.enabled;
    }
    if (args.exposure !== undefined) {
      if (
        !["codemode", "deferred", "direct", "hidden"].includes(
          String(args.exposure),
        )
      )
        throw new Error("MCP 操作格式错误");
      patch.exposure = args.exposure as McpExposure;
    }
    if (!Object.keys(patch).length) throw new Error("MCP 操作格式错误");
    native.updateMcpServerConfig(path, name, patch, {
      override: project && entry.scope === "global",
    });
  }
}
